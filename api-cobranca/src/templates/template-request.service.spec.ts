import type { ConfigService } from '@nestjs/config';
import type { ResendMailerService } from '../common/resend-mailer.service';
import type { PrismaService } from '../prisma/prisma.service';
import { TemplateRequestService } from './template-request.service';

const row = {
  id: 'request-1',
  companyId: 'company-a',
  ruleStepId: 'step-1',
  purpose: 'BEFORE_DUE',
  billingMethod: 'PIX',
  message: 'Quero citar o número da matrícula do aluno.',
  status: 'OPEN',
  adminNote: null,
  version: 1,
  createdAt: new Date('2026-10-20T12:00:00Z'),
  updatedAt: new Date('2026-10-20T12:00:00Z'),
  company: { corporateName: 'Escola <A>', tradeName: null },
};

function setup(options: { step?: boolean; mailFails?: boolean } = {}) {
  const prisma = {
    collectionRuleStep: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.step === false ? null : { id: 'step-1' }),
    },
    templateRequest: {
      create: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([row]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'request-1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...row, version: 2 }),
    },
  };
  const settings: Record<string, string> = {
    RESEND_API_KEY: 're_test',
    RESEND_FROM_EMAIL: 'Cifra+ <avisos@test>',
    RESEND_REPLY_TO: 'suporte@test',
    PLATFORM_ALERT_EMAIL: 'admin@test',
  };
  const mailer = {
    sendEmail: options.mailFails
      ? jest.fn().mockRejectedValue(new Error('Resend fora do ar'))
      : jest.fn().mockResolvedValue({ id: 'email-1' }),
  };
  return {
    service: new TemplateRequestService(
      prisma as unknown as PrismaService,
      { get: (key: string) => settings[key] } as unknown as ConfigService,
      mailer as unknown as ResendMailerService,
    ),
    prisma,
    mailer,
  };
}

describe('TemplateRequestService', () => {
  it('records the request of the company and tells the admin by e-mail', async () => {
    const { service, prisma, mailer } = setup();
    await expect(
      service.create('company-a', 'user-1', {
        ruleStepId: 'step-1',
        purpose: 'BEFORE_DUE',
        billingMethod: 'PIX',
        message: `  ${row.message}  `,
      }),
    ).resolves.toMatchObject({ id: 'request-1', status: 'OPEN' });
    expect(prisma.collectionRuleStep.findFirst).toHaveBeenCalledWith({
      where: { id: 'step-1', profile: { companyId: 'company-a' } },
      select: { id: true },
    });
    expect(prisma.templateRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-a',
          requestedByUserId: 'user-1',
          message: row.message,
        }) as unknown,
      }),
    );
    expect(mailer.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['admin@test'],
        idempotencyKey: 'template-request-request-1',
        html: expect.stringContaining('Escola &lt;A&gt;') as string,
      }),
    );
  });

  it('a step of another company is not found and nothing is recorded', async () => {
    const { service, prisma } = setup({ step: false });
    await expect(
      service.create('company-b', 'user-2', {
        ruleStepId: 'step-1',
        message: row.message,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.templateRequest.create).not.toHaveBeenCalled();
  });

  it('a failed e-mail never loses the request: the admin still sees it in the panel', async () => {
    const { service } = setup({ mailFails: true });
    await expect(
      service.create('company-a', 'user-1', { message: row.message }),
    ).resolves.toMatchObject({ id: 'request-1' });
  });

  it('a company lists only its own requests', async () => {
    const { service, prisma } = setup();
    await service.listForCompany('company-a');
    expect(prisma.templateRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-a' } }),
    );
  });

  it('the admin moves the status with the version seen; a stale one is a conflict', async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateStatus('request-1', 'IN_PROGRESS', ' Em análise ', 1),
    ).resolves.toMatchObject({ version: 2 });
    expect(prisma.templateRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', version: 1 },
      data: {
        status: 'IN_PROGRESS',
        adminNote: 'Em análise',
        version: { increment: 1 },
      },
    });
    prisma.templateRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.updateStatus('request-1', 'DONE', null, 1),
    ).rejects.toMatchObject({ status: 409 });
  });
});
