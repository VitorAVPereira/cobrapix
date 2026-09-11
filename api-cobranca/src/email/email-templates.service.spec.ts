import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailTemplatesService } from './email-templates.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ResendMailerService } from '../common/resend-mailer.service';

const template = {
  id: 'email-1',
  name: 'Vencimento hoje',
  slug: 'vencimento-hoje',
  subject: '{{nome_empresa}}: cobrança via CifraMais',
  content: '{{saudacao}}, {{nome_devedor}}. {{instrucoes}} {{assinatura}}',
  isActive: true,
  resendTemplateId: null,
  resendAlias: null,
  resendStatus: 'local',
  resendPublishedAt: null,
  lastResendSyncAt: null,
  resendError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(): {
  service: EmailTemplatesService;
  prisma: {
    globalEmailTemplate: Record<string, jest.Mock>;
    companyTemplatePreference: Record<string, jest.Mock>;
  };
  resend: Record<string, jest.Mock>;
} {
  const prisma = {
    globalEmailTemplate: {
      upsert: jest.fn().mockResolvedValue(template),
      findMany: jest.fn().mockResolvedValue([template]),
      findFirst: jest.fn().mockResolvedValue(template),
      findUnique: jest.fn().mockResolvedValue(template),
      findUniqueOrThrow: jest.fn().mockResolvedValue(template),
      create: jest.fn(),
      update: jest
        .fn()
        .mockResolvedValue({ ...template, resendStatus: 'published' }),
    },
    companyTemplatePreference: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const resend = {
    createTemplate: jest.fn().mockResolvedValue({ id: 'resend-1' }),
    updateTemplate: jest.fn(),
    publishTemplate: jest.fn().mockResolvedValue({ id: 'resend-1' }),
  };
  return {
    service: new EmailTemplatesService(
      prisma as unknown as PrismaService,
      resend as unknown as ResendMailerService,
      new ConfigService({
        RESEND_API_KEY: 'central',
        RESEND_FROM_EMAIL: 'CifraMais <central@ciframais.com>',
      }),
    ),
    prisma,
    resend,
  };
}

describe('EmailTemplatesService global catalog', () => {
  it('does not mutate global subject or body when tenant personalizes', async () => {
    const { service, prisma } = setup();
    await service.update('company-1', 'email-1', {
      greeting: 'Boa tarde',
      instructions: 'Confira o vencimento.',
      signature: 'Financeiro ACME',
    });
    expect(prisma.companyTemplatePreference.upsert).toHaveBeenCalled();
    expect(prisma.globalEmailTemplate.update).not.toHaveBeenCalled();
  });

  it('publishes the single global template with central credentials', async () => {
    const { service, resend } = setup();
    await service.publish('admin-company', 'email-1');
    expect(resend.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'central',
        from: 'CifraMais <central@ciframais.com>',
        alias: 'ciframais_vencimento_hoje',
      }),
    );
    expect(resend.publishTemplate).toHaveBeenCalledWith({
      apiKey: 'central',
      idOrAlias: 'resend-1',
    });
  });

  it('rejects unsafe personalization', async () => {
    const { service } = setup();
    await expect(
      service.update('company-1', 'email-1', { greeting: 'Oi\nclique aqui' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
