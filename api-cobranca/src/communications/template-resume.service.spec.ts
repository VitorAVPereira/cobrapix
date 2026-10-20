import { ConfigService } from '@nestjs/config';
import { TemplateResumeService } from './template-resume.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PaymentCryptoService } from '../payment/payment-crypto.service';
import type { OutboundIntentService } from './outbound-intent.service';
import type { TemplatePolicyService } from '../templates/template-policy.service';
import type { TemplateContextService } from '../templates/template-context.service';

function setup(review: Record<string, unknown>) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'review-1' }]),
    whatsappTemplateResumeReview: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(review),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    whatsappTemplatePendingSend: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const service = new TemplateResumeService(
    prisma as unknown as PrismaService,
    new ConfigService({}),
    {} as PaymentCryptoService,
    {} as OutboundIntentService,
    {} as TemplatePolicyService,
    {} as TemplateContextService,
  );
  return { service, tx };
}

const KEY = '8f7b2a52-5f8e-4d3b-9a51-2f4c6d9b1e10';

describe('TemplateResumeService.confirm', () => {
  it('same_confirmation_returns_same_successor from the persisted result', async () => {
    const result = {
      reviewId: 'review-1',
      intentIds: ['i'],
      closedPendingIds: [],
    };
    const { service, tx } = setup({
      id: 'review-1',
      confirmedAt: new Date(),
      confirmationKey: KEY,
      result,
    });
    await expect(service.confirm('review-1', KEY, 'admin')).resolves.toEqual(
      result,
    );
    expect(tx.whatsappTemplateResumeReview.update).not.toHaveBeenCalled();
  });

  it('refuses another key on a confirmed review and an expired preview', async () => {
    const confirmed = setup({
      id: 'review-1',
      confirmedAt: new Date(),
      confirmationKey: KEY,
      result: {},
    });
    await expect(
      confirmed.service.confirm(
        'review-1',
        '1f7b2a52-5f8e-4d3b-9a51-2f4c6d9b1e10',
        'admin',
      ),
    ).rejects.toMatchObject({ status: 409 });
    const expired = setup({
      id: 'review-1',
      confirmedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      items: [],
    });
    await expect(
      expired.service.confirm('review-1', KEY, 'admin'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REVIEW_EXPIRED' }) as unknown,
    });
  });

  it('requires a UUID idempotency key', async () => {
    const { service } = setup({});
    await expect(
      service.confirm('review-1', 'not-a-uuid', 'admin'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('limits a preview to 50 distinct holds', async () => {
    const { service } = setup({});
    await expect(
      service.preview([{ pendingId: 'a' }, { pendingId: 'a' }], 'admin'),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('TemplateResumeService selection on resume', () => {
  it('a held collection message resumes with the automatic template of its moment and the current method', async () => {
    const { service } = setup({});
    const tx = {
      collectionRuleStep: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ whatsappPurpose: 'BEFORE_DUE' }),
      },
      paymentCharge: {
        findFirst: jest.fn().mockResolvedValue({ billingMethod: 'BOLIX' }),
      },
    };
    const request = {
      logicalKey: 'collection:company-a:invoice-a:step-1:WHATSAPP',
      origin: 'COLLECTION',
      context: { companyId: 'company-a', invoiceId: 'invoice-a' },
      selection: {
        mode: 'AUTOMATIC',
        purpose: 'FIRST_OVERDUE',
        billingMethod: 'PIX',
        ruleStepId: 'step-1',
      },
      ruleStepId: 'step-1',
    };
    const selectionFor = (
      service as unknown as {
        selectionFor(tx: unknown, request: unknown): Promise<unknown>;
      }
    ).selectionFor.bind(service);
    // The charge was replaced by a BOLIX one: the method of the active charge applies.
    await expect(selectionFor(tx, request)).resolves.toEqual({
      mode: 'AUTOMATIC',
      purpose: 'FIRST_OVERDUE',
      billingMethod: 'BOLIX',
      ruleStepId: 'step-1',
    });
    expect(tx.paymentCharge.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-a',
        invoiceId: 'invoice-a',
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
      select: { billingMethod: true },
    });

    // A hold from before the change (explicit template on the step) also becomes automatic.
    await expect(
      selectionFor(tx, {
        ...request,
        selection: { mode: 'EXPLICIT', templateId: 'template-old' },
      }),
    ).resolves.toEqual({
      mode: 'AUTOMATIC',
      purpose: 'BEFORE_DUE',
      billingMethod: 'BOLIX',
      ruleStepId: 'step-1',
    });

    // Other origins keep their stored choice.
    const activation = {
      logicalKey: 'activation:company-a:1',
      origin: 'ACTIVATION',
      context: { companyId: 'company-a' },
      selection: { mode: 'DEFAULT', purpose: 'ACTIVATION_NOTICE' },
    };
    await expect(selectionFor(tx, activation)).resolves.toEqual(
      activation.selection,
    );
  });
});
