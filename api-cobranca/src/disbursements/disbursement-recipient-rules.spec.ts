import {
  normalizePixKey,
  normalizeRecipient,
} from './disbursement-recipient-rules';

describe('collaborator rules', () => {
  const cpf = '529.982.247-25';
  const bank = {
    bankIspb: '09089356',
    bankAgency: '0001',
    bankAccount: '12345-3',
    bankAccountType: 'CACC',
  };

  it.each([
    ['529.982.247-25', { type: 'CPF', value: '52998224725' }],
    ['11.222.333/0001-81', { type: 'CNPJ', value: '11222333000181' }],
    ['+55 (11) 98888-7777', { type: 'PHONE', value: '+5511988887777' }],
    ['Pessoa@Example.com', { type: 'EMAIL', value: 'pessoa@example.com' }],
    [
      '2C3C7441-B91E-4982-3C25-6105581E18AE',
      { type: 'EVP', value: '2c3c7441-b91e-4982-3c25-6105581e18ae' },
    ],
  ])('recognizes the Pix key %s', (raw, expected) => {
    expect(normalizePixKey(raw)).toEqual(expected);
  });

  it.each([
    '11988887777',
    '529.982.247-24',
    '+1 202 555 0100',
    'sem-arroba',
    '',
  ])('refuses the ambiguous or invalid key %s', (raw) => {
    expect(normalizePixKey(raw)).toBeNull();
  });

  it('normalizes a collaborator paid by Pix key', () => {
    expect(
      normalizeRecipient({
        name: '  Ana   Souza ',
        document: cpf,
        pixKey: cpf,
      }),
    ).toEqual({
      ok: true,
      data: {
        name: 'Ana Souza',
        documentType: 'CPF',
        document: '52998224725',
        pixKey: '52998224725',
        bankIspb: null,
        bankAgency: null,
        bankAccount: null,
        bankAccountType: null,
      },
    });
  });

  it('normalizes a company paid by bank account', () => {
    const result = normalizeRecipient({
      name: 'Prestador LTDA',
      document: '11222333000181',
      ...bank,
    });
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        documentType: 'CNPJ',
        pixKey: null,
        bankAccount: '123453',
        bankAccountType: 'cacc',
      }) as unknown,
    });
  });

  it('a CPF key of someone else is refused', () => {
    expect(
      normalizeRecipient({ name: 'Ana', document: cpf, pixKey: '11144477735' }),
    ).toMatchObject({ ok: false });
  });

  it.each([
    [{ pixKey: cpf, ...bank }, 'não os dois'],
    [{ bankIspb: '09089356', bankAgency: '0001' }, 'completos'],
    [{}, 'completos'],
    [{ ...bank, bankIspb: '123' }, 'ISPB'],
    [{ ...bank, bankAccountType: 'corrente' }, 'Tipo de conta'],
    [{ ...bank, bankAccountType: 'slry' }, 'Tipo de conta'],
  ])(
    'requires exactly one complete destination (%o)',
    (destination, message) => {
      const result = normalizeRecipient({
        name: 'Ana',
        document: cpf,
        ...destination,
      });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toContain(message);
    },
  );

  it('refuses an invalid document or name', () => {
    expect(
      normalizeRecipient({
        name: 'Ana',
        document: '111.111.111-11',
        pixKey: cpf,
      }),
    ).toMatchObject({ ok: false, message: 'CPF ou CNPJ inválido.' });
    expect(
      normalizeRecipient({ name: ' A ', document: cpf, pixKey: cpf }),
    ).toMatchObject({ ok: false });
  });
});
