# Cancelar Cobranca Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-facing option to cancel pending invoices, preserving the invoice row as canceled and preventing future payment generation or notifications for that invoice.

**Architecture:** Keep the business rule in `InvoicesService`, delegate gateway cancellation to `PaymentService`/`EfiService`, and add final send-time guards in WhatsApp and email workers. The frontend adds a pending-only row action that calls a typed API client method and refreshes the list after success.

**Tech Stack:** NestJS, Prisma, Efí SDK `sdk-node-apis-efi`, BullMQ, Resend email queue, Next.js App Router, React, Jest, Testing Library.

**User Preference:** Do not commit during implementation. Leave changed files in the workspace for the user to review and commit.

---

## File Map

- Modify `api-cobranca/src/types/sdk-node-apis-efi.d.ts`: add Efí SDK typings for `pixUpdateDueCharge` and `cancelCharge`.
- Modify `api-cobranca/src/payment/efi.service.ts`: add public methods to cancel Pix CobV and boleto/Bolix charges.
- Modify `api-cobranca/src/payment/payment.service.ts`: block payment creation for non-pending invoices and expose a cancellation coordinator for invoices that already have Efí identifiers.
- Modify `api-cobranca/src/payment/payment.service.spec.ts`: TDD tests for create-payment guard and cancellation delegation.
- Modify `api-cobranca/src/invoices/invoices.module.ts`: import `PaymentModule` so `InvoicesService` can inject `PaymentService`.
- Modify `api-cobranca/src/invoices/invoices.service.ts`: add `cancelInvoice(companyId, invoiceId)` and return the existing invoice list shape.
- Modify `api-cobranca/src/invoices/invoices.controller.ts`: add authenticated `POST /invoices/:invoiceId/cancel`.
- Modify `api-cobranca/src/invoices/invoices.service.spec.ts`: TDD tests for local cancel, gateway cancel, gateway failure, and non-pending rejection.
- Modify `api-cobranca/src/queue/workers/message.worker.ts`: skip WhatsApp sends and email fallback when an old job finds a non-pending invoice.
- Modify `api-cobranca/src/queue/workers/message.worker.spec.ts`: TDD test for skipped WhatsApp job.
- Modify `api-cobranca/src/email/email.service.ts`: skip Resend sends when an old email job finds a non-pending invoice.
- Modify `api-cobranca/src/email/email.service.spec.ts`: TDD test for skipped email job.
- Modify `front-cobranca/src/lib/api-client.ts`: add typed `cancelInvoice(invoiceId)` method.
- Modify `front-cobranca/src/components/features/InvoiceTable.tsx`: add pending-only cancel action.
- Create `front-cobranca/src/components/features/__tests__/InvoiceTable.test.tsx`: TDD tests for cancel action availability.
- Modify `front-cobranca/src/app/(dashboard)/cobrancas/page.tsx`: add cancel handler, confirmation, success/error feedback, and pass handler to `InvoiceTable`.

---

### Task 1: Efí SDK Typings And Gateway Cancellation

**Files:**
- Modify: `api-cobranca/src/types/sdk-node-apis-efi.d.ts`
- Modify: `api-cobranca/src/payment/efi.service.ts`

- [ ] **Step 1: Add SDK typing test coverage through PaymentService tests later**

No separate runtime test is needed for the `.d.ts` file. Type-checking happens through `npm run build` after `PaymentService` calls these methods in Task 2.

- [ ] **Step 2: Update Efí SDK type declarations**

In `api-cobranca/src/types/sdk-node-apis-efi.d.ts`, add these interfaces near the other Pix/charge response interfaces:

```ts
  interface PixUpdateDueChargeBody {
    status?: 'REMOVIDA_PELO_USUARIO_RECEBEDOR';
  }

  interface CancelChargeResponse {
    code?: number;
  }
```

Then add these methods to the exported `EfiPay` class:

```ts
    pixUpdateDueCharge(
      params: { txid: string },
      body: PixUpdateDueChargeBody,
    ): Promise<PixDueChargeResponse>;

    cancelCharge(params: { id: string | number }): Promise<CancelChargeResponse>;
```

- [ ] **Step 3: Add gateway cancellation methods in EfiService**

In `api-cobranca/src/payment/efi.service.ts`, add these public methods after `createPayment`:

```ts
  async cancelPixDueCharge(companyId: string, txid: string): Promise<string> {
    const gatewayAccount = await this.getActiveGatewayAccount(companyId);
    this.ensurePixCertificate(gatewayAccount);

    const client = this.createSdkClient(gatewayAccount);
    const response = await this.runEfiRequest(
      () =>
        client.pixUpdateDueCharge(
          { txid },
          { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' },
        ),
      'cancelar Pix CobV',
    );

    return response.status ?? 'REMOVIDA_PELO_USUARIO_RECEBEDOR';
  }

  async cancelCharge(companyId: string, chargeId: string): Promise<string> {
    const gatewayAccount = await this.getActiveGatewayAccount(companyId);
    const client = this.createSdkClient(gatewayAccount);

    await this.runEfiRequest(
      () => client.cancelCharge({ id: chargeId }),
      'cancelar boleto/Bolix',
    );

    return 'canceled';
  }
```

- [ ] **Step 4: Run backend build to type-check the new SDK methods**

Run:

```bash
cd api-cobranca && npm run build
```

Expected before Task 2 may be PASS if only typings/service were changed. If it fails, the failure should be a TypeScript error in `efi.service.ts` or the SDK declaration, not an unrelated test failure.

---

### Task 2: PaymentService Guards And Cancellation Coordinator

**Files:**
- Modify: `api-cobranca/src/payment/payment.service.spec.ts`
- Modify: `api-cobranca/src/payment/payment.service.ts`

- [ ] **Step 1: Write failing tests for non-pending createPayment and cancellation delegation**

Append these tests to `api-cobranca/src/payment/payment.service.spec.ts` inside the existing `describe`:

```ts
  it('bloqueia emissao quando a fatura nao esta pendente', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ status: 'CANCELED' }),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          enabledBillingMethods: ['PIX', 'BOLETO'],
        }),
      },
    } as unknown as PrismaService;
    const efiService = {
      createPayment: jest.fn(),
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma);

    await expect(
      service.createPayment('invoice-1', 'company-1', 'PIX'),
    ).rejects.toThrow('Apenas faturas pendentes podem gerar cobranca.');
    expect(efiService.createPayment).not.toHaveBeenCalled();
  });

  it('cancela Pix CobV quando a fatura possui txid Efi', async () => {
    const prisma = {} as unknown as PrismaService;
    const efiService = {
      cancelPixDueCharge: jest
        .fn()
        .mockResolvedValue('REMOVIDA_PELO_USUARIO_RECEBEDOR'),
      cancelCharge: jest.fn(),
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma);

    await expect(
      service.cancelPaymentForInvoice({
        id: 'invoice-1',
        companyId: 'company-1',
        efiTxid: 'txid-1',
        efiChargeId: null,
      }),
    ).resolves.toEqual({
      providerAction: 'PIX_COBV_REMOVED',
      gatewayStatusRaw: 'REMOVIDA_PELO_USUARIO_RECEBEDOR',
    });
    expect(efiService.cancelPixDueCharge).toHaveBeenCalledWith(
      'company-1',
      'txid-1',
    );
    expect(efiService.cancelCharge).not.toHaveBeenCalled();
  });

  it('cancela boleto ou Bolix quando a fatura possui charge id Efi', async () => {
    const prisma = {} as unknown as PrismaService;
    const efiService = {
      cancelPixDueCharge: jest.fn(),
      cancelCharge: jest.fn().mockResolvedValue('canceled'),
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma);

    await expect(
      service.cancelPaymentForInvoice({
        id: 'invoice-1',
        companyId: 'company-1',
        efiTxid: null,
        efiChargeId: '12345',
      }),
    ).resolves.toEqual({
      providerAction: 'CHARGE_CANCELED',
      gatewayStatusRaw: 'canceled',
    });
    expect(efiService.cancelCharge).toHaveBeenCalledWith(
      'company-1',
      '12345',
    );
    expect(efiService.cancelPixDueCharge).not.toHaveBeenCalled();
  });

  it('nao chama a Efi quando a fatura ainda nao foi gerada no gateway', async () => {
    const prisma = {} as unknown as PrismaService;
    const efiService = {
      cancelPixDueCharge: jest.fn(),
      cancelCharge: jest.fn(),
    } as unknown as EfiService;
    const service = new PaymentService(efiService, prisma);

    await expect(
      service.cancelPaymentForInvoice({
        id: 'invoice-1',
        companyId: 'company-1',
        efiTxid: null,
        efiChargeId: null,
      }),
    ).resolves.toEqual({
      providerAction: 'LOCAL_ONLY',
      gatewayStatusRaw: 'CANCELED_BY_USER',
    });
    expect(efiService.cancelPixDueCharge).not.toHaveBeenCalled();
    expect(efiService.cancelCharge).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd api-cobranca && npm test -- payment/payment.service.spec.ts --runInBand
```

Expected: FAIL because `cancelPaymentForInvoice` does not exist and `createPayment` does not check invoice status yet.

- [ ] **Step 3: Implement PaymentService guard and coordinator**

In `api-cobranca/src/payment/payment.service.ts`, update imports:

```ts
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
```

Add these interfaces above `@Injectable()`:

```ts
interface CancelablePaymentInvoice {
  id: string;
  companyId: string;
  efiTxid: string | null;
  efiChargeId: string | null;
}

export interface CancelPaymentResult {
  providerAction: 'LOCAL_ONLY' | 'PIX_COBV_REMOVED' | 'CHARGE_CANCELED';
  gatewayStatusRaw: string;
}
```

Update `createPayment` so the invoice guard runs before `ensureBillingMethodEnabled`:

```ts
    await this.ensureInvoiceCanGeneratePayment(invoiceId, companyId);
    await this.ensureBillingMethodEnabled(companyId, billingType);

    return this.efiService.createPayment(invoiceId, companyId, billingType);
```

Add this public method before `createPaymentBatch`:

```ts
  async cancelPaymentForInvoice(
    invoice: CancelablePaymentInvoice,
  ): Promise<CancelPaymentResult> {
    if (invoice.efiTxid) {
      const gatewayStatusRaw = await this.efiService.cancelPixDueCharge(
        invoice.companyId,
        invoice.efiTxid,
      );

      return {
        providerAction: 'PIX_COBV_REMOVED',
        gatewayStatusRaw,
      };
    }

    if (invoice.efiChargeId) {
      const gatewayStatusRaw = await this.efiService.cancelCharge(
        invoice.companyId,
        invoice.efiChargeId,
      );

      return {
        providerAction: 'CHARGE_CANCELED',
        gatewayStatusRaw,
      };
    }

    return {
      providerAction: 'LOCAL_ONLY',
      gatewayStatusRaw: 'CANCELED_BY_USER',
    };
  }
```

Add this private method before `ensureBillingMethodEnabled`:

```ts
  private async ensureInvoiceCanGeneratePayment(
    invoiceId: string,
    companyId: string,
  ): Promise<void> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { status: true },
    });

    if (!invoice) {
      throw new HttpException('Fatura nao encontrada.', HttpStatus.NOT_FOUND);
    }

    if (invoice.status !== 'PENDING') {
      throw new HttpException(
        'Apenas faturas pendentes podem gerar cobranca.',
        HttpStatus.CONFLICT,
      );
    }
  }
```

- [ ] **Step 4: Run PaymentService tests to verify green**

Run:

```bash
cd api-cobranca && npm test -- payment/payment.service.spec.ts --runInBand
```

Expected: PASS.

---

### Task 3: Invoice Cancellation Service And Route

**Files:**
- Modify: `api-cobranca/src/invoices/invoices.module.ts`
- Modify: `api-cobranca/src/invoices/invoices.service.spec.ts`
- Modify: `api-cobranca/src/invoices/invoices.service.ts`
- Modify: `api-cobranca/src/invoices/invoices.controller.ts`

- [ ] **Step 1: Write failing InvoicesService tests**

In `api-cobranca/src/invoices/invoices.service.spec.ts`, add this import:

```ts
import { PaymentService } from '../payment/payment.service';
```

Replace `buildMessageQueue` with these helpers:

```ts
  function buildMessageQueue(): MessageQueueService {
    return {
      addInitialChargeJobs: jest.fn().mockResolvedValue(undefined),
    } as unknown as MessageQueueService;
  }

  function buildPaymentService(): PaymentService {
    return {
      cancelPaymentForInvoice: jest.fn().mockResolvedValue({
        providerAction: 'LOCAL_ONLY',
        gatewayStatusRaw: 'CANCELED_BY_USER',
      }),
    } as unknown as PaymentService;
  }
```

Update every existing `new InvoicesService(prisma, buildMessageQueue())` call to:

```ts
new InvoicesService(prisma, buildMessageQueue(), buildPaymentService())
```

Update every existing `new InvoicesService(prisma, messageQueue)` call to:

```ts
new InvoicesService(prisma, messageQueue, buildPaymentService())
```

Append these tests before the final `});`:

```ts
  it('cancela localmente uma fatura pendente sem cobranca Efi gerada', async () => {
    const invoice = buildInvoice({});
    const updatedInvoice = buildInvoice({ status: 'CANCELED' });
    const paymentService = buildPaymentService();
    const transaction = jest.fn(
      async (
        callback: (tx: {
          invoice: { updateMany: jest.Mock; findFirst: jest.Mock };
          collectionLog: { create: jest.Mock };
        }) => Promise<unknown>,
      ) =>
        callback({
          invoice: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findFirst: jest.fn().mockResolvedValue(updatedInvoice),
          },
          collectionLog: {
            create: jest.fn().mockResolvedValue({ id: 'log-1' }),
          },
        }),
    );
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      paymentService,
    );
    const result = await service.cancelInvoice('company-1', 'invoice-1');

    expect(paymentService.cancelPaymentForInvoice).toHaveBeenCalledWith({
      id: 'invoice-1',
      companyId: 'company-1',
      efiTxid: null,
      efiChargeId: null,
    });
    expect(result.status).toBe('CANCELED');
  });

  it('mantem pendente quando a Efi falha ao cancelar', async () => {
    const invoice = buildInvoice({});
    const paymentService = {
      cancelPaymentForInvoice: jest
        .fn()
        .mockRejectedValue(new Error('Falha ao processar cobranca na Efi.')),
    } as unknown as PaymentService;
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          ...invoice,
          efiTxid: 'txid-1',
        }),
      },
      $transaction: jest.fn(),
    } as unknown as PrismaService;

    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      paymentService,
    );

    await expect(
      service.cancelInvoice('company-1', 'invoice-1'),
    ).rejects.toThrow('Falha ao processar cobranca na Efi.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita cancelamento de fatura paga', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue(
          buildInvoice({
            status: 'PAID',
            paidAt: new Date('2026-05-10T12:00:00.000Z'),
          }),
        ),
      },
    } as unknown as PrismaService;
    const paymentService = buildPaymentService();
    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      paymentService,
    );

    await expect(
      service.cancelInvoice('company-1', 'invoice-1'),
    ).rejects.toThrow('Apenas faturas pendentes podem ser canceladas.');
    expect(paymentService.cancelPaymentForInvoice).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run InvoicesService tests to verify failure**

Run:

```bash
cd api-cobranca && npm test -- invoices/invoices.service.spec.ts --runInBand
```

Expected: FAIL because `InvoicesService` does not accept `PaymentService` and `cancelInvoice` does not exist.

- [ ] **Step 3: Import PaymentModule in InvoicesModule**

Update `api-cobranca/src/invoices/invoices.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { QueueModule } from '../queue/queue.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [QueueModule, PaymentModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
```

- [ ] **Step 4: Inject PaymentService and implement cancelInvoice**

In `api-cobranca/src/invoices/invoices.service.ts`, update imports:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentService } from '../payment/payment.service';
```

Update the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly messageQueue: MessageQueueService,
    private readonly paymentService: PaymentService,
  ) {}
```

Add this method after `getCollectionAttempts`:

```ts
  async cancelInvoice(
    companyId: string,
    invoiceId: string,
  ): Promise<InvoiceListItem> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        debtor: { include: { collectionProfile: true } },
        recurringInvoice: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Fatura nao encontrada.');
    }

    if (invoice.status !== 'PENDING') {
      throw new ConflictException(
        'Apenas faturas pendentes podem ser canceladas.',
      );
    }

    const cancellation = await this.paymentService.cancelPaymentForInvoice({
      id: invoice.id,
      companyId: invoice.companyId,
      efiTxid: invoice.efiTxid,
      efiChargeId: invoice.efiChargeId,
    });

    const updatedInvoice = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.invoice.updateMany({
        where: { id: invoice.id, companyId, status: 'PENDING' },
        data: {
          status: 'CANCELED',
          gatewayStatusRaw: cancellation.gatewayStatusRaw,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException(
          'A fatura deixou de estar pendente antes do cancelamento local.',
        );
      }

      await tx.collectionLog.create({
        data: {
          companyId,
          invoiceId: invoice.id,
          actionType: 'INVOICE_CANCELED',
          description:
            cancellation.providerAction === 'LOCAL_ONLY'
              ? 'Fatura cancelada antes de gerar cobranca na Efi.'
              : 'Fatura cancelada e cobranca Efi cancelada com sucesso.',
          status: 'CANCELED',
        },
      });

      return tx.invoice.findFirst({
        where: { id: invoice.id, companyId },
        include: {
          debtor: { include: { collectionProfile: true } },
          recurringInvoice: true,
        },
      });
    });

    if (!updatedInvoice) {
      throw new BadRequestException(
        'Fatura cancelada, mas nao foi possivel recarregar o registro.',
      );
    }

    return this.mapInvoiceListItem(updatedInvoice);
  }
```

- [ ] **Step 5: Add controller route**

In `api-cobranca/src/invoices/invoices.controller.ts`, add this route after `createInvoice`:

```ts
  @Post(':invoiceId/cancel')
  async cancelInvoice(
    @GetUser() user: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
  ): Promise<unknown> {
    if (!this.isUuid(invoiceId)) {
      throw new HttpException('Fatura invalida.', HttpStatus.BAD_REQUEST);
    }

    return this.invoicesService.cancelInvoice(user.companyId, invoiceId);
  }
```

- [ ] **Step 6: Run InvoicesService tests to verify green**

Run:

```bash
cd api-cobranca && npm test -- invoices/invoices.service.spec.ts --runInBand
```

Expected: PASS.

---

### Task 4: WhatsApp Worker Guard For Old Jobs

**Files:**
- Modify: `api-cobranca/src/queue/workers/message.worker.spec.ts`
- Modify: `api-cobranca/src/queue/workers/message.worker.ts`

- [ ] **Step 1: Add failing worker test**

Append this test to `api-cobranca/src/queue/workers/message.worker.spec.ts`:

```ts
describe('MessageWorkerService canceled invoice guard', () => {
  it('nao envia WhatsApp quando job antigo encontra fatura cancelada', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ status: 'CANCELED' }),
      },
      collectionLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
    };
    const whatsappService = {
      sendTemplateMessage: jest.fn(),
    };
    const worker = new MessageWorkerService(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      {} as RateLimitService,
      {} as MessagingLimitService,
      {} as PaymentService,
      {} as SpintaxService,
      {} as MessageQueueService,
      whatsappService as unknown as WhatsappService,
      {} as EmailQueueService,
      {} as EmailService,
      {} as EmailTemplatesService,
      {} as PublicPaymentLinkService,
    ) as unknown as {
      processSendMessageJob(data: {
        invoiceId: string;
        companyId: string;
        debtorId: string;
        phoneNumber: string;
        senderKey: string;
        templateName: string;
        templateLanguage: string;
        templateParameters: string[];
        debtorName: string;
      }): Promise<void>;
    };

    await worker.processSendMessageJob({
      invoiceId: 'invoice-1',
      companyId: 'company-1',
      debtorId: 'debtor-1',
      phoneNumber: '5511999999999',
      senderKey: 'phone-number-id',
      templateName: 'cobrapix_cobranca',
      templateLanguage: 'pt_BR',
      templateParameters: ['Maria'],
      debtorName: 'Maria Silva',
    });

    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled();
    expect(prisma.collectionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'MESSAGE_SKIPPED_INVOICE_NOT_PENDING',
          status: 'SKIPPED',
        }) as unknown,
      }),
    );
  });
});
```

- [ ] **Step 2: Run worker test to verify failure**

Run:

```bash
cd api-cobranca && npm test -- queue/workers/message.worker.spec.ts --runInBand
```

Expected: FAIL because `processSendMessageJob` does not check invoice status.

- [ ] **Step 3: Add guard methods and call them before external sends**

In `api-cobranca/src/queue/workers/message.worker.ts`, add this at the start of `processSendMessageJob`, after the destructuring and before the log line:

```ts
    const canSend = await this.ensureInvoiceStillPending(
      companyId,
      invoiceId,
      'WHATSAPP',
    );
    if (!canSend) {
      return;
    }
```

Add this at the start of `tryEmailFallback`, before loading the debtor:

```ts
      const canSendFallback = await this.ensureInvoiceStillPending(
        data.companyId,
        data.invoiceId,
        'EMAIL',
      );
      if (!canSendFallback) {
        return;
      }
```

Add this private method before `tryEmailFallback`:

```ts
  private async ensureInvoiceStillPending(
    companyId: string,
    invoiceId: string,
    channel: CollectionChannel,
  ): Promise<boolean> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { status: true },
    });

    if (invoice?.status === 'PENDING') {
      return true;
    }

    await this.createCollectionLog(
      companyId,
      invoiceId,
      'MESSAGE_SKIPPED_INVOICE_NOT_PENDING',
      `Envio ${channel} ignorado porque a fatura nao esta pendente.`,
      'SKIPPED',
    );

    return false;
  }
```

- [ ] **Step 4: Run worker test to verify green**

Run:

```bash
cd api-cobranca && npm test -- queue/workers/message.worker.spec.ts --runInBand
```

Expected: PASS.

---

### Task 5: Email Send Guard For Old Jobs

**Files:**
- Modify: `api-cobranca/src/email/email.service.spec.ts`
- Modify: `api-cobranca/src/email/email.service.ts`

- [ ] **Step 1: Add failing email test**

In `api-cobranca/src/email/email.service.spec.ts`, update `createService` so the mocked `prisma` includes `invoice` and `collectionLog`:

```ts
    invoice: {
      findFirst: jest.fn().mockResolvedValue({ status: 'PENDING' }),
    },
    collectionLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
```

Also include the mocks in the returned `prisma` object:

```ts
      invoiceFindFirst: (
        prisma as unknown as { invoice: { findFirst: jest.Mock } }
      ).invoice.findFirst,
      collectionLogCreate: (
        prisma as unknown as { collectionLog: { create: jest.Mock } }
      ).collectionLog.create,
```

Append this test inside `describe('EmailService', () => { ... })`:

```ts
  it('nao envia email quando job antigo encontra fatura cancelada', async () => {
    const { service, prisma, crypto, resendMailer } = createService({
      corporateName: 'Escola Teste',
      resendApiKeyEncrypted: 'encrypted-resend-key',
      resendFromEmail: 'cobranca@escolateste.com.br',
    });
    prisma.invoiceFindFirst.mockResolvedValue({ status: 'CANCELED' });

    await expect(service.send(buildEmailInput())).resolves.toBe(
      'skipped-invoice-not-pending',
    );

    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(resendMailer.sendEmail).not.toHaveBeenCalled();
    expect(prisma.collectionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'EMAIL_SKIPPED_INVOICE_NOT_PENDING',
          status: 'SKIPPED',
        }) as unknown,
      }),
    );
  });
```

- [ ] **Step 2: Run email test to verify failure**

Run:

```bash
cd api-cobranca && npm test -- email/email.service.spec.ts --runInBand
```

Expected: FAIL because `EmailService.send` does not check invoice status.

- [ ] **Step 3: Implement EmailService guard**

In `api-cobranca/src/email/email.service.ts`, add this at the start of `send`, before `findReusableMessageId`:

```ts
    const canSend = await this.ensureInvoiceStillPending(input);
    if (!canSend) {
      return 'skipped-invoice-not-pending';
    }
```

Add this private method before `findReusableMessageId`:

```ts
  private async ensureInvoiceStillPending(
    input: SendEmailInput,
  ): Promise<boolean> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: input.invoiceId, companyId: input.companyId },
      select: { status: true },
    });

    if (invoice?.status === 'PENDING') {
      return true;
    }

    await this.prisma.collectionLog.create({
      data: {
        companyId: input.companyId,
        invoiceId: input.invoiceId,
        actionType: 'EMAIL_SKIPPED_INVOICE_NOT_PENDING',
        description: `Email ignorado para ${input.debtorName} porque a fatura nao esta pendente.`,
        status: 'SKIPPED',
      },
    });

    return false;
  }
```

- [ ] **Step 4: Run email test to verify green**

Run:

```bash
cd api-cobranca && npm test -- email/email.service.spec.ts --runInBand
```

Expected: PASS.

---

### Task 6: Frontend API And InvoiceTable Cancel Action

**Files:**
- Modify: `front-cobranca/src/lib/api-client.ts`
- Modify: `front-cobranca/src/components/features/InvoiceTable.tsx`
- Create: `front-cobranca/src/components/features/__tests__/InvoiceTable.test.tsx`

- [ ] **Step 1: Write failing InvoiceTable tests**

Create `front-cobranca/src/components/features/__tests__/InvoiceTable.test.tsx`:

```tsx
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PaginationState } from "@tanstack/react-table";
import { InvoiceTable } from "../InvoiceTable";
import type { ParsedDebtor } from "../UploadCSV";

function buildInvoice(status: string): ParsedDebtor {
  return {
    id: `invoice-${status.toLowerCase()}`,
    invoiceId: `invoice-${status.toLowerCase()}`,
    name: `Cliente ${status}`,
    phone_number: "+5511999999999",
    email: "cliente@example.com",
    original_amount: 150,
    due_date: "2026-07-10",
    billing_type: "PIX",
    status,
    debtorId: `debtor-${status.toLowerCase()}`,
    whatsapp_opt_in: true,
  };
}

function renderTable(options?: {
  data?: ParsedDebtor[];
  onCancelInvoice?: jest.Mock;
}): void {
  const pagination: PaginationState = { pageIndex: 0, pageSize: 20 };

  render(
    <InvoiceTable
      data={options?.data ?? [buildInvoice("PENDING")]}
      pageCount={1}
      total={options?.data?.length ?? 1}
      pagination={pagination}
      onPaginationChange={jest.fn()}
      onConfigureDebtor={jest.fn()}
      onAddInvoice={jest.fn()}
      onRunSelectedInvoices={jest.fn()}
      isRunningSelected={false}
      onGeneratePayment={jest.fn()}
      onResendInvoice={jest.fn()}
      onCheckPaymentStatus={jest.fn()}
      onCancelInvoice={options?.onCancelInvoice ?? jest.fn()}
      onViewPaymentHistory={jest.fn()}
      runningInvoiceAction={null}
    />,
  );
}

describe("InvoiceTable cancel action", () => {
  it("calls cancel handler for a pending invoice", async () => {
    const user = userEvent.setup();
    const onCancelInvoice = jest.fn();
    renderTable({ onCancelInvoice });

    await user.click(screen.getByRole("button", { name: /cancelar cobranca/i }));

    expect(onCancelInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "invoice-pending" }),
    );
  });

  it("disables cancel handler for paid and canceled invoices", () => {
    renderTable({ data: [buildInvoice("PAID"), buildInvoice("CANCELED")] });

    const buttons = screen.getAllByRole("button", {
      name: /cancelar cobranca/i,
    });

    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run frontend test to verify failure**

Run:

```bash
cd front-cobranca && npx jest src/components/features/__tests__/InvoiceTable.test.tsx --runInBand
```

Expected: FAIL because `InvoiceTable` does not have `onCancelInvoice` or a cancel button yet.

- [ ] **Step 3: Add API client method**

In `front-cobranca/src/lib/api-client.ts`, add this method near other invoice methods:

```ts
  async cancelInvoice(invoiceId: string): Promise<InvoiceListItem> {
    return this.fetch<InvoiceListItem>(`/invoices/${invoiceId}/cancel`, {
      method: "POST",
    });
  }
```

- [ ] **Step 4: Add InvoiceTable cancel prop and row action**

In `front-cobranca/src/components/features/InvoiceTable.tsx`, update the action type:

```ts
export type InvoiceRowAction = "generate" | "resend" | "status" | "cancel";
```

Add the prop:

```ts
  onCancelInvoice: (invoice: ParsedDebtor) => void;
```

Destructure it in the component parameters:

```ts
  onCancelInvoice,
```

Inside `renderRowActions`, add:

```ts
    const canCancel = invoice.status === "PENDING";
```

Add this button after the status button:

```tsx
        <button
          type="button"
          onClick={() => onCancelInvoice(invoice)}
          disabled={!invoiceId || !canCancel || isBusy}
          className={`${buttonBase} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
          title="Cancelar cobrança"
          aria-label="Cancelar cobrança"
        >
          {activeAction === "cancel" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Ban size={14} />
          )}
          <span className={hideTextClass}>Cancelar</span>
        </button>
```

- [ ] **Step 5: Run frontend table test to verify green**

Run:

```bash
cd front-cobranca && npx jest src/components/features/__tests__/InvoiceTable.test.tsx --runInBand
```

Expected: PASS.

---

### Task 7: Frontend Page Cancel Handler

**Files:**
- Modify: `front-cobranca/src/app/(dashboard)/cobrancas/page.tsx`

- [ ] **Step 1: Add handler to the cobrancas page**

In `front-cobranca/src/app/(dashboard)/cobrancas/page.tsx`, add this function after `handleCheckPaymentStatus`:

```ts
  async function handleCancelInvoice(invoice: ParsedDebtor): Promise<void> {
    const invoiceId = getInvoiceId(invoice);

    if (!invoiceId) {
      setSuccessMsg(null);
      setErrorMsg("Nao foi possivel identificar a fatura desta cobranca.");
      return;
    }

    const confirmed = window.confirm(
      `Cancelar a cobranca de ${invoice.name}? Esta acao impede novos envios e novas geracoes para esta fatura.`,
    );

    if (!confirmed) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setRunningInvoiceAction({ invoiceId, action: "cancel" });

    try {
      await apiClient.cancelInvoice(invoiceId);
      await fetchInvoices();
      setSuccessMsg(`Cobranca de ${invoice.name} cancelada com sucesso.`);
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel cancelar a cobranca."),
      );
    } finally {
      setRunningInvoiceAction(null);
    }
  }
```

- [ ] **Step 2: Pass handler into InvoiceTable**

In the `InvoiceTable` JSX props, add:

```tsx
                  onCancelInvoice={(invoice) => {
                    void handleCancelInvoice(invoice);
                  }}
```

- [ ] **Step 3: Run frontend build or lint**

Run:

```bash
cd front-cobranca && npm run lint
```

Expected: PASS, or only pre-existing lint output unrelated to the touched files.

---

### Task 8: End-To-End Backend Verification

**Files:**
- No new code files in this task.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
cd api-cobranca && npm test -- payment/payment.service.spec.ts invoices/invoices.service.spec.ts queue/workers/message.worker.spec.ts email/email.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run backend build**

Run:

```bash
cd api-cobranca && npm run build
```

Expected: PASS.

- [ ] **Step 3: Run frontend targeted test**

Run:

```bash
cd front-cobranca && npx jest src/components/features/__tests__/InvoiceTable.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 4: Check final diff**

Run:

```bash
git diff -- api-cobranca/src/types/sdk-node-apis-efi.d.ts api-cobranca/src/payment/efi.service.ts api-cobranca/src/payment/payment.service.ts api-cobranca/src/payment/payment.service.spec.ts api-cobranca/src/invoices/invoices.module.ts api-cobranca/src/invoices/invoices.service.ts api-cobranca/src/invoices/invoices.controller.ts api-cobranca/src/invoices/invoices.service.spec.ts api-cobranca/src/queue/workers/message.worker.ts api-cobranca/src/queue/workers/message.worker.spec.ts api-cobranca/src/email/email.service.ts api-cobranca/src/email/email.service.spec.ts front-cobranca/src/lib/api-client.ts front-cobranca/src/components/features/InvoiceTable.tsx front-cobranca/src/components/features/__tests__/InvoiceTable.test.tsx front-cobranca/src/app/\\(dashboard\\)/cobrancas/page.tsx
```

Expected: diff only contains cancel-invoice work. Do not commit.

---

## Self-Review

Spec coverage:

- Pending-only cancel: Task 3.
- Local cancel when Efí has not generated payment: Task 3.
- Gateway cancel for Pix CobV and boleto/Bolix: Tasks 1 and 2.
- Keep pending when Efí fails: Task 3.
- Prevent future payment generation: Task 2.
- Prevent old queued WhatsApp/email jobs from sending: Tasks 4 and 5.
- Frontend row action with confirmation and refresh: Tasks 6 and 7.
- Tests and verification: Tasks 2 through 8.

Placeholder scan:

- No forbidden placeholder markers were found in the task steps.
- Commit steps intentionally omitted because the user explicitly asked to keep commits under their control.

Type consistency:

- `cancelPaymentForInvoice` returns `CancelPaymentResult`.
- `InvoiceRowAction` includes `"cancel"` before page usage.
- `cancelInvoice(invoiceId: string): Promise<InvoiceListItem>` matches the backend route response.
