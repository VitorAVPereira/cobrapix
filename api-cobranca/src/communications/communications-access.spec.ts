import {
  ExecutionContext,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { CommunicationsController } from './communications.controller';
import type { CommunicationsService } from './communications.service';
import type { CommunicationsTenantService } from './communications-tenant.service';
import {
  AdminConversationsQueryDto,
  CompanyConversationsQueryDto,
  ConversationMessagesQueryDto,
} from './dto/conversation-query.dto';

// Same options as the global APP_PIPE in app.module.ts.
const appPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

type Handler = (...args: unknown[]) => unknown;
const prototype = CommunicationsController.prototype as unknown as Record<
  string,
  Handler
>;
const handlers = Object.getOwnPropertyNames(prototype).filter(
  (name) => name !== 'constructor',
);
const pathOf = (name: string): string =>
  Reflect.getMetadata(PATH_METADATA, prototype[name] as object) as string;
const guardsOf = (name: string): unknown[] =>
  (Reflect.getMetadata(GUARDS_METADATA, prototype[name] as object) as
    | unknown[]
    | undefined) ?? [];

const companyUser: AuthenticatedUser = {
  userId: 'user-a',
  email: 'a@example.test',
  companyId: 'company-a',
  role: 'COMPANY_ADMIN',
  mustChangePassword: false,
  tokenVersion: 1,
};

describe('Communications access boundaries', () => {
  it('guards every administrative route, including mutations', () => {
    const admin = handlers.filter((name) => pathOf(name).startsWith('admin/'));
    expect(admin.sort()).toEqual(
      [
        'attribute',
        'getAdmin',
        'listAdmin',
        'listContextOptions',
        'reply',
        'templateReply',
        'updateStatus',
      ].sort(),
    );
    for (const name of admin)
      expect(guardsOf(name)).toContain(PlatformAdminGuard);
  });

  it('exposes no mutation on company routes', () => {
    const company = handlers.filter(
      (name) => !pathOf(name).startsWith('admin/'),
    );
    expect(company.sort()).toEqual(
      ['listConversationMessages', 'listConversations', 'listOutbound'].sort(),
    );
  });

  it('rejects a company user on administrative routes even with valid IDs', () => {
    const guard = new PlatformAdminGuard();
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: companyUser }) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('scopes company reads to the session, never to request data', async () => {
    const tenant = {
      listConversations: jest.fn().mockResolvedValue({ items: [] }),
      listMessages: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new CommunicationsController(
      {} as CommunicationsService,
      tenant as unknown as CommunicationsTenantService,
    );
    await controller.listConversations(companyUser, { limit: 25 });
    await controller.listConversationMessages(companyUser, 'conversation-1', {
      limit: 25,
    });
    expect(tenant.listConversations).toHaveBeenCalledWith(
      { userId: 'user-a', companyId: 'company-a' },
      { limit: 25 },
    );
    expect(tenant.listMessages).toHaveBeenCalledWith(
      { userId: 'user-a', companyId: 'company-a' },
      'conversation-1',
      { limit: 25 },
    );
  });

  it.each([
    [CompanyConversationsQueryDto, { companyId: 'company-b' }],
    [ConversationMessagesQueryDto, { companyId: 'company-b' }],
    [CompanyConversationsQueryDto, { limit: '101' }],
  ])('refuses tenant or oversized query parameters', async (type, query) => {
    await expect(
      appPipe.transform(query, { type: 'query', metatype: type }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['true', true],
    ['false', false],
  ])(
    'parses pendingClassification=%s under the application pipe',
    async (raw, expected) => {
      const parsed = (await appPipe.transform(
        { pendingClassification: raw },
        { type: 'query', metatype: AdminConversationsQueryDto },
      )) as AdminConversationsQueryDto;
      expect(parsed.pendingClassification).toBe(expected);
    },
  );
});
