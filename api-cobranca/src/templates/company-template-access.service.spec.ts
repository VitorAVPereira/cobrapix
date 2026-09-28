import { CompanyTemplateAccessService } from './company-template-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TemplatePolicyService } from './template-policy.service';

function setup(grant: { enabled: boolean; version: number }) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    company: { findUnique: jest.fn().mockResolvedValue({ id: 'company-a' }) },
    globalMessageTemplate: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'template-1', origin: 'META_IMPORTED' }),
    },
    companyWhatsappTemplateGrant: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'grant-1', ...grant }),
      update: jest.fn().mockResolvedValue({ version: grant.version + 1 }),
    },
    whatsappTemplateAudit: { create: jest.fn() },
  };
  const policy = {
    readiness: jest
      .fn()
      .mockResolvedValue({ ready: false, code: 'NOT_APPROVED' }),
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  return {
    service: new CompanyTemplateAccessService(
      prisma as unknown as PrismaService,
      policy as unknown as TemplatePolicyService,
    ),
    tx,
    policy,
  };
}

describe('CompanyTemplateAccessService', () => {
  it('answers 409 to a stale expected version without writing', async () => {
    const { service, tx } = setup({ enabled: false, version: 2 });
    await expect(
      service.setGrant('company-a', 'template-1', true, 1, 'admin'),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.companyWhatsappTemplateGrant.update).not.toHaveBeenCalled();
    expect(tx.whatsappTemplateAudit.create).not.toHaveBeenCalled();
  });

  it('only grants usable templates but always allows revoking', async () => {
    const off = setup({ enabled: false, version: 0 });
    await expect(
      off.service.setGrant('company-a', 'template-1', true, 0, 'admin'),
    ).rejects.toMatchObject({ status: 422 });
    const on = setup({ enabled: true, version: 1 });
    await expect(
      on.service.setGrant('company-a', 'template-1', false, 1, 'admin'),
    ).resolves.toEqual({ version: 2 });
    expect(on.policy.readiness).not.toHaveBeenCalled();
    expect(on.tx.whatsappTemplateAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'GRANT_REVOKED',
        actorUserId: 'admin',
      }) as unknown,
    });
  });

  it('does not bump the version when nothing changes', async () => {
    const { service, tx } = setup({ enabled: true, version: 4 });
    await expect(
      service.setGrant('company-a', 'template-1', true, 4, 'admin'),
    ).resolves.toEqual({ version: 4 });
    expect(tx.companyWhatsappTemplateGrant.update).not.toHaveBeenCalled();
  });
});
