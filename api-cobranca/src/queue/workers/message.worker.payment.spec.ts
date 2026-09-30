import type { ConfigService } from '@nestjs/config';
import type { EmailQueueService } from '../../email/email.queue';
import type { EmailTemplatesService } from '../../email/email-templates.service';
import type { EmailService } from '../../email/email.service';
import type { PublicPaymentLinkService } from '../../payment/payment-link.service';
import type { PaymentService } from '../../payment/payment.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WhatsappService } from '../../whatsapp/whatsapp.service';
import type { InitialChargeJob, MessageQueueService } from '../message.queue';
import type { MessagingLimitService } from '../services/messaging-limit.service';
import type { RateLimitService } from '../services/rate-limit.service';
import type { SpintaxService } from '../services/spintax.service';
import { MessageWorkerService } from './message.worker';
import { TemplateSendPreparerService } from '../../templates/template-send-preparer.service';
import { TemplatePendingService } from '../../communications/template-pending.service';
import { HttpException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { toIssuanceError } from '../../payment/efi-issuance-error';

interface InitialChargeProcessor {
  processInitialChargeJob(data: InitialChargeJob): Promise<void>;
}

function fixture(financiallyActive: boolean): {
  process: InitialChargeProcessor;
  invoiceFindFirst: jest.Mock;
  logCreate: jest.Mock;
} {
  const invoiceFindFirst = jest.fn().mockResolvedValue(null);
  const logCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    invoice: { findFirst: invoiceFindFirst },
    collectionLog: { create: logCreate },
  } as unknown as PrismaService;
  const worker = new MessageWorkerService(
    {} as ConfigService,
    prisma,
    {} as RateLimitService,
    {} as MessagingLimitService,
    {
      hasActiveFinancialProfile: jest.fn().mockResolvedValue(financiallyActive),
    } as unknown as PaymentService,
    {} as SpintaxService,
    {} as MessageQueueService,
    {} as WhatsappService,
    {} as EmailQueueService,
    {} as EmailService,
    {} as EmailTemplatesService,
    {} as PublicPaymentLinkService,
    {} as TemplateSendPreparerService,
    {} as TemplatePendingService,
  );
  return {
    process: worker as unknown as InitialChargeProcessor,
    invoiceFindFirst,
    logCreate,
  };
}

describe('initial payment issuance fencing', () => {
  const job: InitialChargeJob = {
    invoiceId: 'invoice-1',
    companyId: 'company-1',
    source: 'MANUAL',
  };

  it('consumes a queued draft without issuing it and records why', async () => {
    const { process, invoiceFindFirst, logCreate } = fixture(false);
    await process.processInitialChargeJob(job);
    expect(invoiceFindFirst).not.toHaveBeenCalled();
    expect(logCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          invoiceId: 'invoice-1',
          actionType: 'INITIAL_CHARGE_SKIPPED',
        }) as unknown,
      }),
    );
  });

  it.each(['MANUAL', 'SELECTED'] as const)(
    'loads %s initial jobs from draft or pending invoices',
    async (source) => {
      const { process, invoiceFindFirst } = fixture(true);
      await process.processInitialChargeJob({ ...job, source });
      expect(invoiceFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'invoice-1',
            companyId: 'company-1',
            status: { in: ['DRAFT', 'PENDING'] },
          }) as unknown,
        }),
      );
    },
  );
});

describe('initial charge sent by the user versus the automatic first charge', () => {
  const draft = {
    id: 'invoice-1',
    companyId: 'company-1',
    originalAmount: 5,
    dueDate: new Date('2026-10-10T03:00:00.000Z'),
    gatewayId: null,
    pixPayload: null,
    pixExpiresAt: null,
    efiTxid: null,
    efiChargeId: null,
    efiPixCopiaECola: null,
    boletoLinhaDigitavel: null,
    boletoLink: null,
    boletoPdf: null,
    billingType: 'BOLIX',
    debtor: {
      id: 'debtor-1',
      name: 'Maria Silva',
      phoneNumber: '+5511987654321',
      email: null,
      whatsappOptIn: true,
      useGlobalBillingSettings: false,
      preferredBillingMethod: null,
      // Automatic first charge disabled for this debtor.
      autoGenerateFirstCharge: false,
    },
    company: {
      corporateName: 'Empresa',
      tradeName: null,
      preferredBillingMethod: 'BOLIX',
      autoGenerateFirstCharge: true,
      whatsappStatus: 'CONNECTED',
      whatsappInstanceId: null,
    },
    collectionLogs: [],
  };

  function fixture(createPayment: jest.Mock) {
    const logCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(draft) },
      collectionLog: { create: logCreate },
    } as unknown as PrismaService;
    const worker = new MessageWorkerService(
      { get: jest.fn() } as unknown as ConfigService,
      prisma,
      {} as RateLimitService,
      {} as MessagingLimitService,
      {
        hasActiveFinancialProfile: jest.fn().mockResolvedValue(true),
        createPayment,
      } as unknown as PaymentService,
      {} as SpintaxService,
      {} as MessageQueueService,
      {} as WhatsappService,
      {} as EmailQueueService,
      {} as EmailService,
      {} as EmailTemplatesService,
      {} as PublicPaymentLinkService,
      {} as TemplateSendPreparerService,
      {} as TemplatePendingService,
    );
    const actions = () =>
      (logCreate.mock.calls as Array<[{ data: { actionType: string } }]>).map(
        ([call]) => call.data.actionType,
      );
    return {
      process: worker as unknown as InitialChargeProcessor,
      actions,
    };
  }

  const job = (source: InitialChargeJob['source']): InitialChargeJob => ({
    invoiceId: 'invoice-1',
    companyId: 'company-1',
    source,
    ...(source === 'SELECTED' ? { requestId: '1' } : {}),
  });

  it.each(['MANUAL', 'CSV', 'RECURRING'] as const)(
    'keeps the %s automatic first charge off when disabled',
    async (source) => {
      const createPayment = jest.fn();
      const { process, actions } = fixture(createPayment);
      await process.processInitialChargeJob(job(source));
      expect(createPayment).not.toHaveBeenCalled();
      expect(actions()).toEqual(['INITIAL_CHARGE_SKIPPED']);
    },
  );

  it('still issues a charge the user selected to send', async () => {
    const createPayment = jest.fn().mockRejectedValue(new Error('stop here'));
    const { process } = fixture(createPayment);
    await expect(
      process.processInitialChargeJob(job('SELECTED')),
    ).rejects.toThrow('stop here');
    expect(createPayment).toHaveBeenCalledWith(
      'invoice-1',
      'company-1',
      'BOLIX',
    );
  });

  it.each([
    [
      'a refusal by Efí',
      toIssuanceError(
        {
          code: 3500034,
          error: 'validation_error',
          error_description: {
            property: '/payment/banking_billet/customer/phone_number',
          },
        },
        'PROVIDER_REQUEST',
      ),
    ],
    [
      'an issuance awaiting reconciliation',
      new HttpException(
        { code: 'EFI_SUBMISSION_UNCERTAIN', message: 'x' },
        409,
      ),
    ],
  ])(
    'records %s and never lets the queue issue it again',
    async (_case, failure) => {
      const createPayment = jest.fn().mockRejectedValue(failure);
      const { process, actions } = fixture(createPayment);
      await expect(
        process.processInitialChargeJob(job('SELECTED')),
      ).rejects.toBeInstanceOf(UnrecoverableError);
      expect(actions()).toEqual(['INITIAL_CHARGE_PAYMENT_FAILED']);
      expect(createPayment).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps a transient failure retryable by the queue', async () => {
    const createPayment = jest
      .fn()
      .mockRejectedValue(new Error('connection reset'));
    const { process } = fixture(createPayment);
    const error: unknown = await process
      .processInitialChargeJob(job('SELECTED'))
      .catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });
});
