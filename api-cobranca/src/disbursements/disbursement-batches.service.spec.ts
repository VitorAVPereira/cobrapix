import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DisbursementBatchesService,
  HashedItem,
  batchContentHash,
} from './disbursement-batches.service';

describe('batch content hash', () => {
  const ana: HashedItem = {
    documentType: 'CPF',
    document: '52998224725',
    pixKey: '52998224725',
    bankIspb: null,
    bankAgency: null,
    bankAccount: null,
    bankAccountType: null,
    amountCents: 150000,
  };
  const bruno: HashedItem = {
    ...ana,
    document: '11144477735',
    pixKey: null,
    bankIspb: '09089356',
    bankAgency: '1',
    bankAccount: '123453',
    bankAccountType: 'cacc',
    amountCents: 98000,
  };
  const base = {
    reference: 'Folha 10/2026',
    issuerIdentityId: 'identity',
    items: [ana, bruno],
  };

  it('does not depend on the order of the items', () => {
    expect(batchContentHash(base)).toBe(
      batchContentHash({ ...base, items: [bruno, ana] }),
    );
  });

  it.each([
    ['amount', { items: [{ ...ana, amountCents: 150001 }, bruno] }],
    ['Pix key', { items: [{ ...ana, pixKey: 'ana@example.com' }, bruno] }],
    ['bank account', { items: [ana, { ...bruno, bankAccount: '123454' }] }],
    ['reference', { reference: 'Folha 11/2026' }],
    ['paying account', { issuerIdentityId: 'other-identity' }],
    ['removed item', { items: [ana] }],
  ])('changes when the %s changes', (_, change) => {
    expect(batchContentHash({ ...base, ...change })).not.toBe(
      batchContentHash(base),
    );
  });
});

describe('batch items', () => {
  const recipient = (id: string, active = true) => ({
    id,
    companyId: 'company',
    name: `Pessoa ${id}`,
    documentType: 'CPF',
    document: id.padStart(11, '0'),
    pixKey: 'chave@example.com',
    bankIspb: null,
    bankAgency: null,
    bankAccount: null,
    bankAccountType: null,
    active,
  });
  function fixture(recipients = [recipient('a'), recipient('b')]) {
    const tx = {
      $queryRaw: jest.fn(),
      disbursementRecipient: {
        findMany: jest.fn().mockResolvedValue(recipients),
      },
      disbursementBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch' }),
        findFirst: jest.fn(),
      },
      disbursementItem: { createMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
    };
    const settings = { assertEnabled: jest.fn().mockResolvedValue({}) };
    const service = new DisbursementBatchesService(
      prisma as never,
      settings as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    return { tx, service };
  }
  const create = (
    f: ReturnType<typeof fixture>,
    items: { recipientId: string; amountCents: number }[],
  ) => f.service.create('company', 'user', { reference: 'Folha', items });

  it('snapshots each collaborator with an Efí id derived from the item id', async () => {
    const f = fixture();
    await create(f, [
      { recipientId: 'a', amountCents: 100 },
      { recipientId: 'b', amountCents: 250 },
    ]);
    expect(f.tx.disbursementBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company',
        totalCents: 350,
        itemCount: 2,
      }) as unknown,
    });
    const [{ data }] = f.tx.disbursementItem.createMany.mock.calls[0] as [
      { data: Array<{ id: string; idEnvio: string; recipientName: string }> },
    ];
    expect(data.map((item) => item.recipientName)).toEqual([
      'Pessoa a',
      'Pessoa b',
    ]);
    for (const item of data) {
      expect(item.idEnvio).toBe(item.id.replace(/-/g, ''));
      expect(item.idEnvio).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('refuses the same collaborator twice', async () => {
    await expect(
      create(fixture(), [
        { recipientId: 'a', amountCents: 100 },
        { recipientId: 'a', amountCents: 100 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a total above the storage limit', async () => {
    await expect(
      create(fixture(), [
        { recipientId: 'a', amountCents: 2147483647 },
        { recipientId: 'b', amountCents: 1 },
      ]),
    ).rejects.toMatchObject({ response: { code: 'BATCH_TOTAL_TOO_HIGH' } });
  });

  it('a collaborator of another company is not found', async () => {
    const f = fixture([recipient('a')]);
    await expect(
      create(f, [{ recipientId: 'other-company', amountCents: 100 }]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.disbursementRecipient.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company', id: { in: ['other-company'] } },
    });
    expect(f.tx.disbursementBatch.create).not.toHaveBeenCalled();
  });

  it('an inactive collaborator cannot join a new batch', async () => {
    const f = fixture([recipient('a', false)]);
    await expect(
      create(f, [{ recipientId: 'a', amountCents: 100 }]),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.disbursementBatch.create).not.toHaveBeenCalled();
  });
});
