import { HttpException } from '@nestjs/common';
import type { EmailTemplate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTemplatesService } from './email-templates.service';

function createEmailTemplateFixture(
  overrides: Partial<EmailTemplate> = {},
): EmailTemplate {
  return {
    id: 'email-template-1',
    name: 'Vencimento hoje',
    slug: 'vencimento-hoje',
    subject: 'Sua cobranca vence hoje',
    content: 'Ola {{nome_devedor}}, sua cobranca de {{valor}} vence hoje.',
    isActive: true,
    companyId: 'company-1',
    createdAt: new Date('2026-05-26T12:00:00.000Z'),
    updatedAt: new Date('2026-05-26T12:00:00.000Z'),
    ...overrides,
  };
}

function createService(input?: {
  existingSlugs?: string[];
  templates?: EmailTemplate[];
}): {
  service: EmailTemplatesService;
  prisma: {
    emailTemplate: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
} {
  const templates =
    input?.templates ?? [
      createEmailTemplateFixture({ slug: 'vencimento-hoje' }),
    ];
  const prisma = {
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
        async ({
          data,
        }: {
          data: Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>;
        }) => createEmailTemplateFixture(data),
      ),
      update: jest.fn(
        async ({ data }: { data: Partial<EmailTemplate> }) =>
          createEmailTemplateFixture(data),
      ),
    },
  } as unknown as PrismaService;

  return {
    service: new EmailTemplatesService(prisma),
    prisma: prisma as unknown as {
      emailTemplate: {
        findMany: jest.Mock;
        createMany: jest.Mock;
        findFirst: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
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
    const { service, prisma } = createService();
    prisma.emailTemplate.findFirst.mockResolvedValueOnce(
      createEmailTemplateFixture(),
    );

    await service.update('company-1', 'email-template-1', {
      subject: 'Novo assunto {{valor}}',
      content: 'Novo corpo para {{nome_devedor}}',
      isActive: false,
    });

    expect(prisma.emailTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: 'email-template-1', companyId: 'company-1' },
    });
    expect(prisma.emailTemplate.update).toHaveBeenCalledWith({
      where: { id: 'email-template-1' },
      data: {
        subject: 'Novo assunto {{valor}}',
        content: 'Novo corpo para {{nome_devedor}}',
        isActive: false,
      },
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
      },
      select: {
        id: true,
        slug: true,
        name: true,
        subject: true,
        content: true,
        isActive: true,
      },
    });
    expect(template.slug).toBe('vencimento-hoje');
    expect(template.subject).toContain('{{nome_empresa}}');
  });
});
