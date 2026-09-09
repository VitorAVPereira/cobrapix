import { HttpException } from '@nestjs/common';
import type { EmailTemplate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResendMailerService } from '../common/resend-mailer.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EmailTemplatesService } from './email-templates.service';

type EmailTemplateRecord = EmailTemplate & {
  resendTemplateId: string | null;
  resendAlias: string | null;
  resendStatus: string;
  resendPublishedAt: Date | null;
  lastResendSyncAt: Date | null;
  resendError: string | null;
  deletedAt: Date | null;
};

function createEmailTemplateFixture(
  overrides: Partial<EmailTemplateRecord> = {},
): EmailTemplateRecord {
  return {
    id: 'email-template-1',
    name: 'Vencimento hoje',
    slug: 'vencimento-hoje',
    subject: 'Sua cobranca vence hoje',
    content: 'Ola {{nome_devedor}}, sua cobranca de {{valor}} vence hoje.',
    isActive: true,
    companyId: 'company-1',
    resendTemplateId: null,
    resendAlias: null,
    resendStatus: 'local',
    resendPublishedAt: null,
    lastResendSyncAt: null,
    resendError: null,
    deletedAt: null,
    createdAt: new Date('2026-05-26T12:00:00.000Z'),
    updatedAt: new Date('2026-05-26T12:00:00.000Z'),
    ...overrides,
  };
}

function createService(input?: {
  existingSlugs?: string[];
  templates?: EmailTemplateRecord[];
}): {
  service: EmailTemplatesService;
  prisma: {
    company: {
      findUnique: jest.Mock;
    };
    emailTemplate: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  crypto: { decrypt: jest.Mock };
  resendMailer: {
    createTemplate: jest.Mock;
    updateTemplate: jest.Mock;
    publishTemplate: jest.Mock;
    deleteTemplate: jest.Mock;
  };
} {
  const templates = input?.templates ?? [
    createEmailTemplateFixture({ slug: 'vencimento-hoje' }),
  ];
  const prisma = {
    company: {
      findUnique: jest.fn().mockResolvedValue({
        corporateName: 'Empresa Teste',
        resendApiKeyEncrypted: 'encrypted-resend-key',
        resendFromEmail: 'cobranca@empresa.com',
      }),
    },
    emailTemplate: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(
          (input?.existingSlugs ?? []).map((slug) => ({ slug })),
        )
        .mockResolvedValue(templates),
      createMany: jest.fn().mockResolvedValue({ count: 6 }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(
        async ({ data }: { data: Partial<EmailTemplateRecord> }) =>
          createEmailTemplateFixture(data),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
  const crypto = {
    decrypt: jest.fn().mockReturnValue('re_cliente_123'),
  } as unknown as PaymentCryptoService;
  const resendMailer = {
    createTemplate: jest.fn().mockResolvedValue({ id: 'resend-template-1' }),
    updateTemplate: jest.fn().mockResolvedValue({ id: 'resend-template-1' }),
    publishTemplate: jest.fn().mockResolvedValue({ id: 'resend-template-1' }),
    deleteTemplate: jest.fn().mockResolvedValue({
      id: 'resend-template-1',
      deleted: true,
    }),
  } as unknown as ResendMailerService;

  return {
    service: new EmailTemplatesService(prisma, crypto, resendMailer),
    prisma: prisma as unknown as {
      company: {
        findUnique: jest.Mock;
      };
      emailTemplate: {
        findMany: jest.Mock;
        createMany: jest.Mock;
        findFirst: jest.Mock;
        create: jest.Mock;
        updateMany: jest.Mock;
      };
    },
    crypto: crypto as unknown as { decrypt: jest.Mock },
    resendMailer: resendMailer as unknown as {
      createTemplate: jest.Mock;
      updateTemplate: jest.Mock;
      publishTemplate: jest.Mock;
      deleteTemplate: jest.Mock;
    },
  };
}

describe('EmailTemplatesService', () => {
  it('cria templates de email padrao quando faltam slugs da empresa', async () => {
    const { service, prisma } = createService();

    await service.ensureDefaultTemplates('company-1');

    expect(prisma.emailTemplate.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          companyId: 'company-1',
          slug: 'cobranca-emissao',
          subject: expect.stringContaining('{{nome_empresa}}') as string,
          isActive: true,
        }),
        expect.objectContaining({
          companyId: 'company-1',
          slug: 'atraso-critico',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('rejeita placeholders desconhecidos no assunto e no corpo', async () => {
    const { service } = createService();

    await expect(
      service.create('company-1', {
        name: 'Vencimento hoje',
        slug: 'vencimento-hoje',
        subject: 'Ola {{apelido}}',
        content: 'Cobranca de {{valor}}',
      }),
    ).rejects.toBeInstanceOf(HttpException);

    await expect(
      service.create('company-1', {
        name: 'Vencimento hoje',
        slug: 'vencimento-hoje',
        subject: 'Cobranca de {{valor}}',
        content: 'Ola {{apelido}}',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('atualiza assunto, corpo e status ativo com filtro de empresa', async () => {
    const { service, prisma } = createService({
      templates: [
        createEmailTemplateFixture({
          resendTemplateId: 'resend-template-1',
          resendAlias: 'cobrapix_vencimento_hoje',
        }),
      ],
    });
    prisma.emailTemplate.findFirst.mockResolvedValueOnce(
      createEmailTemplateFixture({
        resendTemplateId: 'resend-template-1',
        resendAlias: 'cobrapix_vencimento_hoje',
      }),
    );
    prisma.emailTemplate.findFirst.mockResolvedValueOnce(
      createEmailTemplateFixture({
        subject: 'Novo assunto {{valor}}',
        content: 'Novo corpo para {{nome_devedor}}',
        isActive: false,
        resendTemplateId: 'resend-template-1',
        resendAlias: 'cobrapix_vencimento_hoje',
        resendStatus: 'published',
      }),
    );

    await service.update('company-1', 'email-template-1', {
      subject: 'Novo assunto {{valor}}',
      content: 'Novo corpo para {{nome_devedor}}',
      isActive: false,
    });

    expect(prisma.emailTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'email-template-1',
        companyId: 'company-1',
        deletedAt: null,
      },
    });
    expect(prisma.emailTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 'email-template-1', companyId: 'company-1' },
      data: expect.objectContaining({
        subject: 'Novo assunto {{valor}}',
        content: 'Novo corpo para {{nome_devedor}}',
        isActive: false,
        resendStatus: 'published',
        resendError: null,
      }) as unknown,
    });
  });

  it('cria e publica template na Resend antes de salvar o vinculo local', async () => {
    const { service, prisma, crypto, resendMailer } = createService();

    await service.create('company-1', {
      name: 'Vencimento hoje',
      slug: 'vencimento-hoje',
      subject: '{{nome_empresa}}: vencimento hoje',
      content: 'Ola {{nome_devedor}}, acesse {{payment_link}}.',
    });

    expect(crypto.decrypt).toHaveBeenCalledWith('encrypted-resend-key');
    expect(resendMailer.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 're_cliente_123',
        name: 'Vencimento hoje',
        alias: 'cobrapix_vencimento_hoje',
        from: 'Empresa Teste <cobranca@empresa.com>',
        subject: '{{{NOME_EMPRESA}}}: vencimento hoje',
        text: 'Ola {{{NOME_DEVEDOR}}}, acesse {{{PAYMENT_LINK}}}.',
        variables: expect.arrayContaining([
          {
            key: 'NOME_DEVEDOR',
            type: 'string',
            fallbackValue: 'Cliente',
          },
          {
            key: 'PAYMENT_LINK',
            type: 'string',
            fallbackValue: 'https://cobrapix.com/pagar',
          },
        ]) as unknown,
      }),
    );
    expect(resendMailer.publishTemplate).toHaveBeenCalledWith({
      apiKey: 're_cliente_123',
      idOrAlias: 'resend-template-1',
    });
    expect(prisma.emailTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          resendTemplateId: 'resend-template-1',
          resendAlias: 'cobrapix_vencimento_hoje',
          resendStatus: 'published',
          resendError: null,
        }) as unknown,
      }),
    );
  });

  it('atualiza e publica template existente na Resend ao editar assunto ou corpo', async () => {
    const { service, resendMailer } = createService();
    prismaMockFindFirstSequence(service, [
      createEmailTemplateFixture({
        resendTemplateId: 'resend-template-1',
        resendAlias: 'cobrapix_vencimento_hoje',
      }),
      createEmailTemplateFixture({
        resendTemplateId: 'resend-template-1',
        resendAlias: 'cobrapix_vencimento_hoje',
        subject: '{{nome_empresa}}: atualizado',
        content: 'Novo corpo {{valor}}',
      }),
    ]);

    await service.update('company-1', 'email-template-1', {
      subject: '{{nome_empresa}}: atualizado',
      content: 'Novo corpo {{valor}}',
    });

    expect(resendMailer.updateTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 're_cliente_123',
        idOrAlias: 'resend-template-1',
        subject: '{{{NOME_EMPRESA}}}: atualizado',
        text: 'Novo corpo {{{VALOR}}}',
      }),
    );
    expect(resendMailer.publishTemplate).toHaveBeenCalledWith({
      apiKey: 're_cliente_123',
      idOrAlias: 'resend-template-1',
    });
  });

  it('remove template da Resend e marca exclusao local com filtro de empresa', async () => {
    const { service, prisma, resendMailer } = createService();
    prisma.emailTemplate.findFirst.mockResolvedValueOnce(
      createEmailTemplateFixture({
        resendTemplateId: 'resend-template-1',
        resendAlias: 'cobrapix_vencimento_hoje',
      }),
    );

    await service.remove('company-1', 'email-template-1');

    expect(resendMailer.deleteTemplate).toHaveBeenCalledWith({
      apiKey: 're_cliente_123',
      idOrAlias: 'resend-template-1',
    });
    expect(prisma.emailTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 'email-template-1', companyId: 'company-1' },
      data: expect.objectContaining({
        deletedAt: expect.any(Date) as Date,
        isActive: false,
      }) as unknown,
    });
  });

  it('resolve template ativo por slug ou retorna o default seguro', async () => {
    const { service, prisma } = createService();
    prisma.emailTemplate.findFirst.mockResolvedValueOnce(null);

    const template = await service.findActiveOrDefault(
      'company-1',
      'vencimento-hoje',
    );

    expect(prisma.emailTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        slug: 'vencimento-hoje',
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        subject: true,
        content: true,
        isActive: true,
        resendTemplateId: true,
        resendAlias: true,
      },
    });
    expect(template.slug).toBe('vencimento-hoje');
    expect(template.subject).toContain('{{nome_empresa}}');
  });
});

function prismaMockFindFirstSequence(
  service: EmailTemplatesService,
  templates: EmailTemplateRecord[],
): void {
  const prisma = service as unknown as {
    prisma: {
      emailTemplate: {
        findFirst: jest.Mock;
      };
    };
  };

  for (const template of templates) {
    prisma.prisma.emailTemplate.findFirst.mockResolvedValueOnce(template);
  }
}
