import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { TemplateCatalogQueryService } from './template-catalog-query.service';
import type { TemplatePolicyService } from './template-policy.service';

function setup() {
  const prisma = {
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run({})),
    globalMessageTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ metaProviderCategory: 'UTILITY' }),
    },
    companyWhatsappTemplateGrant: { findMany: jest.fn() },
    companyWhatsappTemplateDefault: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const policy = { evaluate: jest.fn() };
  const service = new TemplateCatalogQueryService(
    prisma as unknown as PrismaService,
    new ConfigService({ FRONTEND_URL: 'https://app.test' }),
    policy as unknown as TemplatePolicyService,
  );
  return { service, prisma, policy };
}

const allowed = (name: string) => ({
  allowed: true,
  template: {
    name,
    language: 'pt_BR',
    parsed: {
      body: 'Olá {{1}}',
      footer: null,
      paymentButton: null,
      pixButton: null,
      boletoButton: null,
      quickReplies: [],
    },
  },
});

describe('TemplateCatalogQueryService', () => {
  it('keeps the UNAVAILABLE condition when searching and counts the same filter', async () => {
    const { service, prisma } = setup();
    await expect(
      service.adminCatalog({ status: 'UNAVAILABLE', search: ' cobranca ' }),
    ).resolves.toEqual({ items: [], nextCursor: null, total: 0 });
    const [{ where }] = prisma.globalMessageTemplate.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(where).toEqual({
      origin: 'META_IMPORTED',
      OR: [{ metaStatus: { not: 'APPROVED' } }, { archivedAt: { not: null } }],
      AND: [
        {
          OR: [
            { metaTemplateName: { contains: 'cobranca', mode: 'insensitive' } },
            { name: { contains: 'cobranca', mode: 'insensitive' } },
          ],
        },
      ],
    });
    expect(prisma.globalMessageTemplate.count).toHaveBeenCalledWith({ where });
  });

  it('searches only the company grants, by the approved name, in name order', async () => {
    const { service, prisma, policy } = setup();
    prisma.companyWhatsappTemplateGrant.findMany.mockResolvedValue([
      { templateId: 't1' },
      { templateId: 't2' },
      { templateId: 't3' },
    ]);
    // t2 is granted but not usable now: it is neither listed nor counted.
    policy.evaluate.mockImplementation(
      (_tx: unknown, _company: string, id: string) =>
        Promise.resolve(
          id === 't2' ? { allowed: false } : allowed(`modelo_${id}`),
        ),
    );
    const first = await service.companyCatalog('company-a', {
      limit: 1,
      search: 'modelo',
    });
    expect(prisma.companyWhatsappTemplateGrant.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-a',
        enabled: true,
        template: {
          metaTemplateName: { contains: 'modelo', mode: 'insensitive' },
        },
      },
      orderBy: [
        { template: { metaTemplateName: 'asc' } },
        { templateId: 'asc' },
      ],
      select: { templateId: true },
    });
    expect(first).toMatchObject({
      items: [{ id: 't1', name: 'modelo_t1' }],
      nextCursor: 't1',
      total: 2,
    });
    const second = await service.companyCatalog('company-a', {
      limit: 1,
      search: 'modelo',
      cursor: 't1',
    });
    expect(second).toMatchObject({
      items: [{ id: 't3' }],
      nextCursor: null,
      total: 2,
    });
  });

  it('lists every company grant when there is no search', async () => {
    const { service, prisma } = setup();
    prisma.companyWhatsappTemplateGrant.findMany.mockResolvedValue([]);
    await service.companyCatalog('company-a', { search: '  ' });
    const [{ where }] = prisma.companyWhatsappTemplateGrant.findMany.mock
      .calls[0] as [{ where: Record<string, unknown> }];
    expect(where).toEqual({ companyId: 'company-a', enabled: true });
  });
});

describe('TemplateCatalogQueryService collection templates of a company', () => {
  const ready = {
    allowed: true,
    template: {
      name: 'lembrete_pix',
      language: 'pt_BR',
      parsed: {
        body: 'Olá {{1}}, sua cobrança vence em breve.',
        parameterFormat: 'POSITIONAL',
        variables: ['1'],
        footer: 'Caso já tenha pago, desconsidere.',
        paymentButton: null,
        pixButton: { index: 0, label: 'Copiar código Pix' },
        boletoButton: null,
        quickReplies: [],
        fingerprint: 'f',
      },
      mapping: {
        body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' } },
        pixButton: { index: 0, source: 'PIX_COPY_PASTE' },
      },
    },
  };

  it('shows the 18 moments with a fictitious preview and only this company custom ones', async () => {
    const { service, prisma } = setup();
    Object.assign(prisma, {
      collectionTemplateSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            purpose: 'BEFORE_DUE',
            billingMethod: 'PIX',
            templateId: 'tpl-pix',
          },
        ]),
      },
      collectionStepTemplateOverride: {
        findMany: jest.fn().mockResolvedValue([
          {
            ruleStepId: 'step-2',
            billingMethod: 'PIX',
            templateId: 'tpl-pix',
            ruleStep: {
              profile: {
                name: 'Novo Cliente',
                steps: [
                  { id: 'step-1', delayDays: -2 },
                  { id: 'step-2', delayDays: 5 },
                ],
              },
            },
          },
        ]),
      },
    });
    const evaluateGlobal = jest.fn().mockResolvedValue(ready);
    Object.assign((service as unknown as { policy: object }).policy, {
      evaluateGlobal,
    });

    const view = await service.companyCollectionTemplates('company-a');

    expect(view.moments).toHaveLength(18);
    expect(view.moments).toContainEqual({
      purpose: 'BEFORE_DUE',
      billingMethod: 'PIX',
      template: {
        name: 'lembrete_pix',
        content: expect.objectContaining({
          body: 'Olá {{1}}, sua cobrança vence em breve.',
          pixButton: { index: 0, label: 'Copiar código Pix' },
        }) as unknown,
        previewBody: 'Olá Maria Exemplo, sua cobrança vence em breve.',
      },
    });
    expect(view.moments).toContainEqual({
      purpose: 'EMISSION',
      billingMethod: 'CREDIT_CARD',
      template: null,
    });
    expect(view.custom).toEqual([
      expect.objectContaining({
        ruleStepId: 'step-2',
        profileName: 'Novo Cliente',
        scheduleDay: 3,
      }),
    ]);
    const overrides = (
      prisma as unknown as {
        collectionStepTemplateOverride: { findMany: jest.Mock };
      }
    ).collectionStepTemplateOverride.findMany;
    expect(overrides).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-a', ruleStep: { isActive: true } },
      }),
    );
    // The same template is evaluated once.
    expect(evaluateGlobal).toHaveBeenCalledTimes(1);
  });
});
