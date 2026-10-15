import { ConflictException, HttpException } from '@nestjs/common';
import { DisbursementSettingsService } from './disbursement-settings.service';

describe('disbursement settings (admin)', () => {
  const dto = {
    expectedVersion: 0,
    enabled: true,
    approverName: ' Maria Souza ',
    approverPhone: '5511988887777',
  };
  function fixture(current: Record<string, unknown> | null = null) {
    const tx = {
      $queryRaw: jest.fn(),
      disbursementSettings: {
        findFirst: jest.fn().mockResolvedValue(current),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({
          id: 'settings',
          ...data,
        })),
      },
      disbursementApproval: { updateMany: jest.fn() },
      disbursementBatch: { updateMany: jest.fn() },
      disbursementItem: { updateMany: jest.fn() },
    };
    const prisma = {
      company: { findUnique: jest.fn().mockResolvedValue({ id: 'company' }) },
      efiAccountIdentity: {
        findFirst: jest.fn().mockResolvedValue({ pixKey: 'chave' }),
      },
      disbursementSettings: {
        findFirst: jest.fn().mockResolvedValue(current),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
    };
    const eligibility = {
      resolveIssuance: jest.fn().mockResolvedValue({
        issuerIdentityId: 'identity',
        accountMode: 'CUSTOMER_ACCOUNT',
        payoutMode: 'DIRECT_TO_CUSTOMER',
      }),
    };
    return {
      tx,
      prisma,
      eligibility,
      service: new DisbursementSettingsService(
        prisma as never,
        eligibility as never,
      ),
    };
  }
  async function failure(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('expected a failure');
  }

  it('creates a new version instead of overwriting the previous one', async () => {
    const f = fixture({ version: 1, approverPhone: '5511988887777' });
    await f.service.configure('company', 'admin', {
      ...dto,
      expectedVersion: 1,
    });
    expect(f.tx.disbursementSettings.create).toHaveBeenCalledWith({
      data: {
        companyId: 'company',
        version: 2,
        enabled: true,
        approverName: 'Maria Souza',
        approverPhone: '5511988887777',
        changedByUserId: 'admin',
      },
    });
  });

  it('answers 409 when another admin changed the settings first', async () => {
    const f = fixture({ version: 2, approverPhone: '5511988887777' });
    const error = await failure(
      f.service.configure('company', 'admin', { ...dto, expectedVersion: 1 }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'VERSION_CHANGED' });
    expect(f.tx.disbursementSettings.create).not.toHaveBeenCalled();
  });

  it('refuses to enable without an active customer Efí account', async () => {
    const f = fixture();
    f.eligibility.resolveIssuance.mockRejectedValue(
      new HttpException(
        {
          code: 'FINANCIAL_PROFILE_NOT_READY',
          message: 'Conclua a ativação financeira antes de emitir cobranças.',
        },
        409,
      ),
    );
    const error = await failure(f.service.configure('company', 'admin', dto));
    expect(error.getResponse()).toMatchObject({
      code: 'DISBURSEMENT_NOT_READY',
      missing: [
        expect.objectContaining({ code: 'FINANCIAL_PROFILE_NOT_READY' }),
      ],
    });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to enable on the platform account or without a Pix key', async () => {
    const platform = fixture();
    platform.eligibility.resolveIssuance.mockResolvedValue({
      issuerIdentityId: 'identity',
      accountMode: 'PLATFORM_ACCOUNT',
      payoutMode: 'EFI_SPLIT',
    });
    expect(
      (
        await failure(platform.service.configure('company', 'admin', dto))
      ).getResponse(),
    ).toMatchObject({
      missing: [
        expect.objectContaining({ code: 'FINANCIAL_MODE_NOT_SUPPORTED' }),
      ],
    });
    const noKey = fixture();
    noKey.prisma.efiAccountIdentity.findFirst.mockResolvedValue({
      pixKey: null,
    });
    expect(
      (
        await failure(noKey.service.configure('company', 'admin', dto))
      ).getResponse(),
    ).toMatchObject({
      missing: [expect.objectContaining({ code: 'PIX_KEY_MISSING' })],
    });
  });

  it('disabling cancels what is awaiting approval and items not yet sent', async () => {
    const f = fixture({ version: 1, approverPhone: '5511988887777' });
    await f.service.configure('company', 'admin', {
      ...dto,
      expectedVersion: 1,
      enabled: false,
    });
    expect(f.eligibility.resolveIssuance).not.toHaveBeenCalled();
    expect(f.tx.disbursementItem.updateMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company',
        status: 'PENDING',
        batch: { status: { in: ['AWAITING_APPROVAL', 'PROCESSING'] } },
      },
      data: { status: 'CANCELED' },
    });
    expect(f.tx.disbursementApproval.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company', state: 'AWAITING' },
      data: { state: 'INVALIDATED' },
    });
    expect(f.tx.disbursementBatch.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company', status: 'AWAITING_APPROVAL' },
      data: { status: 'CANCELED', version: { increment: 1 } },
    });
    // Items already sent stay under verification: only PENDING is touched.
    expect(f.tx.disbursementItem.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a new approver invalidates requests sent to the previous one', async () => {
    const f = fixture({ version: 1, approverPhone: '5511900001111' });
    await f.service.configure('company', 'admin', {
      ...dto,
      expectedVersion: 1,
    });
    expect(f.tx.disbursementApproval.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company', state: 'AWAITING' },
      data: { state: 'INVALIDATED' },
    });
    expect(f.tx.disbursementBatch.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company', status: 'AWAITING_APPROVAL' },
      data: { status: 'DRAFT', version: { increment: 1 } },
    });
    expect(f.tx.disbursementItem.updateMany).not.toHaveBeenCalled();
  });

  it('keeping the same approver leaves pending requests untouched', async () => {
    const f = fixture({ version: 1, approverPhone: '5511988887777' });
    await f.service.configure('company', 'admin', {
      ...dto,
      expectedVersion: 1,
    });
    expect(f.tx.disbursementApproval.updateMany).not.toHaveBeenCalled();
    expect(f.tx.disbursementBatch.updateMany).not.toHaveBeenCalled();
  });

  it('unknown company answers 404 before any write', async () => {
    const f = fixture();
    f.prisma.company.findUnique.mockResolvedValue(null);
    const error = await failure(f.service.configure('company', 'admin', dto));
    expect(error.getStatus()).toBe(404);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});
