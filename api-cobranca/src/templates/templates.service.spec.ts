import type { MessageTemplate } from '@prisma/client';
import { TemplatesService } from './templates.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

function createService(input?: {
  existingTemplates?: Array<{ id: string; slug: string }>;
}) {
  const existingTemplates = input?.existingTemplates ?? [];
  const createdTemplates = [
    { id: 'template-emissao', slug: 'cobranca-emissao' },
    { id: 'template-pre', slug: 'pre-vencimento' },
    { id: 'template-vencimento', slug: 'vencimento-hoje' },
    { id: 'template-primeiro-atraso', slug: 'atraso-primeiro-aviso' },
    { id: 'template-recorrente', slug: 'atraso-recorrente' },
    { id: 'template-critico', slug: 'atraso-critico' },
  ];
  const prisma = {
    messageTemplate: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(existingTemplates)
        .mockResolvedValue(createdTemplates),
      createMany: jest.fn().mockResolvedValue({ count: 6 }),
    },
  } as unknown as PrismaService;

  const whatsappService = {
    buildMetaTemplateName: jest.fn((slug: string) => `cobrapix_${slug}`),
  } as unknown as WhatsappService;

  return {
    service: new TemplatesService(prisma, whatsappService),
    prisma: prisma as unknown as {
      messageTemplate: {
        findMany: jest.Mock;
        createMany: jest.Mock;
      };
    },
  };
}

describe('TemplatesService ensureDefaultTemplates', () => {
  it('cria os templates padrao locais com componentes Meta-safe', async () => {
    const { service, prisma } = createService();

    await service.ensureDefaultTemplates('company-1');

    expect(prisma.messageTemplate.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          companyId: 'company-1',
          slug: 'cobranca-emissao',
          metaStatus: 'LOCAL',
          footerText: 'Mensagem automatica da {{nome_empresa}}.',
          paymentButtonEnabled: true,
          paymentButtonLabel: 'Abrir pagamento',
          copyCodeButtonEnabled: false,
          copyCodeSource: 'AUTO',
        }),
        expect.objectContaining({
          companyId: 'company-1',
          slug: 'atraso-critico',
          metaStatus: 'LOCAL',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('nao recria templates padrao ja existentes', async () => {
    const { service, prisma } = createService({
      existingTemplates: [
        { id: 'template-emissao', slug: 'cobranca-emissao' },
        { id: 'template-pre', slug: 'pre-vencimento' },
        { id: 'template-vencimento', slug: 'vencimento-hoje' },
        { id: 'template-primeiro-atraso', slug: 'atraso-primeiro-aviso' },
        { id: 'template-recorrente', slug: 'atraso-recorrente' },
        { id: 'template-critico', slug: 'atraso-critico' },
      ],
    });

    await service.ensureDefaultTemplates('company-1');

    expect(prisma.messageTemplate.createMany).not.toHaveBeenCalled();
  });
});

function createMessageTemplateFixture(
  overrides: Partial<MessageTemplate> = {},
): MessageTemplate {
  return {
    id: 'template-1',
    name: 'Vencimento hoje',
    slug: 'vencimento-hoje',
    content: 'Ola, {{nome_devedor}}. Sua cobranca vence hoje.',
    footerText: null,
    paymentButtonEnabled: true,
    paymentButtonLabel: 'Abrir pagamento',
    copyCodeButtonEnabled: false,
    copyCodeSource: 'AUTO',
    isActive: true,
    metaTemplateName: 'cobrapix_vencimento_hoje',
    metaLanguage: 'pt_BR',
    category: 'UTILITY',
    metaStatus: 'PENDING',
    metaRejectedReason: null,
    lastMetaSyncAt: null,
    companyId: 'company-1',
    createdAt: new Date('2026-05-20T00:00:00.000Z'),
    updatedAt: new Date('2026-05-20T00:00:00.000Z'),
    ...overrides,
  };
}

describe('TemplatesService syncMetaStatuses', () => {
  it('atualiza templates locais com o status consultado na Meta', async () => {
    const pendingTemplate = createMessageTemplateFixture();
    const rejectedTemplate = createMessageTemplateFixture({
      id: 'template-2',
      slug: 'pre-vencimento',
      metaTemplateName: 'cobrapix_pre_vencimento',
    });
    const syncedTemplates = [
      createMessageTemplateFixture({ metaStatus: 'APPROVED' }),
      createMessageTemplateFixture({
        id: 'template-2',
        slug: 'pre-vencimento',
        metaTemplateName: 'cobrapix_pre_vencimento',
        metaStatus: 'REJECTED',
        metaRejectedReason: 'SCAM',
      }),
    ];
    const prisma = {
      messageTemplate: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([pendingTemplate, rejectedTemplate])
          .mockResolvedValueOnce(syncedTemplates),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaService;
    const whatsappService = {
      listOfficialTemplateStatuses: jest.fn().mockResolvedValue([
        {
          name: 'cobrapix_vencimento_hoje',
          language: 'pt_BR',
          status: 'APPROVED',
          rejectedReason: null,
        },
        {
          name: 'cobrapix_pre_vencimento',
          language: 'pt_BR',
          status: 'REJECTED',
          rejectedReason: 'SCAM',
        },
      ]),
    } as unknown as WhatsappService;
    const service = new TemplatesService(prisma, whatsappService);

    const result = await service.syncMetaStatuses('company-1');

    expect(whatsappService.listOfficialTemplateStatuses).toHaveBeenCalledWith(
      'company-1',
    );
    expect(prisma.messageTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 'template-1', companyId: 'company-1' },
      data: {
        metaStatus: 'APPROVED',
        metaRejectedReason: null,
        lastMetaSyncAt: expect.any(Date),
      },
    });
    expect(prisma.messageTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 'template-2', companyId: 'company-1' },
      data: {
        metaStatus: 'REJECTED',
        metaRejectedReason: 'SCAM',
        lastMetaSyncAt: expect.any(Date),
      },
    });
    expect(result).toEqual(syncedTemplates);
  });
});
