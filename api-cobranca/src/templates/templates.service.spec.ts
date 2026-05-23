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
