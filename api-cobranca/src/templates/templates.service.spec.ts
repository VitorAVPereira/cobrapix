import { HttpException } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsappService } from '../whatsapp/whatsapp.service';

const globalTemplate = {
  id: 'global-1',
  name: 'Vencimento hoje',
  slug: 'vencimento-hoje',
  content:
    '{{saudacao}}, cobrança de {{nome_empresa}} via CifraMais. {{instrucoes}} {{assinatura}}',
  footerText: 'Atendimento central CifraMais.',
  paymentButtonEnabled: true,
  paymentButtonLabel: 'Abrir pagamento',
  copyCodeButtonEnabled: false,
  copyCodeSource: 'AUTO',
  isActive: true,
  metaTemplateName: 'ciframais_vencimento_hoje',
  metaLanguage: 'pt_BR',
  category: 'UTILITY',
  metaStatus: 'APPROVED',
  metaRejectedReason: null,
  lastMetaSyncAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

function setup(): {
  service: TemplatesService;
  prisma: {
    globalMessageTemplate: Record<string, jest.Mock>;
    companyTemplatePreference: Record<string, jest.Mock>;
  };
} {
  const prisma = {
    globalMessageTemplate: {
      upsert: jest.fn().mockResolvedValue(globalTemplate),
      findMany: jest.fn().mockResolvedValue([globalTemplate]),
      findUnique: jest.fn().mockResolvedValue(globalTemplate),
      findFirst: jest.fn().mockResolvedValue(globalTemplate),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue(globalTemplate),
    },
    companyTemplatePreference: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const whatsapp = {
    buildMetaTemplateName: jest.fn((slug: string) => `ciframais_${slug}`),
    listOfficialTemplateStatuses: jest.fn().mockResolvedValue([]),
  };
  return {
    service: new TemplatesService(
      prisma as unknown as PrismaService,
      whatsapp as unknown as WhatsappService,
    ),
    prisma,
  };
}

describe('TemplatesService global catalog', () => {
  it('returns the approved global body with bounded tenant defaults', async () => {
    const { service } = setup();
    const result = await service.findAll('company-1');
    expect(result[0]).toMatchObject({
      id: 'global-1',
      greeting: 'Olá',
      instructions: expect.any(String) as string,
      signature: 'Equipe de cobrança',
    });
    expect(result[0]?.content).toContain('via CifraMais');
  });

  it('stores only safe personalization against the global model', async () => {
    const { service, prisma } = setup();
    await service.update('company-1', 'global-1', {
      greeting: 'Bom dia',
      instructions: 'Confira os dados antes do pagamento.',
      signature: 'Financeiro ACME',
      isActive: true,
    });
    expect(prisma.companyTemplatePreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          companyId: 'company-1',
          globalMessageTemplateId: 'global-1',
          greeting: 'Bom dia',
        }) as unknown,
      }),
    );
    expect(prisma.globalMessageTemplate.update).not.toHaveBeenCalled();
  });

  it('rejects links, variables and line breaks in tenant personalization', async () => {
    const { service } = setup();
    await expect(
      service.update('company-1', 'global-1', {
        instructions: 'Pague em https://fraude.invalid',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      service.update('company-1', 'global-1', { signature: '{{conteudo}}' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
