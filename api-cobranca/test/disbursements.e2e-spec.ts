import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinancialEligibilityService } from '../src/financial-activation/financial-eligibility.service';
import { DisbursementSettingsService } from '../src/disbursements/disbursement-settings.service';

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
