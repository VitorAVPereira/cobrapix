import { CollectionStepTemplateService } from './collection-step-template.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TemplatePolicyService } from './template-policy.service';

function setup(options: { step?: boolean; previous?: string | null } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    collectionRuleStep: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.step === false ? null : { id: 'step-1' }),
    },
    collectionStepTemplateOverride: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.previous ? { templateId: options.previous } : null,
        ),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    whatsappTemplateAudit: { create: jest.fn() },
  };
  const policy = {
    readiness: jest.fn().mockResolvedValue({
      ready: true,
      mapping: {
        body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' } },
        pixButton: { index: 1, source: 'PIX_COPY_PASTE' },
      },
    }),
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  return {
    service: new CollectionStepTemplateService(
      prisma as unknown as PrismaService,
      policy as unknown as TemplatePolicyService,
    ),
    tx,
    policy,
  };
}

describe('CollectionStepTemplateService', () => {
  it('a step of another company is not found', async () => {
    const { service, tx } = setup({ step: false });
    await expect(
      service.set('company-b', 'step-1', 'PIX', 'template-1', 'admin'),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.collectionRuleStep.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'step-1',
        channel: 'WHATSAPP',
        profile: { companyId: 'company-b' },
      },
      select: { id: true },
    });
    expect(tx.collectionStepTemplateOverride.upsert).not.toHaveBeenCalled();
  });

  it('links a fitting template to the step and audits it', async () => {
    const { service, tx } = setup();
    await expect(
      service.set('company-a', 'step-1', 'PIX', 'template-1', 'admin'),
    ).resolves.toEqual({ templateId: 'template-1' });
    expect(tx.collectionStepTemplateOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          companyId: 'company-a',
          ruleStepId: 'step-1',
          billingMethod: 'PIX',
          templateId: 'template-1',
        }) as unknown,
      }),
    );
    expect(tx.whatsappTemplateAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'COLLECTION_STEP_TEMPLATE_CHANGED',
      }) as unknown,
    });
  });

  it('refuses a Pix template for the card', async () => {
    const { service, tx } = setup();
    await expect(
      service.set('company-a', 'step-1', 'CREDIT_CARD', 'template-1', 'admin'),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.collectionStepTemplateOverride.upsert).not.toHaveBeenCalled();
  });

  it('removing the custom template returns the step to the global one', async () => {
    const { service, tx, policy } = setup({ previous: 'template-1' });
    await expect(
      service.set('company-a', 'step-1', 'PIX', null, 'admin'),
    ).resolves.toEqual({ templateId: null });
    expect(tx.collectionStepTemplateOverride.deleteMany).toHaveBeenCalledWith({
      where: { ruleStepId: 'step-1', billingMethod: 'PIX' },
    });
    expect(policy.readiness).not.toHaveBeenCalled();
  });
});
