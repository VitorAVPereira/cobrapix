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
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
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

  describe('confirmReview', () => {
    const provider = {
      id: 'meta-1',
      name: 'ciframais_vencimento_hoje',
      language: 'pt_BR',
      status: 'APPROVED',
      category: 'UTILITY',
      rejectedReason: null,
      components: [
        {
          type: 'BODY',
          text: '{{1}}, cobrança de {{2}} via CifraMais. {{3}} {{4}}',
        },
        { type: 'FOOTER', text: 'Atendimento central CifraMais.' },
        {
          type: 'BUTTONS',
          buttons: [
            {
              type: 'URL',
              text: 'Abrir pagamento',
              url: 'https://app.test/pagar/{{1}}',
            },
          ],
        },
      ],
    };
    function reviewSetup(status: unknown, count = 1) {
      const context = setup();
      const whatsapp = (
        context.service as unknown as {
          whatsappService: { listOfficialTemplateStatuses: jest.Mock };
        }
      ).whatsappService;
      whatsapp.listOfficialTemplateStatuses.mockResolvedValue(
        status ? [status] : [],
      );
      const updateMany = jest.fn().mockResolvedValue({ count });
      context.prisma.globalMessageTemplate.updateMany = updateMany;
      return { ...context, updateMany };
    }

    it('releases the review when the provider version matches the local template', async () => {
      const { service, updateMany } = reviewSetup(provider);
      await service.confirmReview('company-1', 'global-1');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'global-1', updatedAt: globalTemplate.updatedAt },
          data: expect.objectContaining({
            metaReviewRequired: false,
          }) as unknown,
        }),
      );
    });

    it.each([
      [{ ...provider, category: 'MARKETING' }, /categoria/],
      [
        {
          ...provider,
          components: [
            { type: 'BODY', text: 'Oferta {{1}} {{2}} {{3}} {{4}}' },
          ],
        },
        /conteúdo/,
      ],
      [null, /não encontrado/],
    ])(
      'keeps the template blocked and explains why',
      async (status, reason) => {
        const { service, updateMany } = reviewSetup(status);
        await expect(
          service.confirmReview('company-1', 'global-1'),
        ).rejects.toThrow(reason);
        const calls = updateMany.mock.calls as Array<
          [{ data: { metaReviewRequired: boolean } }]
        >;
        expect(calls.every(([args]) => args.data.metaReviewRequired)).toBe(
          true,
        );
      },
    );

    it('never releases over a concurrent provider change', async () => {
      const { service } = reviewSetup(provider, 0);
      await expect(
        service.confirmReview('company-1', 'global-1'),
      ).rejects.toThrow(/alterado/);
    });
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
