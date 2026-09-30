import { Test } from '@nestjs/testing';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { Server } from 'node:http';
import request from 'supertest';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { MessagingLimitService } from '../queue/services/messaging-limit.service';
import { WhatsAppConversationService } from './conversation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';

const interactions = {
  outbound: 4,
  delivered: 3,
  read: 2,
  inbound: 1,
  failed: 1,
};
const capacity = {
  limit: 50,
  used: 12,
  remaining: 38,
  unit: 'UNIQUE_RECIPIENTS',
  windowSeconds: 86_400,
  scopeId: 'channel:123',
  source: 'FALLBACK',
  tier: null,
  checkedAt: null,
  nextAvailableAt: null,
};

describe('Estatisticas da empresa e capacidade central (HTTP)', () => {
  let app: INestApplication<Server>;
  const messaging = {
    getInteractionStats: jest.fn().mockResolvedValue(interactions),
    getChannelCapacity: jest.fn().mockResolvedValue(capacity),
    syncChannelTier: jest.fn(),
    canSend: jest.fn().mockResolvedValue({
      tier: 'TIER_50',
      limit: 50,
      usage: 2,
      remaining: 48,
      allowed: true,
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WhatsappController],
      providers: [
        { provide: WhatsappService, useValue: {} },
        { provide: MessagingLimitService, useValue: messaging },
        { provide: WhatsAppConversationService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        // The session carries role and company; the request cannot change them.
        canActivate(context: ExecutionContext): boolean {
          const req = context
            .switchToHttp()
            .getRequest<
              Request & { user?: { role: string; companyId: string } }
            >();
          const role = req.header('x-test-role');
          if (!role) throw new UnauthorizedException();
          req.user = {
            role,
            companyId: req.header('x-test-company') ?? 'company-a',
          };
          return true;
        },
      })
      .overrideGuard(ThrottleGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('gives each company only its own results, whatever it asks for', async () => {
    const response = await request(app.getHttpServer())
      .get('/whatsapp/stats?companyId=company-b')
      .set('x-test-role', 'COMPANY_ADMIN')
      .set('x-test-company', 'company-a')
      .expect(200);
    expect(response.body).toEqual({ period: 'rolling_24h', interactions });
    expect(messaging.getInteractionStats).toHaveBeenCalledTimes(1);
    expect(messaging.getInteractionStats).toHaveBeenCalledWith('company-a');
    // No channel operation reaches a company.
    for (const field of ['dailyLimit', 'remaining', 'tier', 'quality', 'limit'])
      expect(response.text).not.toContain(field);
    expect(messaging.getChannelCapacity).not.toHaveBeenCalled();
  });

  it('refuses anonymous access to company results', async () => {
    await request(app.getHttpServer()).get('/whatsapp/stats').expect(401);
  });

  it('shows the central capacity to platform admins only', async () => {
    await request(app.getHttpServer())
      .get('/whatsapp/admin/channel-capacity')
      .expect(401);
    await request(app.getHttpServer())
      .get('/whatsapp/admin/channel-capacity')
      .set('x-test-role', 'COMPANY_ADMIN')
      .expect(403);
    expect(messaging.getChannelCapacity).not.toHaveBeenCalled();
    const response = await request(app.getHttpServer())
      .get('/whatsapp/admin/channel-capacity')
      .set('x-test-role', 'PLATFORM_ADMIN')
      .expect(200);
    expect(response.body).toEqual(capacity);
  });

  it('syncs the channel tier for admins, without touching any company', async () => {
    await request(app.getHttpServer())
      .post('/whatsapp/sync-tier')
      .set('x-test-role', 'COMPANY_ADMIN')
      .expect(403);
    messaging.syncChannelTier.mockResolvedValueOnce({
      tier: 'TIER_2K',
      capacity: { ...capacity, source: 'PROVIDER', tier: 'TIER_2K' },
    });
    const response = await request(app.getHttpServer())
      .post('/whatsapp/sync-tier')
      .set('x-test-role', 'PLATFORM_ADMIN')
      .expect(201);
    expect(response.body).toMatchObject({
      tier: 'TIER_2K',
      capacity: { source: 'PROVIDER' },
    });
    expect(messaging.syncChannelTier).toHaveBeenCalledWith();
  });

  it('answers an unconfirmed tier as a provider failure', async () => {
    messaging.syncChannelTier.mockResolvedValueOnce({ tier: null, capacity });
    await request(app.getHttpServer())
      .post('/whatsapp/sync-tier')
      .set('x-test-role', 'PLATFORM_ADMIN')
      .expect(502);
  });

  it('keeps the legacy usage route answering during the frontend rollout', async () => {
    const response = await request(app.getHttpServer())
      .get('/whatsapp/usage')
      .set('x-test-role', 'COMPANY_ADMIN')
      .expect(200);
    expect(response.body).toMatchObject({ interactions });
    expect(messaging.canSend).toHaveBeenCalledWith('company-a');
  });
});
