import { OutboundDispatcherService } from './outbound-dispatcher.service';
import { DatafyRateLimitService } from './transport/datafy-rate-limit.service';
import { Test } from '@nestjs/testing';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Server } from 'node:http';
import request from 'supertest';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappTransportModule } from './transport/whatsapp-transport.module';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { MessagingLimitService } from '../queue/services/messaging-limit.service';
import { WhatsAppConversationService } from './conversation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';

describe('Teste administrativo do transporte (HTTP)', () => {
  let app: INestApplication<Server>;
  let http: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule, WhatsappTransportModule],
      controllers: [WhatsappController],
      providers: [
        WhatsappService,
        { provide: OutboundDispatcherService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: PaymentCryptoService, useValue: {} },
        { provide: MessagingLimitService, useValue: {} },
        { provide: WhatsAppConversationService, useValue: {} },
      ],
    })
      .overrideProvider(DatafyRateLimitService)
      .useValue({ acquire: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          DATAFY_API_TOKEN: 'sk_live_test_only',
          META_PHONE_NUMBER_ID: '123',
          META_BUSINESS_ACCOUNT_ID: '456',
        }),
      )
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext): boolean {
          const req = context
            .switchToHttp()
            .getRequest<
              Request & { user?: { role: string; companyId: string } }
            >();
          const role = req.header('x-test-role');
          if (!role) throw new UnauthorizedException();
          req.user = { role, companyId: 'company-1' };
          return true;
        },
      })
      .overrideGuard(ThrottleGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    await app.init();
  });
  beforeEach(() => {
    http = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('recusa anonimo e usuario de empresa antes de consultar o provedor', async () => {
    await request(app.getHttpServer())
      .post('/whatsapp/admin/test-integration')
      .expect(401);
    await request(app.getHttpServer())
      .post('/whatsapp/admin/test-integration')
      .set('x-test-role', 'ADMIN')
      .expect(403);
    expect(http).not.toHaveBeenCalled();
  });

  it('admin verifica credenciais e IDs sem enviar mensagem ou revelar token', async () => {
    http.mockResolvedValue(
      new Response(
        JSON.stringify({
          cliente_id: 'private-account',
          phone_number_id: '123',
          waba_id: '456',
        }),
      ),
    );
    const response = await request(app.getHttpServer())
      .post('/whatsapp/admin/test-integration')
      .set('x-test-role', 'PLATFORM_ADMIN')
      .expect(201);
    expect(response.body).toMatchObject({
      authentication: 'AUTHENTICATED',
      transport: 'DATAFY',
      phoneNumberId: '123',
      businessAccountId: '456',
      webhookSupported: true,
    });
    expect(response.text).not.toContain('sk_live_test_only');
    expect(response.text).not.toContain('private-account');
    expect(http).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledWith(
      'https://cloud.datafyapi.com.br/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('erro autenticado nao retorna corpo bruto do fornecedor ao administrador', async () => {
    http.mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 401,
          message: 'sk_live_test_only sensitive',
        }),
        { status: 401 },
      ),
    );
    const response = await request(app.getHttpServer())
      .post('/whatsapp/admin/test-integration')
      .set('x-test-role', 'PLATFORM_ADMIN')
      .expect(502);
    expect(response.text).not.toContain('sk_live_test_only');
    expect(response.text).not.toContain('sensitive');
  });
});
