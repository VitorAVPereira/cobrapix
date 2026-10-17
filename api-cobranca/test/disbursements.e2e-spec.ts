import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinancialEligibilityService } from '../src/financial-activation/financial-eligibility.service';
import { DisbursementSettingsService } from '../src/disbursements/disbursement-settings.service';
import { DisbursementRecipientsService } from '../src/disbursements/disbursement-recipients.service';
import { DisbursementBatchesService } from '../src/disbursements/disbursement-batches.service';
import { TemplatePolicyService } from '../src/templates/template-policy.service';
import { DisbursementApprovalService } from '../src/disbursements/disbursement-approval.service';
import { messageRecipient } from '../src/communications/message-context';
import { DisbursementSenderService } from '../src/disbursements/disbursement-sender.service';
import type { SendOutcome } from '../src/disbursements/efi-disbursement.client';
import { DisbursementWebhookService } from '../src/disbursements/disbursement-webhook.service';

if (
  !process.env.CIFRAMAIS_DISPOSABLE_E2E ||
  !/^postgresql:\/\/postgres:[a-f0-9]+@127\.0\.0\.1:\d+\/ciframais_e2e$/.test(
    process.env.DATABASE_URL ?? '',
  )
)
  throw new Error('Use node test/e2e-disposable.cjs disbursements.e2e-spec.ts');
jest.setTimeout(120000);

describe('Disbursements (disposable PostgreSQL)', () => {
  const prisma = new PrismaService(new ConfigService({ ...process.env }));
  const settings = new DisbursementSettingsService(
    prisma,
    new FinancialEligibilityService(prisma),
    new TemplatePolicyService(new ConfigService({ ...process.env })),
  );
  const approver = {
    approverName: 'Maria Souza',
    approverPhone: '5511988887777',
  };
  let companyId: string, recipientId: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
    companyId = (
      await prisma.company.create({
        data: {
          corporateName: 'Disbursement tenant LTDA',
          document: randomUUID().replace(/\D/g, '').slice(0, 14),
          email: `${randomUUID()}@example.test`,
          phoneNumber: '5511999990000',
        },
      })
    ).id;
    recipientId = (
      await prisma.disbursementRecipient.create({
        data: {
          companyId,
          name: 'Colaborador',
          documentType: 'CPF',
          document: '52998224725',
          pixKey: '52998224725',
        },
      })
    ).id;
    await prisma.disbursementSettings.create({
      data: {
        companyId,
        version: 1,
        enabled: true,
        ...approver,
        changedByUserId: 'admin',
      },
    });
  });
  afterAll(() => prisma.$disconnect());

  async function batch(
    status: 'DRAFT' | 'AWAITING_APPROVAL' | 'PROCESSING',
    itemStatus:
      | 'PENDING'
      | 'SENDING'
      | 'IN_PROCESSING'
      | 'UNCERTAIN'
      | 'PAID' = 'PENDING',
  ) {
    const created = await prisma.disbursementBatch.create({
      data: { companyId, reference: status, status, createdByUserId: 'user' },
    });
    const item = await prisma.disbursementItem.create({
      data: {
        batchId: created.id,
        companyId,
        recipientId,
        recipientName: 'Colaborador',
        documentType: 'CPF',
        document: '52998224725',
        pixKey: '52998224725',
        amountCents: 150000,
        status: itemStatus,
        idEnvio: randomUUID().replace(/-/g, ''),
      },
    });
    return { batchId: created.id, itemId: item.id };
  }

  it('enabling without an active financial profile or payment templates is refused', async () => {
    await expect(
      settings.configure(companyId, 'admin', {
        expectedVersion: 1,
        enabled: true,
        ...approver,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'DISBURSEMENT_NOT_READY',
        missing: [
          expect.objectContaining({ code: 'FINANCIAL_PROFILE_NOT_READY' }),
          {
            code: 'TEMPLATE_UNAVAILABLE',
            message:
              'Template "Pedido de aprovação": sem template padrão definido para a empresa.',
          },
          expect.objectContaining({ code: 'TEMPLATE_UNAVAILABLE' }),
          expect.objectContaining({ code: 'TEMPLATE_UNAVAILABLE' }),
        ],
      },
    });
  });

  it('two admins saving the same version: one wins, the other gets 409', async () => {
    const disables = await Promise.allSettled([
      settings.configure(companyId, 'admin-a', {
        expectedVersion: 1,
        enabled: false,
        ...approver,
      }),
      settings.configure(companyId, 'admin-b', {
        expectedVersion: 1,
        enabled: false,
        ...approver,
      }),
    ]);
    expect(disables.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = disables.find((r) => r.status === 'rejected');
    expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    const versions = await prisma.disbursementSettings.findMany({
      where: { companyId },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((v) => [v.version, v.enabled])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('disabling cancels unsent work and keeps sent items under verification', async () => {
    await prisma.disbursementSettings.create({
      data: {
        companyId,
        version: 3,
        enabled: true,
        ...approver,
        changedByUserId: 'admin',
      },
    });
    const draft = await batch('DRAFT');
    const awaiting = await batch('AWAITING_APPROVAL');
    await prisma.disbursementApproval.create({
      data: {
        batchId: awaiting.batchId,
        companyId,
        requestNumber: 1,
        contentHash: 'hash',
        totalCents: 150000,
        itemCount: 1,
        settingsVersion: 3,
        approverPhoneHash: 'phone-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
        requestedByUserId: 'user',
      },
    });
    const pending = await batch('PROCESSING', 'PENDING');
    const sending = await batch('PROCESSING', 'SENDING');
    const inFlight = await batch('PROCESSING', 'IN_PROCESSING');
    const uncertain = await batch('PROCESSING', 'UNCERTAIN');

    await settings.configure(companyId, 'admin', {
      expectedVersion: 3,
      enabled: false,
      ...approver,
    });

    const item = async (id: string) =>
      (await prisma.disbursementItem.findUniqueOrThrow({ where: { id } }))
        .status;
    const status = async (id: string) =>
      (await prisma.disbursementBatch.findUniqueOrThrow({ where: { id } }))
        .status;
    expect(await status(draft.batchId)).toBe('DRAFT');
    expect(await item(draft.itemId)).toBe('PENDING');
    expect(await status(awaiting.batchId)).toBe('CANCELED');
    expect(await item(awaiting.itemId)).toBe('CANCELED');
    expect(
      (
        await prisma.disbursementApproval.findFirstOrThrow({
          where: { batchId: awaiting.batchId },
        })
      ).state,
    ).toBe('INVALIDATED');
    expect(await item(pending.itemId)).toBe('CANCELED');
    expect(await item(sending.itemId)).toBe('SENDING');
    expect(await item(inFlight.itemId)).toBe('IN_PROCESSING');
    expect(await item(uncertain.itemId)).toBe('UNCERTAIN');
  });

  it('the same collaborator cannot appear twice in one batch', async () => {
    const { batchId } = await batch('DRAFT');
    await expect(
      prisma.disbursementItem.create({
        data: {
          batchId,
          companyId,
          recipientId,
          recipientName: 'Colaborador',
          documentType: 'CPF',
          document: '52998224725',
          amountCents: 1,
          idEnvio: randomUUID().replace(/-/g, ''),
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Collaborators isolated by company (disposable PostgreSQL)', () => {
  const prisma = new PrismaService(new ConfigService({ ...process.env }));
  const settings = new DisbursementSettingsService(
    prisma,
    new FinancialEligibilityService(prisma),
    new TemplatePolicyService(new ConfigService({ ...process.env })),
  );
  const recipients = new DisbursementRecipientsService(prisma, settings);
  const ana = {
    name: 'Ana Souza',
    document: '52998224725',
    pixKey: '52998224725',
  };
  let companyA: string, companyB: string, disabled: string;

  async function company(enabled: boolean | null): Promise<string> {
    const id = (
      await prisma.company.create({
        data: {
          corporateName: 'Tenant LTDA',
          document: randomUUID().replace(/\D/g, '').slice(0, 14),
          email: `${randomUUID()}@example.test`,
          phoneNumber: '5511999990000',
        },
      })
    ).id;
    if (enabled !== null)
      await prisma.disbursementSettings.create({
        data: {
          companyId: id,
          version: 1,
          enabled,
          approverName: 'Maria',
          approverPhone: '5511988887777',
          changedByUserId: 'admin',
        },
      });
    return id;
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    companyA = await company(true);
    companyB = await company(true);
    disabled = await company(false);
  });
  afterAll(() => prisma.$disconnect());

  it('the same person may be a collaborator of two companies, each seeing only its own', async () => {
    const a = await recipients.create(companyA, ana);
    await recipients.create(companyB, { ...ana, name: 'Ana B' });
    const listA = await recipients.list(companyA, { page: 1, pageSize: 20 });
    expect(listA.items.map((r) => r.name)).toEqual(['Ana Souza']);
    await expect(
      recipients.update(companyB, a.id, {
        ...ana,
        pixKey: 'golpe@example.com',
        expectedVersion: 1,
        active: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      (
        await prisma.disbursementRecipient.findUniqueOrThrow({
          where: { id: a.id },
        })
      ).pixKey,
    ).toBe('52998224725');
  });

  it('a second registration with the same document answers 409', async () => {
    await expect(
      recipients.create(companyA, { ...ana, name: 'Outra Ana' }),
    ).rejects.toMatchObject({ response: { code: 'RECIPIENT_DUPLICATE' } });
  });

  it('import is all or nothing and never touches another company', async () => {
    const before = await prisma.disbursementRecipient.count();
    await expect(
      recipients.import(companyB, [
        { name: 'Carla', document: '11144477735', pixKey: 'carla@example.com' },
        { name: 'Davi', document: '123', pixKey: 'davi@example.com' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.disbursementRecipient.count()).toBe(before);
    await expect(
      recipients.import(companyB, [
        { name: 'Carla', document: '11144477735', pixKey: 'carla@example.com' },
        { ...ana, name: 'Ana B' },
      ]),
    ).resolves.toEqual({ created: 1, skipped: 1 });
    expect(
      await prisma.disbursementRecipient.count({
        where: { companyId: companyA },
      }),
    ).toBe(1);
  });

  it('two edits with the same version: one wins, the other gets 409', async () => {
    const current = (await recipients.list(companyA, { page: 1, pageSize: 20 }))
      .items[0]!;
    const edits = await Promise.allSettled(
      ['ana1@example.com', 'ana2@example.com'].map((pixKey) =>
        recipients.update(companyA, current.id, {
          ...ana,
          pixKey,
          expectedVersion: current.version,
          active: true,
        }),
      ),
    );
    expect(edits.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (edits.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason,
    ).toBeInstanceOf(ConflictException);
  });

  it('a company without the feature gets 404 everywhere', async () => {
    await expect(
      recipients.list(disabled, { page: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(recipients.create(disabled, ana)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(recipients.import(disabled, [ana])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(settings.companyStatus(disabled)).resolves.toMatchObject({
      enabled: false,
    });
  });
});

describe('Batches (disposable PostgreSQL)', () => {
  const prisma = new PrismaService(new ConfigService({ ...process.env }));
  const settings = new DisbursementSettingsService(
    prisma,
    new FinancialEligibilityService(prisma),
    new TemplatePolicyService(new ConfigService({ ...process.env })),
  );
  const recipients = new DisbursementRecipientsService(prisma, settings);
  const batches = new DisbursementBatchesService(prisma, settings);
  let companyA: string, companyB: string, ana: string, bruno: string;

  async function company(): Promise<string> {
    const id = (
      await prisma.company.create({
        data: {
          corporateName: 'Tenant LTDA',
          document: randomUUID().replace(/\D/g, '').slice(0, 14),
          email: `${randomUUID()}@example.test`,
          phoneNumber: '5511999990000',
        },
      })
    ).id;
    await prisma.disbursementSettings.create({
      data: {
        companyId: id,
        version: 1,
        enabled: true,
        approverName: 'Maria',
        approverPhone: '5511988887777',
        changedByUserId: 'admin',
      },
    });
    return id;
  }
  const draft = (companyId: string, amountCents = 150000) =>
    batches.create(companyId, 'user', {
      reference: 'Folha 10/2026',
      items: [
        { recipientId: ana, amountCents },
        { recipientId: bruno, amountCents: 98000 },
      ],
    });

  beforeAll(async () => {
    await prisma.onModuleInit();
    companyA = await company();
    companyB = await company();
    ana = (
      await recipients.create(companyA, {
        name: 'Ana Souza',
        document: '52998224725',
        pixKey: '52998224725',
      })
    ).id;
    bruno = (
      await recipients.create(companyA, {
        name: 'Bruno Lima',
        document: '11144477735',
        bankIspb: '09089356',
        bankAgency: '1',
        bankAccount: '123453',
        bankAccountType: 'cacc',
      })
    ).id;
  });
  afterAll(() => prisma.$disconnect());

  it('creates a draft with a snapshot that later edits of the collaborator do not change', async () => {
    const batch = await draft(companyA);
    expect(batch).toMatchObject({
      status: 'DRAFT',
      totalCents: 248000,
      itemCount: 2,
      approval: null,
    });
    const current = await prisma.disbursementRecipient.findUniqueOrThrow({
      where: { id: ana },
    });
    await recipients.update(companyA, ana, {
      name: 'Ana Souza',
      document: '52998224725',
      pixKey: 'ana@example.com',
      expectedVersion: current.version,
      active: true,
    });
    const item = (await batches.get(companyA, batch.id)).items.find(
      (i) => i.recipientId === ana,
    );
    expect(item?.pixKey).toBe('52998224725');
  });

  it('another company can neither see nor use this company batches or collaborators', async () => {
    const batch = await draft(companyA);
    await expect(batches.get(companyB, batch.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      batches.update(companyB, batch.id, {
        reference: 'x',
        items: [{ recipientId: ana, amountCents: 1 }],
        expectedVersion: batch.version,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(batches.cancel(companyB, batch.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      batches.retryFailed(companyB, 'user', batch.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      batches.create(companyB, 'user', {
        reference: 'Roubo',
        items: [{ recipientId: ana, amountCents: 1 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      (await batches.list(companyB, { page: 1, pageSize: 20 })).total,
    ).toBe(0);
  });

  it('two edits of the same version: one wins, the other gets 409', async () => {
    const batch = await draft(companyA);
    const edits = await Promise.allSettled(
      [100, 200].map((amountCents) =>
        batches.update(companyA, batch.id, {
          reference: 'Folha',
          items: [{ recipientId: ana, amountCents }],
          expectedVersion: batch.version,
        }),
      ),
    );
    expect(edits.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (edits.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason,
    ).toBeInstanceOf(ConflictException);
    const after = await batches.get(companyA, batch.id);
    expect(after.items).toHaveLength(1);
    expect(after.version).toBe(batch.version + 1);
  });

  it('a batch awaiting approval cannot be edited; canceling invalidates its request', async () => {
    const batch = await draft(companyA);
    await prisma.disbursementBatch.update({
      where: { id: batch.id },
      data: { status: 'AWAITING_APPROVAL', approvalRequests: 1 },
    });
    await prisma.disbursementApproval.create({
      data: {
        batchId: batch.id,
        companyId: companyA,
        requestNumber: 1,
        contentHash: 'hash',
        totalCents: batch.totalCents,
        itemCount: batch.itemCount,
        settingsVersion: 1,
        approverPhoneHash: 'phone',
        expiresAt: new Date(Date.now() + 86_400_000),
        requestedByUserId: 'user',
      },
    });
    await expect(
      batches.update(companyA, batch.id, {
        reference: 'Folha',
        items: [{ recipientId: ana, amountCents: 1 }],
        expectedVersion: batch.version,
      }),
    ).rejects.toMatchObject({ response: { code: 'BATCH_NOT_EDITABLE' } });
    const canceled = await batches.cancel(companyA, batch.id);
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.approval?.state).toBe('INVALIDATED');
    expect(canceled.items.every((i) => i.status === 'CANCELED')).toBe(true);
  });

  it('a batch being paid cannot be canceled by the company', async () => {
    const batch = await draft(companyA);
    await prisma.disbursementBatch.update({
      where: { id: batch.id },
      data: { status: 'PROCESSING' },
    });
    await expect(batches.cancel(companyA, batch.id)).rejects.toMatchObject({
      response: { code: 'BATCH_NOT_CANCELABLE' },
    });
  });

  it('failed items: a double click opens one retry; after it may have paid, no second one', async () => {
    const source = await draft(companyA);
    await prisma.disbursementBatch.update({
      where: { id: source.id },
      data: { status: 'COMPLETED_WITH_FAILURES' },
    });
    await prisma.disbursementItem.updateMany({
      where: { batchId: source.id, recipientId: ana },
      data: { status: 'PAID' },
    });
    await prisma.disbursementItem.updateMany({
      where: { batchId: source.id, recipientId: bruno },
      data: { status: 'FAILED', failureReason: 'Conta inexistente' },
    });
    const clicks = await Promise.all([
      batches.retryFailed(companyA, 'user', source.id),
      batches.retryFailed(companyA, 'user', source.id),
    ]);
    expect(clicks[0].id).toBe(clicks[1].id);
    expect(clicks[0]).toMatchObject({
      status: 'DRAFT',
      retryOfBatchId: source.id,
      totalCents: 98000,
      itemCount: 1,
    });
    expect(clicks[0].items.map((i) => i.recipientId)).toEqual([bruno]);

    await prisma.disbursementBatch.update({
      where: { id: clicks[0].id },
      data: { status: 'COMPLETED' },
    });
    await expect(
      batches.retryFailed(companyA, 'user', source.id),
    ).rejects.toMatchObject({ response: { code: 'BATCH_ALREADY_RETRIED' } });
  });

  it('a retry that paid nothing (canceled) allows a new one', async () => {
    const source = await draft(companyA);
    await prisma.disbursementBatch.update({
      where: { id: source.id },
      data: { status: 'COMPLETED_WITH_FAILURES' },
    });
    await prisma.disbursementItem.updateMany({
      where: { batchId: source.id },
      data: { status: 'FAILED' },
    });
    const first = await batches.retryFailed(companyA, 'user', source.id);
    await batches.cancel(companyA, first.id);
    const second = await batches.retryFailed(companyA, 'user', source.id);
    expect(second.id).not.toBe(first.id);
    await expect(
      batches.retryFailed(companyA, 'user', (await draft(companyA)).id),
    ).rejects.toMatchObject({ response: { code: 'BATCH_HAS_NO_FAILURES' } });
  });
});

describe('Approval on WhatsApp (disposable PostgreSQL, simulated transport)', () => {
  const prisma = new PrismaService(new ConfigService({ ...process.env }));
  const identities = new Map<string, string>();
  const eligibility = {
    resolveIssuance: jest.fn((companyId: string) =>
      Promise.resolve({
        issuerIdentityId: identities.get(companyId),
        accountMode: 'CUSTOMER_ACCOUNT',
        payoutMode: 'DIRECT_TO_CUSTOMER',
      }),
    ),
  };
  const policy = {
    resolve: jest.fn().mockResolvedValue({
      allowed: true,
      template: {
        parsed: { quickReplies: ['Aprovar pagamento', 'Recusar'] },
        mapping: { body: {}, decisionButtons: { approve: 0, reject: 1 } },
      },
    }),
  };
  const settings = new DisbursementSettingsService(
    prisma,
    eligibility as never,
    policy as never,
  );
  const recipients = new DisbursementRecipientsService(prisma, settings);
  const batches = new DisbursementBatchesService(prisma, settings);
  const templateSender = { prepare: jest.fn() };
  const whatsapp = {
    dispatchIntent: jest.fn(),
    enqueueAdminReply: jest.fn().mockResolvedValue({}),
    enqueuePreparedTemplate: jest.fn().mockResolvedValue({}),
  };
  const approvals = new DisbursementApprovalService(
    prisma,
    settings,
    batches,
    eligibility as never,
    policy as never,
    templateSender as never,
    whatsapp as never,
    { decrypt: (value: string) => value } as never,
  );
  const CHANNEL = '123456789012345';
  const PHONE = '5511988887777';
  const future = new Date(Date.now() + 365 * 86_400_000);

  async function conversation(phone: string) {
    const recipient = messageRecipient({ type: 'PHONE', value: phone });
    return prisma.communicationConversation.upsert({
      where: {
        channel_recipientHash: {
          channel: 'WHATSAPP',
          recipientHash: recipient.hash,
        },
      },
      create: {
        channel: 'WHATSAPP',
        recipientHash: recipient.hash,
        recipientType: 'PHONE',
        recipientEncrypted: recipient.value,
        retentionExpiresAt: future,
      },
      update: {},
    });
  }
  // What the template preparer persists: the outbound message and its intent.
  async function outbound(logicalKey: string): Promise<string> {
    const recipient = messageRecipient({ type: 'PHONE', value: PHONE });
    const message = await prisma.communicationMessage.create({
      data: {
        conversationId: (await conversation(PHONE)).id,
        direction: 'OUTBOUND',
        content: 'Pedido de aprovação',
        transportChannelId: CHANNEL,
        recipientType: 'PHONE',
        messageType: 'template',
        retentionExpiresAt: future,
      },
    });
    return (
      await prisma.communicationOutboundIntent.create({
        data: {
          idempotencyKey: logicalKey,
          logicalKey,
          messageId: message.id,
          transport: 'DATAFY',
          transportChannelId: CHANNEL,
          recipientType: 'PHONE',
          recipientHash: recipient.hash,
          recipientEncrypted: recipient.value,
          requestHash: 'a'.repeat(64),
          retentionExpiresAt: future,
        },
      })
    ).id;
  }
  async function accept(intentId: string) {
    const wamid = `wamid.out.${randomUUID()}`;
    const intent = await prisma.communicationOutboundIntent.update({
      where: { id: intentId },
      data: { state: 'ACCEPTED', externalMessageId: wamid },
    });
    await prisma.communicationMessage.update({
      where: { id: intent.messageId },
      data: { externalMessageId: wamid },
    });
    return { messageId: wamid, status: 'accepted' };
  }
  // What the Datafy webhook persists when someone answers on WhatsApp.
  async function tap(
    approvalId: string,
    content: string,
    options: { phone?: string; type?: string; cite?: string; at?: Date } = {},
  ) {
    const approval = await prisma.disbursementApproval.findUniqueOrThrow({
      where: { id: approvalId },
    });
    const intent = await prisma.communicationOutboundIntent.findUniqueOrThrow({
      where: { id: approval.intentId! },
    });
    const at = options.at ?? new Date();
    return prisma.communicationMessage.create({
      data: {
        conversationId: (await conversation(options.phone ?? PHONE)).id,
        direction: 'INBOUND',
        content,
        externalMessageId: `wamid.in.${randomUUID()}`,
        transportChannelId: CHANNEL,
        recipientType: 'PHONE',
        replyToExternalMessageId: options.cite ?? intent.externalMessageId,
        messageType: options.type ?? 'button',
        providerTimestamp: at,
        createdAt: at,
        retentionExpiresAt: future,
      },
    });
  }
  async function tenant() {
    const companyId = (
      await prisma.company.create({
        data: {
          corporateName: 'Tenant LTDA',
          document: randomUUID().replace(/\D/g, '').slice(0, 14),
          email: `${randomUUID()}@example.test`,
          phoneNumber: '5511999990000',
        },
      })
    ).id;
    identities.set(
      companyId,
      (
        await prisma.efiAccountIdentity.create({
          data: {
            ownership: 'COMPANY',
            companyId,
            environment: 'HOMOLOGATION',
            holderDocument: '11222333000181',
            efiAccountNumber: randomUUID().replace(/\D/g, '').slice(0, 10),
            pixKey: 'chave-da-empresa@example.com',
          },
        })
      ).id,
    );
    await prisma.disbursementSettings.create({
      data: {
        companyId,
        version: 1,
        enabled: true,
        approverName: 'Maria',
        approverPhone: PHONE,
        changedByUserId: 'admin',
      },
    });
    const ana = await recipients.create(companyId, {
      name: 'Ana Souza',
      document: '52998224725',
      pixKey: '52998224725',
    });
    const bruno = await recipients.create(companyId, {
      name: 'Bruno Lima',
      document: '11144477735',
      pixKey: 'bruno@example.com',
    });
    return { companyId, ana, bruno };
  }
  async function requested() {
    const t = await tenant();
    const draft = await batches.create(t.companyId, 'user', {
      reference: 'Folha 10/2026',
      items: [
        { recipientId: t.ana.id, amountCents: 150000 },
        { recipientId: t.bruno.id, amountCents: 98000 },
      ],
    });
    const batch = await approvals.request(
      t.companyId,
      'user',
      draft.id,
      draft.version,
    );
    const approval = await prisma.disbursementApproval.findFirstOrThrow({
      where: { batchId: draft.id },
      orderBy: { requestNumber: 'desc' },
    });
    return { ...t, batch, approval };
  }
  const statusOf = async (batchId: string) =>
    (
      await prisma.disbursementBatch.findUniqueOrThrow({
        where: { id: batchId },
      })
    ).status;
  const stateOf = async (approvalId: string) =>
    (
      await prisma.disbursementApproval.findUniqueOrThrow({
        where: { id: approvalId },
      })
    ).state;

  beforeAll(() => prisma.onModuleInit());
  beforeEach(() => {
    jest.clearAllMocks();
    templateSender.prepare.mockImplementation(
      async (request: { logicalKey: string }) => ({
        status: 'QUEUED',
        intentId: await outbound(request.logicalKey),
      }),
    );
    whatsapp.dispatchIntent.mockImplementation(accept);
  });
  afterAll(() => prisma.$disconnect());

  it('requests approval with a frozen batch, the current registration and a 24 h deadline', async () => {
    const t = await tenant();
    const draft = await batches.create(t.companyId, 'user', {
      reference: 'Folha 10/2026',
      items: [{ recipientId: t.ana.id, amountCents: 150000 }],
    });
    // Edited after the draft: the request authorizes what is registered now.
    await recipients.update(t.companyId, t.ana.id, {
      name: 'Ana Souza',
      document: '52998224725',
      pixKey: 'ana@example.com',
      expectedVersion: t.ana.version,
      active: true,
    });
    const before = Date.now();
    const batch = await approvals.request(
      t.companyId,
      'user',
      draft.id,
      draft.version,
    );
    expect(batch.status).toBe('AWAITING_APPROVAL');
    expect(batch.items[0]?.pixKey).toBe('ana@example.com');
    const approval = await prisma.disbursementApproval.findFirstOrThrow({
      where: { batchId: draft.id },
    });
    expect(approval).toMatchObject({
      state: 'AWAITING',
      requestNumber: 1,
      totalCents: 150000,
      itemCount: 1,
      approveLabel: 'Aprovar pagamento',
      rejectLabel: 'Recusar',
      approverPhoneHash: messageRecipient({ type: 'PHONE', value: PHONE }).hash,
    });
    expect(approval.expiresAt.getTime() - before).toBeGreaterThanOrEqual(
      86_400_000 - 1000,
    );
    expect(templateSender.prepare).toHaveBeenCalledWith({
      logicalKey: `disbursement-approval:${approval.id}`,
      origin: 'DISBURSEMENT',
      context: { companyId: t.companyId, disbursementApprovalId: approval.id },
      selection: { mode: 'DEFAULT', purpose: 'DISBURSEMENT_APPROVAL' },
    });
    expect(whatsapp.dispatchIntent).toHaveBeenCalledWith(approval.intentId);
    await expect(
      batches.update(t.companyId, draft.id, {
        reference: 'x',
        items: [{ recipientId: t.ana.id, amountCents: 1 }],
        expectedVersion: batch.version,
      }),
    ).rejects.toMatchObject({ response: { code: 'BATCH_NOT_EDITABLE' } });
  });

  it('refuses a request for a batch of another company, an old version or an inactive collaborator', async () => {
    const a = await tenant();
    const b = await tenant();
    const draft = await batches.create(a.companyId, 'user', {
      reference: 'Folha',
      items: [{ recipientId: a.ana.id, amountCents: 100 }],
    });
    await expect(
      approvals.request(b.companyId, 'user', draft.id, draft.version),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      approvals.request(a.companyId, 'user', draft.id, draft.version + 1),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });
    await recipients.update(a.companyId, a.ana.id, {
      name: 'Ana Souza',
      document: '52998224725',
      pixKey: '52998224725',
      expectedVersion: a.ana.version,
      active: false,
    });
    await expect(
      approvals.request(a.companyId, 'user', draft.id, draft.version),
    ).rejects.toMatchObject({ response: { code: 'RECIPIENT_INACTIVE' } });
    expect(templateSender.prepare).not.toHaveBeenCalled();
  });

  it('a held template or a refused send returns the batch to draft', async () => {
    const t = await tenant();
    const items = [{ recipientId: t.ana.id, amountCents: 100 }];
    const held = await batches.create(t.companyId, 'user', {
      reference: 'A',
      items,
    });
    templateSender.prepare.mockResolvedValueOnce({
      status: 'BLOCKED',
      pendingId: 'hold',
      code: 'NOT_GRANTED',
    });
    await expect(
      approvals.request(t.companyId, 'user', held.id, held.version),
    ).rejects.toMatchObject({
      response: { code: 'DISBURSEMENT_APPROVAL_NOT_SENT' },
    });
    expect(await statusOf(held.id)).toBe('DRAFT');
    const failed = await batches.create(t.companyId, 'user', {
      reference: 'B',
      items,
    });
    whatsapp.dispatchIntent.mockImplementationOnce(async (id: string) => {
      await prisma.communicationOutboundIntent.update({
        where: { id },
        data: { state: 'FAILED' },
      });
      throw new Error('REJECTED');
    });
    await expect(
      approvals.request(t.companyId, 'user', failed.id, failed.version),
    ).rejects.toMatchObject({
      response: { code: 'DISBURSEMENT_APPROVAL_NOT_SENT' },
    });
    expect(await statusOf(failed.id)).toBe('DRAFT');
    const states = await prisma.disbursementApproval.findMany({
      where: { batchId: { in: [held.id, failed.id] } },
    });
    expect(states.map((s) => s.state)).toEqual(['HELD', 'HELD']);
    // Waiting for the channel limit may still reach the approver: the request stays open.
    const waiting = await batches.create(t.companyId, 'user', {
      reference: 'C',
      items,
    });
    whatsapp.dispatchIntent.mockRejectedValueOnce(new Error('RATE_LIMIT'));
    await approvals.request(t.companyId, 'user', waiting.id, waiting.version);
    expect(await statusOf(waiting.id)).toBe('AWAITING_APPROVAL');
  });

  it('the approve button pays; one decision and one confirmation even with concurrent ticks', async () => {
    const r = await requested();
    await tap(r.approval.id, 'Aprovar pagamento');
    await Promise.all([
      approvals.decideAwaiting(),
      approvals.decideAwaiting(),
      approvals.decide(r.approval.id),
    ]);
    const approval = await prisma.disbursementApproval.findUniqueOrThrow({
      where: { id: r.approval.id },
    });
    expect(approval.state).toBe('APPROVED');
    expect(approval.decisionMessageId).not.toBeNull();
    const batch = await prisma.disbursementBatch.findUniqueOrThrow({
      where: { id: r.batch.id },
    });
    expect(batch.status).toBe('PROCESSING');
    expect(batch.version).toBe(r.batch.version + 1);
    await approvals.sendAcks();
    await approvals.sendAcks();
    expect(whatsapp.enqueueAdminReply).toHaveBeenCalledTimes(1);
    expect(whatsapp.enqueueAdminReply).toHaveBeenCalledWith(
      PHONE,
      'Aprovação registrada. Os 2 pagamentos do lote Folha 10/2026 (total de R$ 2.480,00) estão sendo enviados por Pix.',
      `disbursement-ack:${r.approval.id}`,
      expect.objectContaining({ context: { companyId: r.companyId } }),
    );
  });

  it('the refuse button cancels the batch and confirms it', async () => {
    const r = await requested();
    await tap(r.approval.id, 'Recusar');
    await approvals.decideAwaiting();
    expect(await stateOf(r.approval.id)).toBe('REJECTED');
    expect(await statusOf(r.batch.id)).toBe('REJECTED');
    const items = await prisma.disbursementItem.findMany({
      where: { batchId: r.batch.id },
    });
    expect(items.every((item) => item.status === 'CANCELED')).toBe(true);
    await approvals.sendAcks();
    expect(whatsapp.enqueueAdminReply).toHaveBeenCalledWith(
      PHONE,
      'Recusa registrada. Nenhum pagamento do lote Folha 10/2026 será feito.',
      expect.any(String),
      expect.any(Object),
    );
  });

  it.each([
    ['typed text with the button label', { type: 'text' }, 'Aprovar pagamento'],
    [
      'a tap citing another message',
      { cite: 'wamid.other' },
      'Aprovar pagamento',
    ],
    ['another phone', { phone: '5521977776666' }, 'Aprovar pagamento'],
    ['another quick reply', {}, 'Preciso de ajuda'],
    [
      'a tap after the deadline',
      { at: new Date(Date.now() + 2 * 86_400_000) },
      'Aprovar pagamento',
    ],
  ])('%s authorizes nothing', async (_, options, content) => {
    const r = await requested();
    await tap(r.approval.id, content, options);
    await approvals.decideAwaiting();
    expect(await stateOf(r.approval.id)).toBe('AWAITING');
    expect(await statusOf(r.batch.id)).toBe('AWAITING_APPROVAL');
  });

  it('accepts the approver number as WhatsApp reports it without the ninth digit', async () => {
    const r = await requested();
    await tap(r.approval.id, 'Aprovar pagamento', { phone: '551188887777' });
    await approvals.decideAwaiting();
    expect(await stateOf(r.approval.id)).toBe('APPROVED');
    await approvals.sendAcks();
    // The confirmation goes to the chat the tap came from.
    expect((whatsapp.enqueueAdminReply.mock.calls as unknown[][])[0]?.[0]).toBe(
      '551188887777',
    );
  });

  it('a canceled batch, a new approver or the feature turned off: the tap pays nothing and gets one notice', async () => {
    const canceled = await requested();
    await batches.cancel(canceled.companyId, canceled.batch.id);
    const replaced = await requested();
    await settings.configure(replaced.companyId, 'admin', {
      expectedVersion: 1,
      enabled: true,
      approverName: 'Outro aprovador',
      approverPhone: '5521977776666',
    });
    const disabled = await requested();
    await settings.configure(disabled.companyId, 'admin', {
      expectedVersion: 1,
      enabled: false,
      approverName: 'Maria',
      approverPhone: PHONE,
    });
    for (const r of [canceled, replaced, disabled])
      await tap(r.approval.id, 'Aprovar pagamento');
    await approvals.decideAwaiting();
    expect(await stateOf(canceled.approval.id)).toBe('INVALIDATED');
    expect(await statusOf(canceled.batch.id)).toBe('CANCELED');
    expect(await stateOf(replaced.approval.id)).toBe('INVALIDATED');
    expect(await statusOf(replaced.batch.id)).toBe('DRAFT');
    expect(await stateOf(disabled.approval.id)).toBe('INVALIDATED');
    expect(await statusOf(disabled.batch.id)).toBe('CANCELED');
    await approvals.sendAcks();
    await approvals.sendAcks();
    expect(whatsapp.enqueueAdminReply).toHaveBeenCalledTimes(3);
    for (const call of whatsapp.enqueueAdminReply.mock.calls as unknown[][])
      expect(call[1]).toBe(
        'Este pedido de aprovação não vale mais. Nenhum pagamento foi feito por ele.',
      );
  });

  it('a batch changed behind the request is never paid', async () => {
    const r = await requested();
    await prisma.disbursementItem.updateMany({
      where: { batchId: r.batch.id, recipientId: r.ana.id },
      data: { pixKey: 'golpe@example.com' },
    });
    await tap(r.approval.id, 'Aprovar pagamento');
    await approvals.decideAwaiting();
    expect(await stateOf(r.approval.id)).toBe('INVALIDATED');
    expect(await statusOf(r.batch.id)).toBe('DRAFT');
  });

  it('without an answer in 24 h the batch expires and the approver is told once to pay manually', async () => {
    const r = await requested();
    await prisma.disbursementApproval.update({
      where: { id: r.approval.id },
      data: { expiresAt: new Date(Date.now() - 3 * 60_000) },
    });
    await approvals.expireOverdue();
    expect(await stateOf(r.approval.id)).toBe('EXPIRED');
    expect(await statusOf(r.batch.id)).toBe('EXPIRED');
    const items = await prisma.disbursementItem.findMany({
      where: { batchId: r.batch.id },
    });
    expect(items.every((item) => item.status === 'CANCELED')).toBe(true);
    await approvals.notifyExpired();
    await approvals.notifyExpired();
    const notices = (
      templateSender.prepare.mock.calls as [{ logicalKey: string }][]
    ).filter(
      ([request]) =>
        request.logicalKey === `disbursement-expired:${r.approval.id}`,
    );
    expect(notices).toEqual([
      [
        {
          logicalKey: `disbursement-expired:${r.approval.id}`,
          origin: 'DISBURSEMENT',
          context: {
            companyId: r.companyId,
            disbursementApprovalId: r.approval.id,
          },
          selection: { mode: 'DEFAULT', purpose: 'DISBURSEMENT_EXPIRED' },
        },
      ],
    ]);
    expect(whatsapp.enqueuePreparedTemplate).toHaveBeenCalledTimes(1);
    // A tap now pays nothing.
    await tap(r.approval.id, 'Aprovar pagamento');
    await approvals.decideAwaiting();
    expect(await statusOf(r.batch.id)).toBe('EXPIRED');
  });

  it('a request whose message was never prepared returns to draft', async () => {
    const t = await tenant();
    const draft = await batches.create(t.companyId, 'user', {
      reference: 'Folha',
      items: [{ recipientId: t.ana.id, amountCents: 100 }],
    });
    templateSender.prepare.mockRejectedValueOnce(new Error('process lost'));
    await expect(
      approvals.request(t.companyId, 'user', draft.id, draft.version),
    ).rejects.toThrow('process lost');
    expect(await statusOf(draft.id)).toBe('AWAITING_APPROVAL');
    await prisma.disbursementApproval.updateMany({
      where: { batchId: draft.id },
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    await approvals.releaseUnsent();
    expect(await statusOf(draft.id)).toBe('DRAFT');
  });
});

describe('Pix send of approved batches (disposable PostgreSQL, simulated Efí)', () => {
  const prisma = new PrismaService(new ConfigService({ ...process.env }));
  const policy = { resolve: jest.fn() };
  const settings = new DisbursementSettingsService(
    prisma,
    {} as never,
    policy as never,
  );
  const environments = new Map<string, 'HOMOLOGATION' | 'PRODUCTION'>();
  const client = {
    account: jest.fn((identityId: string) =>
      Promise.resolve({
        identityId,
        pixKey: 'chave-da-empresa',
        environment: environments.get(identityId) ?? 'PRODUCTION',
        sdk: {},
      }),
    ),
    send: jest.fn(),
    status: jest.fn(),
    balanceCents: jest.fn().mockResolvedValue(10_000_000),
    receipt: jest.fn(),
  };
  const sender = new DisbursementSenderService(
    prisma,
    settings,
    client as never,
  );

  // An approved batch: what the approval leaves behind for the sender.
  async function approved(
    amounts: number[],
    environment: 'HOMOLOGATION' | 'PRODUCTION' = 'PRODUCTION',
  ) {
    const companyId = (
      await prisma.company.create({
        data: {
          corporateName: 'Tenant LTDA',
          document: randomUUID().replace(/\D/g, '').slice(0, 14),
          email: `${randomUUID()}@example.test`,
          phoneNumber: '5511999990000',
        },
      })
    ).id;
    const identityId = (
      await prisma.efiAccountIdentity.create({
        data: {
          ownership: 'COMPANY',
          companyId,
          environment,
          holderDocument: '11222333000181',
          efiAccountNumber: randomUUID().replace(/\D/g, '').slice(0, 10),
          pixKey: 'chave-da-empresa',
        },
      })
    ).id;
    environments.set(identityId, environment);
    const credential = await prisma.efiCredentialVersion.create({
      data: {
        identityId,
        version: 1,
        status: 'ACTIVE',
        encryptedClientId: 'cifrado',
        encryptedClientSecret: 'cifrado',
        encryptedCertificate: 'cifrado',
        credentialKeyVersion: 'v1',
        certificateFingerprint: randomBytes(32)
          .toString('hex')
          .toUpperCase()
          .match(/../g)!
          .join(':'),
        certificateExpiresAt: new Date(Date.now() + 365 * 86_400_000),
      },
    });
    // The active profile and the company pointer are checked together by the database.
    await prisma.$transaction(async (tx) => {
      const profile = await tx.financialProfileVersion.create({
        data: {
          companyId,
          version: 1,
          status: 'ACTIVE',
          origin: 'MANUAL_ADMIN',
          accountMode: 'CUSTOMER_ACCOUNT',
          payoutMode: 'DIRECT_TO_CUSTOMER',
          environment,
          enabledMethods: ['PIX'],
          issuerIdentityId: identityId,
          issuerCredentialVersionId: credential.id,
          authorizationKind: 'ACCOUNT_INTEGRATION_AUTHORIZATION',
          authorizationReference: 'contrato',
          ownershipVerifiedAt: new Date(),
          validatedAt: new Date(),
          validationHash: 'hash',
          activatedAt: new Date(),
          activationIdempotencyKey: randomUUID(),
          creationIdempotencyKey: randomUUID(),
        },
      });
      await tx.company.update({
        where: { id: companyId },
        data: { activeFinancialProfileId: profile.id },
      });
    });
    await prisma.disbursementSettings.create({
      data: {
        companyId,
        version: 1,
        enabled: true,
        approverName: 'Maria',
        approverPhone: '5511988887777',
        changedByUserId: 'admin',
      },
    });
    const batch = await prisma.disbursementBatch.create({
      data: {
        companyId,
        reference: 'Folha 10/2026',
        status: 'PROCESSING',
        issuerIdentityId: identityId,
        totalCents: amounts.reduce((a, b) => a + b, 0),
        itemCount: amounts.length,
        createdByUserId: 'user',
      },
    });
    const items = [];
    for (const [index, amountCents] of amounts.entries()) {
      const document = String(10_000_000_000 + index);
      const recipient = await prisma.disbursementRecipient.create({
        data: {
          companyId,
          name: `Colaborador ${index}`,
          documentType: 'CPF',
          document,
          pixKey: `c${index}@example.com`,
        },
      });
      const id = randomUUID();
      items.push(
        await prisma.disbursementItem.create({
          data: {
            id,
            idEnvio: id.replace(/-/g, ''),
            batchId: batch.id,
            companyId,
            recipientId: recipient.id,
            recipientName: recipient.name,
            documentType: 'CPF',
            document,
            pixKey: recipient.pixKey,
            amountCents,
          },
        }),
      );
    }
    return { companyId, identityId, batchId: batch.id, items };
  }
  const itemsOf = (batchId: string) =>
    prisma.disbursementItem.findMany({
      where: { batchId },
      orderBy: { recipientName: 'asc' },
    });

  beforeAll(() => prisma.onModuleInit());
  beforeEach(() => {
    jest.clearAllMocks();
    client.balanceCents.mockResolvedValue(10_000_000);
  });
  afterAll(() => prisma.$disconnect());

  it('sends each item once, by its own send id, even with two workers at the same time', async () => {
    const b = await approved([100, 200, 300]);
    client.send.mockImplementation(
      async (_account: unknown, input: { idEnvio: string }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { kind: 'IN_PROCESSING', e2eId: `E-${input.idEnvio}` };
      },
    );
    await Promise.all([
      sender.sendBatch(b.batchId),
      sender.sendBatch(b.batchId),
    ]);
    expect(client.send).toHaveBeenCalledTimes(3);
    const sentIds = client.send.mock.calls.map(
      (call) => (call as [unknown, { idEnvio: string }])[1].idEnvio,
    );
    expect(new Set(sentIds)).toEqual(new Set(b.items.map((i) => i.idEnvio)));
    const items = await itemsOf(b.batchId);
    expect(items.map((i) => i.status)).toEqual([
      'IN_PROCESSING',
      'IN_PROCESSING',
      'IN_PROCESSING',
    ]);
    expect(items.every((i) => i.e2eId === `E-${i.idEnvio}`)).toBe(true);
  });

  it('records each answer of Efí; a possibly processed send is never a failure', async () => {
    const b = await approved([100, 200, 300, 400, 500]);
    const outcomes: SendOutcome[] = [
      { kind: 'PAID', e2eId: 'E-paid' },
      {
        kind: 'REFUSED',
        code: 'chave_favorecido_nao_encontrada',
        reason: 'Chave Pix do colaborador não encontrada',
      },
      { kind: 'DUPLICATE' },
      { kind: 'UNCERTAIN' },
    ];
    client.send.mockImplementation(() =>
      outcomes.length
        ? Promise.resolve(outcomes.shift())
        : Promise.reject(new Error('socket hang up')),
    );
    await sender.sendBatch(b.batchId);
    const items = await itemsOf(b.batchId);
    expect(items.map((i) => [i.status, i.failureReason])).toEqual([
      ['PAID', null],
      ['FAILED', 'Chave Pix do colaborador não encontrada'],
      ['UNCERTAIN', null],
      ['UNCERTAIN', null],
      ['UNCERTAIN', null],
    ]);
  });

  it('the channel limit pauses the batch and keeps the item to send later', async () => {
    const b = await approved([100, 200]);
    client.send.mockResolvedValue({ kind: 'RATE_LIMITED' });
    await sender.sendBatch(b.batchId);
    expect(client.send).toHaveBeenCalledTimes(1);
    expect((await itemsOf(b.batchId)).map((i) => i.status)).toEqual([
      'PENDING',
      'PENDING',
    ]);
    const batch = await prisma.disbursementBatch.findUniqueOrThrow({
      where: { id: b.batchId },
    });
    expect(batch.sendPausedUntil!.getTime()).toBeGreaterThan(Date.now());
    await sender.sendApproved();
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('a changed paying account or a batch not covered by the balance sends nothing', async () => {
    const moved = await approved([100]);
    const other = await prisma.efiAccountIdentity.create({
      data: {
        ownership: 'COMPANY',
        companyId: moved.companyId,
        environment: 'PRODUCTION',
        holderDocument: '11222333000181',
        efiAccountNumber: randomUUID().replace(/\D/g, '').slice(0, 10),
        pixKey: 'outra-chave',
      },
    });
    // Approved for another account than the one active now (profiles are immutable).
    await prisma.disbursementBatch.update({
      where: { id: moved.batchId },
      data: { issuerIdentityId: other.id },
    });
    await sender.sendBatch(moved.batchId);
    const poor = await approved([60_000, 50_000]);
    client.balanceCents.mockResolvedValue(100_000);
    await sender.sendBatch(poor.batchId);
    expect(client.send).not.toHaveBeenCalled();
    expect((await itemsOf(moved.batchId))[0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'ISSUER_CHANGED',
    });
    expect(
      (await itemsOf(poor.batchId)).map((i) => [i.status, i.failureReason]),
    ).toEqual([
      [
        'FAILED',
        'Saldo insuficiente na conta Efí: disponível R$ 1.000,00, necessário R$ 1.100,00; nada foi enviado',
      ],
      [
        'FAILED',
        'Saldo insuficiente na conta Efí: disponível R$ 1.000,00, necessário R$ 1.100,00; nada foi enviado',
      ],
    ]);
  });

  it('homologation never checks the balance (always zero there)', async () => {
    const b = await approved([100], 'HOMOLOGATION');
    client.balanceCents.mockResolvedValue(0);
    client.send.mockResolvedValue({ kind: 'IN_PROCESSING', e2eId: 'E1' });
    await sender.sendBatch(b.batchId);
    expect(client.balanceCents).not.toHaveBeenCalled();
    expect((await itemsOf(b.batchId))[0]?.status).toBe('IN_PROCESSING');
  });

  it('turning the feature off stops the next items; batches not approved never send', async () => {
    const b = await approved([100, 200]);
    client.send.mockImplementation(async () => {
      await settings.configure(b.companyId, 'admin', {
        expectedVersion: 1,
        enabled: false,
        approverName: 'Maria',
        approverPhone: '5511988887777',
      });
      return { kind: 'IN_PROCESSING', e2eId: 'E1' };
    });
    await sender.sendBatch(b.batchId);
    expect(client.send).toHaveBeenCalledTimes(1);
    expect((await itemsOf(b.batchId)).map((i) => i.status)).toEqual([
      'IN_PROCESSING',
      'CANCELED',
    ]);
    const waiting = await approved([100]);
    await prisma.disbursementBatch.update({
      where: { id: waiting.batchId },
      data: { status: 'AWAITING_APPROVAL' },
    });
    client.send.mockClear();
    await sender.sendBatch(waiting.batchId);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('a lost send is checked by its id: paid, refused, or kept under verification', async () => {
    const b = await approved([100, 200, 300]);
    const [paid, refused, unknown] = b.items;
    await prisma.disbursementItem.updateMany({
      where: { batchId: b.batchId },
      data: { status: 'SENDING', sendingAt: new Date(Date.now() - 5 * 60_000) },
    });
    client.status.mockImplementation((_account: unknown, idEnvio: string) =>
      idEnvio === paid!.idEnvio
        ? {
            kind: 'FOUND',
            status: 'REALIZADO',
            e2eId: 'E-p',
            settledAt: new Date(),
          }
        : idEnvio === refused!.idEnvio
          ? {
              kind: 'FOUND',
              status: 'NAO_REALIZADO',
              e2eId: 'E-r',
              settledAt: null,
            }
          : { kind: 'NOT_FOUND' },
    );
    await sender.reconcile();
    const items = new Map((await itemsOf(b.batchId)).map((i) => [i.id, i]));
    expect(items.get(paid!.id)).toMatchObject({ status: 'PAID', e2eId: 'E-p' });
    expect(items.get(refused!.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'Recusado pelo banco (motivo não informado)',
    });
    expect(items.get(unknown!.id)?.status).toBe('UNCERTAIN');
    // Checked again only after a minute.
    client.status.mockClear();
    await sender.reconcile();
    expect(client.status).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('the receipt is only for a paid item of the same company', async () => {
    const a = await approved([100, 200]);
    const b = await approved([100]);
    await prisma.disbursementItem.update({
      where: { id: a.items[0]!.id },
      data: { status: 'PAID' },
    });
    client.receipt.mockResolvedValue(Buffer.from('%PDF-1.4'));
    await expect(sender.receipt(a.companyId, a.items[0]!.id)).resolves.toEqual(
      Buffer.from('%PDF-1.4'),
    );
    await expect(
      sender.receipt(b.companyId, a.items[0]!.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      sender.receipt(a.companyId, a.items[1]!.id),
    ).rejects.toMatchObject({ response: { code: 'RECEIPT_UNAVAILABLE' } });
  });

  // Webhook notices as captured in the Efí homologation.
  const webhook = new DisbursementWebhookService(prisma);
  const notice = (
    idEnvio: string,
    status: 'REALIZADO' | 'NAO_REALIZADO',
    extra: Record<string, unknown> = {},
  ) => ({
    endToEndId: `E-${idEnvio}`,
    chave: 'chave-da-empresa',
    tipo: 'SOLICITACAO',
    status,
    valor: '1.00',
    horario: status === 'REALIZADO' ? '2026-10-17T08:23:31.000Z' : null,
    gnExtras: { idEnvio },
    ...extra,
  });
  const statusOfItem = async (id: string) =>
    prisma.disbursementItem.findUniqueOrThrow({ where: { id } });

  it('the webhook pays or fails an item once, with the reason Efí gave', async () => {
    const b = await approved([100, 200]);
    const [paid, failed] = b.items;
    await prisma.disbursementItem.updateMany({
      where: { batchId: b.batchId },
      data: { status: 'IN_PROCESSING', sentAt: new Date() },
    });
    await expect(
      webhook.apply(notice(paid!.idEnvio, 'REALIZADO')),
    ).resolves.toMatchObject({ result: 'APPLIED' });
    await expect(
      webhook.apply(notice(paid!.idEnvio, 'REALIZADO')),
    ).resolves.toMatchObject({ result: 'IGNORED' });
    await expect(
      webhook.apply(notice(paid!.idEnvio, 'NAO_REALIZADO')),
    ).resolves.toMatchObject({ result: 'SEND_STATUS_CONFLICT' });
    expect(await statusOfItem(paid!.id)).toMatchObject({
      status: 'PAID',
      settledAt: new Date('2026-10-17T08:23:31.000Z'),
    });
    await webhook.apply(
      notice(failed!.idEnvio, 'NAO_REALIZADO', {
        gnExtras: {
          idEnvio: failed!.idEnvio,
          erro: {
            codigo: 'AC03',
            origem: 'PSP do usuário recebedor',
            motivo:
              'Número da agência e/ou conta transacional do usuário recebedor inexistente ou inválido',
          },
        },
      }),
    );
    expect(await statusOfItem(failed!.id)).toMatchObject({
      status: 'FAILED',
      failureCode: 'AC03',
      failureReason:
        'Número da agência e/ou conta transacional do usuário recebedor inexistente ou inválido',
    });
  });

  it('a notice from another key, an unknown send id or a refund changes nothing', async () => {
    const b = await approved([100]);
    const item = b.items[0]!;
    await prisma.disbursementItem.update({
      where: { id: item.id },
      data: { status: 'IN_PROCESSING' },
    });
    await expect(
      webhook.apply(
        notice(item.idEnvio, 'REALIZADO', { chave: 'chave-de-outra-conta' }),
      ),
    ).resolves.toMatchObject({ result: 'SEND_KEY_MISMATCH' });
    await expect(
      webhook.apply(notice(randomUUID().replace(/-/g, ''), 'REALIZADO')),
    ).resolves.toEqual({ result: 'UNKNOWN_SEND_ID' });
    expect((await statusOfItem(item.id)).status).toBe('IN_PROCESSING');
    await webhook.apply(notice(item.idEnvio, 'REALIZADO'));
    // Refunds are not handled in this version: the item stays paid.
    await expect(
      webhook.apply(
        notice(item.idEnvio, 'REALIZADO', {
          devolucoes: [
            {
              id: 'D1',
              rtrId: 'D1',
              valor: '1.00',
              natureza: 'ORIGINAL',
              status: 'DEVOLVIDO',
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({ result: 'IGNORED' });
    expect((await statusOfItem(item.id)).status).toBe('PAID');
  });

  it('a notice that arrives before the send answer is recorded wins', async () => {
    const b = await approved([100]);
    client.send.mockImplementation(
      async (_account: unknown, input: { idEnvio: string }) => {
        await webhook.apply(notice(input.idEnvio, 'REALIZADO'));
        return { kind: 'IN_PROCESSING', e2eId: 'E-late' };
      },
    );
    await sender.sendBatch(b.batchId);
    expect((await statusOfItem(b.items[0]!.id)).status).toBe('PAID');
  });

  it('a batch completes only when every item is known, then the approver hears the failures once', async () => {
    const allPaid = await approved([100, 200]);
    const someFailed = await approved([100, 200]);
    const stillChecking = await approved([100, 200]);
    await prisma.disbursementItem.updateMany({
      where: { batchId: allPaid.batchId },
      data: { status: 'PAID' },
    });
    await prisma.disbursementItem.update({
      where: { id: someFailed.items[0]!.id },
      data: { status: 'PAID' },
    });
    await prisma.disbursementItem.update({
      where: { id: someFailed.items[1]!.id },
      data: {
        status: 'FAILED',
        failureReason: 'Chave Pix do colaborador não encontrada',
      },
    });
    await prisma.disbursementItem.updateMany({
      where: { batchId: stillChecking.batchId },
      data: { status: 'FAILED' },
    });
    await prisma.disbursementItem.update({
      where: { id: stillChecking.items[0]!.id },
      data: { status: 'UNCERTAIN' },
    });
    const approval = await prisma.disbursementApproval.create({
      data: {
        batchId: someFailed.batchId,
        companyId: someFailed.companyId,
        requestNumber: 1,
        contentHash: 'hash',
        totalCents: 300,
        itemCount: 2,
        settingsVersion: 1,
        approverPhoneHash: 'phone',
        expiresAt: new Date(Date.now() + 86_400_000),
        requestedByUserId: 'user',
        state: 'APPROVED',
        intentId: randomUUID(),
      },
    });
    await sender.completeFinished();
    const statusOfBatch = async (id: string) =>
      (await prisma.disbursementBatch.findUniqueOrThrow({ where: { id } }))
        .status;
    expect(await statusOfBatch(allPaid.batchId)).toBe('COMPLETED');
    expect(await statusOfBatch(someFailed.batchId)).toBe(
      'COMPLETED_WITH_FAILURES',
    );
    expect(await statusOfBatch(stillChecking.batchId)).toBe('PROCESSING');

    const templateSender = {
      prepare: jest.fn().mockResolvedValue({ status: 'QUEUED', intentId: 'i' }),
    };
    const whatsapp = { enqueuePreparedTemplate: jest.fn() };
    const approvals = new DisbursementApprovalService(
      prisma,
      settings,
      {} as never,
      {} as never,
      policy as never,
      templateSender as never,
      whatsapp as never,
      {} as never,
    );
    await approvals.notifyFailures();
    await approvals.notifyFailures();
    // Other approved batches of this shared database may be notified too; this one once.
    const ours = (
      templateSender.prepare.mock.calls as [{ logicalKey: string }][]
    ).filter(
      ([request]) =>
        request.logicalKey === `disbursement-failed:${approval.id}`,
    );
    expect(ours).toEqual([
      [
        {
          logicalKey: `disbursement-failed:${approval.id}`,
          origin: 'DISBURSEMENT',
          context: {
            companyId: someFailed.companyId,
            disbursementApprovalId: approval.id,
          },
          selection: { mode: 'DEFAULT', purpose: 'DISBURSEMENT_FAILED' },
        },
      ],
    ]);
    // Nothing is announced for a batch still under verification or fully paid.
    expect(
      await prisma.disbursementApproval.count({
        where: {
          batchId: { in: [allPaid.batchId, stillChecking.batchId] },
          noticeSentAt: { not: null },
        },
      }),
    ).toBe(0);
  });
});
