import {
  normalizeDebtorDocument,
  validateDebtorDocument,
} from './debtor-document';

describe('debtor document', () => {
  it('normaliza CPF e CNPJ mantendo apenas digitos', () => {
    expect(normalizeDebtorDocument('123.456.789-09')).toBe('12345678909');
    expect(normalizeDebtorDocument('11.222.333/0001-81')).toBe(
      '11222333000181',
    );
  });

  it('rejeita documentos sem 11 ou 14 digitos', () => {
    expect(validateDebtorDocument('123')).toEqual({
      valid: false,
      normalized: '123',
    });
  });

  it('rejeita documentos fake com todos os digitos iguais', () => {
    expect(validateDebtorDocument('000.000.000-00')).toEqual({
      valid: false,
      normalized: '00000000000',
    });
  });

  it('rejeita CPF com digitos verificadores invalidos', () => {
    expect(validateDebtorDocument('123.456.789-00')).toEqual({
      valid: false,
      normalized: '12345678900',
    });
  });

  it('rejeita CNPJ com digitos verificadores invalidos', () => {
    expect(validateDebtorDocument('11.222.333/0001-80')).toEqual({
      valid: false,
      normalized: '11222333000180',
    });
  });

  it('aceita CPF e CNPJ com digitos verificadores validos', () => {
    expect(validateDebtorDocument('123.456.789-09')).toEqual({
      valid: true,
      normalized: '12345678909',
    });
    expect(validateDebtorDocument('11.222.333/0001-81')).toEqual({
      valid: true,
      normalized: '11222333000181',
    });
  });
});
