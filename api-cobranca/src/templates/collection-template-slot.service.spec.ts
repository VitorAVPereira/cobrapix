import { CollectionTemplateSlotService } from './collection-template-slot.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TemplatePolicyService } from './template-policy.service';
import type { TemplateMapping } from './template-contracts';

const linkOnly: TemplateMapping = {
  body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' } },
  paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
};
const withPix: TemplateMapping = {
  body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' } },
  pixButton: { index: 1, source: 'PIX_COPY_PASTE' },
};

function ready(mapping: TemplateMapping) {
  return { ready: true, template: {}, parsed: {}, mapping };
}

function setup(row: { templateId: string | null; version: number }) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'slot-1', ...row }]),
    collectionTemplateSlot: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({ version: row.version + 1 }),
    },
    whatsappTemplateAudit: { create: jest.fn() },
  };
  const policy = {
    readiness: jest.fn().mockResolvedValue(ready(linkOnly)),
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
    collectionTemplateSlot: { findMany: jest.fn().mockResolvedValue([]) },
    globalMessageTemplate: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return {
    service: new CollectionTemplateSlotService(
      prisma as unknown as PrismaService,
      policy as unknown as TemplatePolicyService,
    ),
    tx,
    policy,
    prisma,
  };
}

describe('CollectionTemplateSlotService', () => {
  it('answers 409 to a stale expected version without writing', async () => {
    const { service, tx } = setup({ templateId: null, version: 2 });
    await expect(
      service.set('DUE_TODAY', 'PIX', 'template-1', 1, 'admin'),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.collectionTemplateSlot.update).not.toHaveBeenCalled();
    expect(tx.whatsappTemplateAudit.create).not.toHaveBeenCalled();
  });

  it('refuses a template that is not ready', async () => {
    const { service, tx, policy } = setup({ templateId: null, version: 0 });
    policy.readiness.mockResolvedValue({ ready: false, code: 'NOT_APPROVED' });
    await expect(
      service.set('DUE_TODAY', 'PIX', 'template-1', 0, 'admin'),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.collectionTemplateSlot.update).not.toHaveBeenCalled();
  });

  it('refuses a Pix template for the card: a card charge has no Pix code', async () => {
    const { service, tx, policy } = setup({ templateId: null, version: 0 });
    policy.readiness.mockResolvedValue(ready(withPix));
    await expect(
      service.set('BEFORE_DUE', 'CREDIT_CARD', 'template-pix', 0, 'admin'),
    ).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({
        code: 'METHOD_INCOMPATIBLE',
      }) as unknown,
    });
    expect(tx.collectionTemplateSlot.update).not.toHaveBeenCalled();
  });

  it('saves a fitting template with the next version and an audit record', async () => {
    const { service, tx } = setup({ templateId: null, version: 0 });
    await expect(
      service.set('FIRST_OVERDUE', 'CREDIT_CARD', 'template-link', 0, 'admin'),
    ).resolves.toEqual({ version: 1 });
    expect(tx.collectionTemplateSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: {
        templateId: 'template-link',
        version: { increment: 1 },
        updatedByUserId: 'admin',
      },
      select: { version: true },
    });
    expect(tx.whatsappTemplateAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'COLLECTION_SLOT_CHANGED',
        actorUserId: 'admin',
        details: expect.objectContaining({
          purpose: 'FIRST_OVERDUE',
          billingMethod: 'CREDIT_CARD',
          previousTemplateId: null,
        }) as unknown,
      }) as unknown,
    });
  });

  it('clears a slot without checking any template', async () => {
    const { service, policy } = setup({ templateId: 'template-1', version: 3 });
    await expect(
      service.set('DUE_TODAY', 'BOLIX', null, 3, 'admin'),
    ).resolves.toEqual({ version: 4 });
    expect(policy.readiness).not.toHaveBeenCalled();
  });

  it('does not bump the version when nothing changes', async () => {
    const { service, tx } = setup({ templateId: 'template-1', version: 5 });
    await expect(
      service.set('DUE_TODAY', 'PIX', 'template-1', 5, 'admin'),
    ).resolves.toEqual({ version: 5 });
    expect(tx.collectionTemplateSlot.update).not.toHaveBeenCalled();
  });

  it('lists the 18 slots and offers each method only the templates that fit it', async () => {
    const { service, prisma, policy } = setup({ templateId: null, version: 0 });
    prisma.globalMessageTemplate.findMany.mockResolvedValue([
      {
        id: 'pix',
        name: 'pix',
        metaTemplateName: 'lembrete_pix',
        metaLanguage: 'pt_BR',
      },
      {
        id: 'link',
        name: 'link',
        metaTemplateName: 'lembrete_link',
        metaLanguage: 'pt_BR',
      },
    ]);
    prisma.collectionTemplateSlot.findMany.mockResolvedValue([
      {
        purpose: 'BEFORE_DUE',
        billingMethod: 'PIX',
        templateId: 'pix',
        version: 2,
        template: { metaTemplateName: 'lembrete_pix', name: 'pix' },
      },
    ]);
    policy.readiness.mockImplementation((_tx: unknown, id: string) =>
      Promise.resolve(ready(id === 'pix' ? withPix : linkOnly)),
    );

    const view = await service.list();

    expect(view.slots).toHaveLength(18);
    expect(view.slots).toContainEqual({
      purpose: 'BEFORE_DUE',
      billingMethod: 'PIX',
      templateId: 'pix',
      templateName: 'lembrete_pix',
      version: 2,
      available: { ready: true, code: null },
    });
    expect(view.slots).toContainEqual(
      expect.objectContaining({
        purpose: 'EMISSION',
        billingMethod: 'CREDIT_CARD',
        templateId: null,
        version: 0,
        available: { ready: false, code: 'DEFAULT_MISSING' },
      }),
    );
    expect(view.options.PIX.map((option) => option.id)).toEqual([
      'pix',
      'link',
    ]);
    expect(view.options.BOLIX.map((option) => option.id)).toEqual([
      'pix',
      'link',
    ]);
    expect(view.options.CREDIT_CARD.map((option) => option.id)).toEqual([
      'link',
    ]);
    // Each template is checked once even when it is also in a slot.
    expect(policy.readiness).toHaveBeenCalledTimes(2);
  });
});
