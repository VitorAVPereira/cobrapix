import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Job, Queue } from 'bullmq';
import { QueueController } from './queue.controller';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import type { MessageQueueService, WhatsAppQueueJob } from './message.queue';
import type { PrismaService } from '../prisma/prisma.service';

function setup(
  job: { name: string; data: unknown } | null,
  intentState?: string,
) {
  const retry = jest.fn().mockResolvedValue(undefined);
  jest.spyOn(Job, 'fromId').mockResolvedValue(
    job
      ? ({
          ...job,
          getState: jest.fn().mockResolvedValue('failed'),
          retry,
        } as unknown as Job)
      : undefined,
  );
  const prisma = {
    communicationOutboundIntent: {
      findUnique: jest
        .fn()
        .mockResolvedValue(intentState ? { state: intentState } : null),
    },
    whatsappTemplatePendingSend: {
      findUnique: jest.fn().mockResolvedValue({ state: 'BLOCKED' }),
    },
  };
  const controller = new QueueController(
    {} as Queue<WhatsAppQueueJob>,
    {} as MessageQueueService,
    prisma as unknown as PrismaService,
  );
  return { controller, retry };
}

describe('QueueController', () => {
  afterEach(() => jest.restoreAllMocks());

  it('queue_retry_cannot_resume_hold: a blocked intent answers 409 even to the admin', async () => {
    const { controller, retry } = setup(
      { name: 'outbound-intent', data: { intentId: 'intent-1' } },
      'BLOCKED',
    );
    await expect(controller.retryJob('job-1')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'OUTBOUND_BLOCKED',
      }) as unknown,
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it('never retries accepted or uncertain intents', async () => {
    for (const state of ['ACCEPTED', 'UNCERTAIN', 'SENDING']) {
      const { controller, retry } = setup(
        { name: 'outbound-intent', data: { intentId: 'intent-1' } },
        state,
      );
      await expect(controller.retryJob('job-1')).rejects.toMatchObject({
        status: 409,
      });
      expect(retry).not.toHaveBeenCalled();
    }
  });

  it('refuses a legacy send-message job whose communication is held', async () => {
    const { controller, retry } = setup({
      name: 'send-message',
      data: { companyId: 'c', invoiceId: 'i', ruleStepId: 's' },
    });
    await expect(controller.retryJob('job-1')).rejects.toMatchObject({
      status: 409,
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries a failed job of a still pending intent', async () => {
    const { controller, retry } = setup(
      { name: 'outbound-intent', data: { intentId: 'intent-1' } },
      'PENDING',
    );
    await expect(controller.retryJob('job-1')).resolves.toEqual({
      success: true,
      jobId: 'job-1',
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('restricts global queue controls to the platform admin', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      QueueController,
    ) as unknown[];
    expect(guards).toContain(PlatformAdminGuard);
    const retryAsCompany = () =>
      new PlatformAdminGuard().canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ user: { role: 'COMPANY_ADMIN' } }),
        }),
      } as unknown as ExecutionContext);
    expect(retryAsCompany).toThrow(
      expect.objectContaining({ status: 403 }) as unknown as Error,
    );
  });
});
