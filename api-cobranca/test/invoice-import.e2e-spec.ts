import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { InvoicesService } from '../src/invoices/invoices.service';
import type { MessageQueueService } from '../src/queue/message.queue';
import type { PaymentService } from '../src/payment/payment.service';

jest.setTimeout(60_000);

// Real PostgreSQL: bulk writes, the transaction and the unique WhatsApp rule.
describe('importacao de cobrancas com revisao (PostgreSQL)', () => {
  const prisma = new PrismaService(new ConfigService({ ...process.env }));
  const service = new InvoicesService(
    prisma,
    { addInitialChargeJobs: jest.fn() } as unknown as MessageQueueService,
    {
      hasActiveFinancialProfile: jest.fn().mockResolvedValue(false),
    } as unknown as PaymentService,
  );
  let companyId: string;
  let otherCompanyId: string;
  let profileId: string;

  const ANA = '52998224725';
  const BRUNO = '11144477735';
  const CARLA = '39053344705';
  const row = (overrides: Record<string, unknown>) => ({
    name: 'Ana Souza',
    document: ANA,
    phone_number: '+5511999990001',
    email: 'ana@example.com',
    original_amount: 150,
    due_date: '2026-11-10',
    billing_type: 'PIX' as const,
    whatsapp_opt_in: true,
    ...overrides,
  });
  const company = async () =>
    (
      await prisma.company.create({
        data: {
          corporateName: 'Import tenant LTDA',
          document: randomUUID().replace(/\D/g, '').slice(0, 14),
          email: `${randomUUID()}@example.test`,
          phoneNumber: '5511999990000',
        },
      })
    ).id;

  beforeAll(async () => {
    companyId = await company();
    otherCompanyId = await company();
    await prisma.collectionProfile.create({
      data: { companyId, name: 'Novo pagador', profileType: 'NEW' },
    });
    profileId = (
      await prisma.collectionProfile.create({
        data: {
          companyId,
          name: 'Bons pagadores',
          profileType: 'GOOD',
        },
      })
    ).id;
    await prisma.debtor.createMany({
      data: [
        // Same document, other data and a custom profile.
        {
          companyId,
          name: 'Ana Maria',
          document: ANA,
          phoneNumber: '+5511999990009',
          email: 'velho@example.com',
          collectionProfileId: profileId,
        },
        // Owns the WhatsApp that Carla's row brings.
        {
          companyId,
          name: 'Bruno',
          document: BRUNO,
          phoneNumber: '+5511999990003',
        },
        // Another company: never seen.
        {
          companyId: otherCompanyId,
          name: 'Ana de outra empresa',
          document: ANA,
          phoneNumber: '+5511999990001',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({
      where: { companyId: { in: [companyId, otherCompanyId] } },
    });
    await prisma.debtor.deleteMany({
      where: { companyId: { in: [companyId, otherCompanyId] } },
    });
    await prisma.$disconnect();
  });

  it('revisa, aplica as escolhas e cria em lote, sem tocar no perfil nem em outra empresa', async () => {
    const rows = [
      row({}),
      row({ original_amount: 90, due_date: '2026-12-10' }),
      row({
        name: 'Carla',
        document: CARLA,
        phone_number: '+5511999990003',
        email: '',
      }),
      row({
        name: 'Diego',
        document: '87748248800',
        phone_number: '+5511999990004',
        email: '',
      }),
    ];

    const { clients } = await service.previewImport(companyId, rows);
    const ana = clients.find((client) => client.document === ANA);
    expect(ana).toMatchObject({
      kind: 'DIFFERENT',
      rows: [0, 1],
      differences: ['name', 'phone', 'email'],
    });
    expect(clients.find((client) => client.document === CARLA)).toMatchObject({
      kind: 'PHONE_TAKEN',
      phoneOwner: { name: 'Bruno' },
    });
    expect(
      clients.find((client) => client.document === '87748248800'),
    ).toMatchObject({ kind: 'NEW' });

    await expect(service.importCsv(companyId, rows)).rejects.toMatchObject({
      response: { code: 'IMPORT_NEEDS_REVIEW' },
    });
    if (ana?.kind !== 'DIFFERENT') throw new Error('unexpected review');

    const result = await service.importCsv(companyId, rows, [
      {
        document: ANA,
        action: 'LINK',
        debtorId: ana.existing.debtorId,
        version: ana.existing.version,
        use: { name: 'EXISTING', phone: 'CSV', email: 'CSV' },
      },
      { document: CARLA, action: 'SKIP' },
    ]);
    expect(result).toMatchObject({
      count: 3,
      skipped: [{ document: CARLA, name: 'Carla', rows: [2] }],
    });

    const updated = await prisma.debtor.findUniqueOrThrow({
      where: { id: ana.existing.debtorId },
    });
    expect(updated).toMatchObject({
      name: 'Ana Maria',
      phoneNumber: '+5511999990001',
      email: 'ana@example.com',
      collectionProfileId: profileId,
      whatsappOptIn: true,
    });
    expect(
      await prisma.invoice.count({ where: { debtorId: updated.id } }),
    ).toBe(2);
    expect(
      await prisma.debtor.count({ where: { companyId, document: CARLA } }),
    ).toBe(0);
    expect(
      await prisma.debtor.findFirstOrThrow({
        where: { companyId: otherCompanyId, document: ANA },
      }),
    ).toMatchObject({ name: 'Ana de outra empresa' });
  });

  it('recusa decisoes de um cadastro que mudou depois da revisao, sem gravar nada', async () => {
    const rows = [row({ name: 'Ana Revisada', original_amount: 10 })];
    const [ana] = (await service.previewImport(companyId, rows)).clients;
    if (ana?.kind !== 'DIFFERENT') throw new Error('unexpected review');
    await prisma.debtor.update({
      where: { id: ana.existing.debtorId },
      data: { email: 'mudou@example.com' },
    });
    const before = await prisma.invoice.count({ where: { companyId } });

    await expect(
      service.importCsv(companyId, rows, [
        {
          document: ANA,
          action: 'LINK',
          debtorId: ana.existing.debtorId,
          version: ana.existing.version,
          use: { name: 'CSV', phone: 'EXISTING', email: 'EXISTING' },
        },
      ]),
    ).rejects.toMatchObject({ response: { code: 'IMPORT_CHANGED' } });
    expect(await prisma.invoice.count({ where: { companyId } })).toBe(before);
  });

  it('vincula cliente antigo sem documento pelo WhatsApp e grava o CPF/CNPJ', async () => {
    const legacy = await prisma.debtor.create({
      data: {
        companyId,
        name: 'Cliente antigo',
        phoneNumber: '+5511999990077',
        collectionProfileId: profileId,
      },
    });
    const rows = [
      row({
        name: 'Cliente antigo',
        document: '39053344705',
        phone_number: '+5511999990077',
        email: '',
      }),
    ];
    const [review] = (await service.previewImport(companyId, rows)).clients;
    expect(review).toMatchObject({
      kind: 'UNDOCUMENTED_OWNER',
      differences: [],
    });
    if (review?.kind !== 'UNDOCUMENTED_OWNER')
      throw new Error('unexpected review');

    await service.importCsv(companyId, rows, [
      {
        document: '39053344705',
        action: 'LINK',
        debtorId: legacy.id,
        version: review.existing.version,
        use: { name: 'EXISTING', phone: 'EXISTING', email: 'EXISTING' },
      },
    ]);
    expect(
      await prisma.debtor.findUniqueOrThrow({ where: { id: legacy.id } }),
    ).toMatchObject({
      document: '39053344705',
      collectionProfileId: profileId,
    });
    expect(await prisma.invoice.count({ where: { debtorId: legacy.id } })).toBe(
      1,
    );
  });

  it('importa mais de mil cobrancas de uma vez', async () => {
    const rows = Array.from({ length: 1200 }, (_, index) =>
      row({
        name: 'Diego',
        document: '87748248800',
        phone_number: '+5511999990004',
        email: '',
        original_amount: 10 + index,
      }),
    );
    const result = await service.importCsv(companyId, rows, []);
    expect(result.count).toBe(1200);
  });
});
