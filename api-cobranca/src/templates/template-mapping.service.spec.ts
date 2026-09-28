import { ConfigService } from '@nestjs/config';
import { TemplateMappingService } from './template-mapping.service';
import { templateFingerprint } from './template-components';
import type { PrismaService } from '../prisma/prisma.service';
import type { TemplateMapping } from './template-contracts';

const components = [
  { type: 'BODY', text: 'Olá {{1}}, valor {{2}}.' },
  {
    type: 'BUTTONS',
    buttons: [
      { type: 'URL', text: 'Pagar', url: 'https://app.test/pagar/{{1}}' },
    ],
  },
];
const template = {
  id: 'template-1',
  origin: 'META_IMPORTED',
  archivedAt: null,
  supportReason: null,
  providerRevision: 2,
  mappingRevision: 1,
  metaComponents: components,
  parameterFormat: 'POSITIONAL',
  metaLanguage: 'pt_BR',
  metaProviderCategory: 'UTILITY',
  providerFingerprint: templateFingerprint({
    components,
    parameterFormat: 'POSITIONAL',
    language: 'pt_BR',
    category: 'UTILITY',
  }),
};
const mapping: TemplateMapping = {
  body: {
    '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' },
    '2': { kind: 'SOURCE', source: 'AMOUNT' },
  },
  paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
};

function setup(row: Record<string, unknown> = template) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    globalMessageTemplate: {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    whatsappTemplateMappingRevision: { create: jest.fn() },
    whatsappTemplateAudit: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const service = new TemplateMappingService(
    prisma as unknown as PrismaService,
    new ConfigService({ FRONTEND_URL: 'https://app.test' }),
  );
  return { service, tx };
}

describe('TemplateMappingService', () => {
  it('saves an immutable revision against the reviewed provider revision', async () => {
    const { service, tx } = setup();
    await expect(
      service.save('template-1', 2, 1, mapping, 'admin-1'),
    ).resolves.toEqual({ mappingRevision: 2 });
    expect(tx.whatsappTemplateMappingRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateId: 'template-1',
        revision: 2,
        providerRevision: 2,
        createdByUserId: 'admin-1',
      }) as unknown,
    });
    expect(tx.globalMessageTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 'template-1', providerRevision: 2, mappingRevision: 1 },
      data: expect.objectContaining({
        mappingRevision: 2,
        metaReviewRequired: false,
      }) as unknown,
    });
  });

  it('answers 409 when the admin saw another provider or mapping revision', async () => {
    const { service, tx } = setup();
    await expect(
      service.save('template-1', 1, 1, mapping, 'admin-1'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.save('template-1', 2, 0, mapping, 'admin-1'),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.whatsappTemplateMappingRevision.create).not.toHaveBeenCalled();
  });

  it('rejects incomplete maps and unsupported formats', async () => {
    const { service } = setup();
    await expect(
      service.save('template-1', 2, 1, { body: mapping.body }, 'admin-1'),
    ).rejects.toMatchObject({ status: 400 });
    const unsupported = setup({ ...template, supportReason: 'HEADER' });
    await expect(
      unsupported.service.save('template-1', 2, 1, mapping, 'admin-1'),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('previews with synthetic data only', async () => {
    const { service, tx } = setup();
    await expect(service.preview('template-1', mapping)).resolves.toEqual({
      ok: true,
      body: 'Olá Maria Exemplo, valor R$ 150,00.',
      bodyParameters: ['Maria Exemplo', 'R$ 150,00'],
      paymentButtonSuffix: 'exemplo-token',
    });
    expect(tx.globalMessageTemplate.updateMany).not.toHaveBeenCalled();
  });
});
