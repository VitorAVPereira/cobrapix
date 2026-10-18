import {
  groupImportRows,
  parseImportDecisions,
  planImport,
  reviewImportGroups,
  type ExistingClient,
  type ImportClientReview,
} from './invoice-import';

const ANA = '52998224725';
const BRUNO = '11144477735';

function row(
  overrides: Partial<Parameters<typeof groupImportRows>[0][number]>,
) {
  return {
    document: ANA,
    name: 'Ana Souza',
    phone_number: '+5511999990001',
    email: 'ana@example.com',
    whatsapp_opt_in: false,
    ...overrides,
  };
}

function client(overrides: Partial<ExistingClient>): ExistingClient {
  return {
    debtorId: '11111111-1111-4111-8111-111111111111',
    document: ANA,
    name: 'Ana Souza',
    phone: '+5511999990001',
    email: 'ana@example.com',
    whatsappOptIn: false,
    version: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function review(rows: ReturnType<typeof row>[], debtors: ExistingClient[]) {
  return reviewImportGroups(groupImportRows(rows).groups, debtors);
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { response?: { code?: string } }).response?.code;
  }
  return null;
};

describe('importacao de cobrancas: revisao de clientes', () => {
  it('agrupa as linhas por CPF/CNPJ e recusa planilha incoerente', () => {
    const { groups, errors } = groupImportRows([
      row({}),
      row({ whatsapp_opt_in: true }),
      row({
        document: BRUNO,
        name: 'Bruno',
        phone_number: '+5511999990002',
        email: '',
      }),
    ]);
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ rows: [0, 1], optIn: true });

    expect(groupImportRows([row({}), row({ name: 'Ana S.' })]).errors).toEqual([
      'Linhas 1, 2: mesmo CPF/CNPJ com nome, WhatsApp ou e-mail diferentes.',
    ]);
    expect(
      groupImportRows([row({}), row({ document: BRUNO, name: 'Bruno' })])
        .errors,
    ).toEqual(['Linhas 1, 2: o mesmo WhatsApp em CPF/CNPJ diferentes.']);
  });

  it('classifica cada cliente: novo, igual, diferente, WhatsApp em uso e documento duplicado', () => {
    const kinds = (debtors: ExistingClient[], overrides = {}) =>
      review([row(overrides)], debtors)[0];

    expect(kinds([])).toMatchObject({ kind: 'NEW', phoneOwner: null });
    expect(kinds([client({})])).toMatchObject({ kind: 'SAME' });
    // An empty e-mail in the spreadsheet is not a difference.
    expect(kinds([client({})], { email: '' })).toMatchObject({ kind: 'SAME' });
    expect(
      kinds([client({ name: 'Ana Maria', email: 'outra@example.com' })]),
    ).toMatchObject({ kind: 'DIFFERENT', differences: ['name', 'email'] });
    const other = client({
      debtorId: '22222222-2222-4222-8222-222222222222',
      document: BRUNO,
      name: 'Bruno',
    });
    expect(kinds([other])).toMatchObject({
      kind: 'PHONE_TAKEN',
      phoneOwner: { debtorId: other.debtorId, name: 'Bruno' },
    });
    expect(
      kinds([
        client({}),
        client({ debtorId: '33333333-3333-4333-8333-333333333333' }),
      ]),
    ).toMatchObject({ kind: 'DUPLICATE_DOCUMENT' });
  });

  it('cria clientes novos e vincula iguais sem decisao, concedendo a autorizacao da planilha', () => {
    const plan = planImport(
      review(
        [
          row({ whatsapp_opt_in: true }),
          row({
            document: BRUNO,
            name: 'Bruno',
            phone_number: '+5511999990002',
          }),
        ],
        [client({})],
      ),
      undefined,
    );
    expect(plan[0]).toMatchObject({
      action: 'LINK',
      update: {},
      grantOptIn: true,
    });
    expect(plan[1]).toMatchObject({ action: 'CREATE' });
  });

  it('aplica so os campos escolhidos da planilha e nunca o WhatsApp de outro cliente', () => {
    const existing = client({
      name: 'Ana Maria',
      phone: '+5511999990009',
      email: 'velho@example.com',
    });
    const reviews = review([row({ whatsapp_opt_in: true })], [existing]);
    const link = (
      use: Record<'name' | 'phone' | 'email', 'CSV' | 'EXISTING'>,
    ) =>
      planImport(reviews, [
        {
          document: ANA,
          action: 'LINK',
          debtorId: existing.debtorId,
          version: existing.version,
          use,
        },
      ])[0];

    expect(
      link({ name: 'CSV', phone: 'EXISTING', email: 'CSV' }),
    ).toMatchObject({
      action: 'LINK',
      update: { name: 'Ana Souza', email: 'ana@example.com' },
      // The consent in the spreadsheet is for its WhatsApp, which was not kept.
      grantOptIn: false,
    });
    expect(
      link({ name: 'EXISTING', phone: 'CSV', email: 'EXISTING' }),
    ).toMatchObject({
      update: { phoneNumber: '+5511999990001' },
      grantOptIn: true,
    });

    const owner = client({
      debtorId: '22222222-2222-4222-8222-222222222222',
      document: BRUNO,
    });
    const taken = review([row({})], [existing, owner]);
    expect(
      code(() =>
        planImport(taken, [
          {
            document: ANA,
            action: 'LINK',
            debtorId: existing.debtorId,
            version: existing.version,
            use: { name: 'EXISTING', phone: 'CSV', email: 'EXISTING' },
          },
        ]),
      ),
    ).toBe('IMPORT_CHANGED');
  });

  it('exige decisao para o que precisa de revisao e recusa decisao de outra versao do cliente', () => {
    const existing = client({ name: 'Ana Maria' });
    const reviews = review([row({})], [existing]);
    expect(code(() => planImport(reviews, undefined))).toBe(
      'IMPORT_NEEDS_REVIEW',
    );
    expect(code(() => planImport(reviews, []))).toBe('IMPORT_CHANGED');
    expect(
      code(() =>
        planImport(reviews, [
          {
            document: ANA,
            action: 'LINK',
            debtorId: existing.debtorId,
            version: '2026-10-02T00:00:00.000Z',
            use: { name: 'CSV', phone: 'EXISTING', email: 'EXISTING' },
          },
        ]),
      ),
    ).toBe('IMPORT_CHANGED');
    expect(
      planImport(reviews, [{ document: ANA, action: 'SKIP' }])[0],
    ).toMatchObject({
      action: 'SKIP',
    });
  });

  it('WhatsApp em uso so pode ser pulado; documento duplicado vincula ao escolhido', () => {
    const owner = client({ document: BRUNO, name: 'Bruno' });
    const taken = review([row({})], [owner]);
    expect(code(() => planImport(taken, undefined))).toBe(
      'IMPORT_NEEDS_REVIEW',
    );
    expect(
      planImport(taken, [{ document: ANA, action: 'SKIP' }])[0]?.action,
    ).toBe('SKIP');

    const second = client({
      debtorId: '33333333-3333-4333-8333-333333333333',
      phone: '+5511999990003',
    });
    const duplicated: ImportClientReview[] = review(
      [row({})],
      [client({}), second],
    );
    expect(
      planImport(duplicated, [
        {
          document: ANA,
          action: 'LINK',
          debtorId: second.debtorId,
          version: second.version,
          use: { name: 'EXISTING', phone: 'EXISTING', email: 'EXISTING' },
        },
      ])[0],
    ).toMatchObject({ action: 'LINK', debtorId: second.debtorId, update: {} });
  });

  it('valida o formato das decisoes recebidas', () => {
    expect(parseImportDecisions(undefined)).toBeUndefined();
    expect(parseImportDecisions([{ document: ANA, action: 'SKIP' }])).toEqual([
      { document: ANA, action: 'SKIP' },
    ]);
    for (const invalid of [
      {},
      [{ document: ANA, action: 'LINK', debtorId: 'x', version: 'v', use: {} }],
      [{ document: ANA, action: 'DELETE' }],
    ])
      expect(() => parseImportDecisions(invalid)).toThrow(
        'Decisões de importação inválidas.',
      );
  });
});
