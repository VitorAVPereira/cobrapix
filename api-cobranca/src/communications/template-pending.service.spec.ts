import { Prisma } from '@prisma/client';
import { TemplatePendingService } from './template-pending.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TemplatePolicyService } from '../templates/template-policy.service';
import type { TemplateSendRequest } from '../templates/template-contracts';

const request: TemplateSendRequest = {
  logicalKey: 'collection:company-a:invoice-a:step-1:WHATSAPP',
  origin: 'COLLECTION',
  context: { companyId: 'company-a', invoiceId: 'invoice-a' },
  selection: { mode: 'DEFAULT', purpose: 'DUE_TODAY' },
  ruleStepId: 'step-1',
};

function tx(existing: Record<string, unknown> | null, heldCount = 0) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    communicationOutboundIntent: {
      updateMany: jest.fn().mockResolvedValue({ count: heldCount }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ messageId: 'message-1' }),
    },
    communicationMessage: { updateMany: jest.fn() },
    collectionAttempt: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    whatsappTemplatePendingSend: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({
        id: 'pending-1',
        version: 1,
        state: 'BLOCKED',
        currentIntentId: null,
      }),
      update: jest.fn(),
    },
    whatsappTemplateAudit: { create: jest.fn() },
  };
}

const service = new TemplatePendingService(
  {} as PrismaService,
  {} as TemplatePolicyService,
);

describe('TemplatePendingService.block', () => {
  it('holds a never-claimed intent and marks the rule step attempt as blocked', async () => {
    const client = tx(null, 1);
    await service.block(client as unknown as Prisma.TransactionClient, {
      request,
      code: 'DEFAULT_MISSING',
      intentId: 'intent-1',
    });
    expect(client.communicationOutboundIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'intent-1' }) as unknown,
        data: expect.objectContaining({ state: 'BLOCKED' }) as unknown,
      }),
    );
    expect(client.collectionAttempt.createMany).toHaveBeenCalledWith({
      data: {
        companyId: 'company-a',
        invoiceId: 'invoice-a',
        ruleStepId: 'step-1',
        channel: 'WHATSAPP',
        status: 'BLOCKED',
      },
      skipDuplicates: true,
    });
    expect(client.whatsappTemplatePendingSend.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentIntentId: 'intent-1',
          code: 'DEFAULT_MISSING',
        }) as unknown,
      }),
    );
  });

  it('does not link an intent another worker is sending', async () => {
    const client = tx(null, 0);
    await service.block(client as unknown as Prisma.TransactionClient, {
      request,
      code: 'NOT_GRANTED',
      intentId: 'intent-sending',
    });
    expect(client.whatsappTemplatePendingSend.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentIntentId: null }) as unknown,
      }),
    );
  });

  it('keeps a closed hold closed', async () => {
    const client = tx({
      id: 'pending-1',
      version: 3,
      state: 'CLOSED',
      currentIntentId: null,
    });
    await expect(
      service.block(client as unknown as Prisma.TransactionClient, {
        request,
        code: 'NOT_GRANTED',
      }),
    ).resolves.toEqual({
      id: 'pending-1',
      version: 3,
      state: 'CLOSED',
      currentIntentId: null,
    });
    expect(client.whatsappTemplatePendingSend.update).not.toHaveBeenCalled();
  });
});
