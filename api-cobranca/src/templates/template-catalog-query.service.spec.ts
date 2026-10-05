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
