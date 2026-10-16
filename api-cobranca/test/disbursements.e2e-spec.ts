import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinancialEligibilityService } from '../src/financial-activation/financial-eligibility.service';
import { DisbursementSettingsService } from '../src/disbursements/disbursement-settings.service';
import { DisbursementRecipientsService } from '../src/disbursements/disbursement-recipients.service';
import { DisbursementBatchesService } from '../src/disbursements/disbursement-batches.service';

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
          document: '11222333000181',
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

  it('enabling without an active financial profile is refused', async () => {
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
    const [current] = (
      await recipients.list(companyA, { page: 1, pageSize: 20 })
    ).items;
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
