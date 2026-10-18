import { DisbursementDocumentType } from '@prisma/client';
import { validateDebtorDocument } from '../common/debtor-document';

export type PixKeyType = 'CPF' | 'CNPJ' | 'PHONE' | 'EMAIL' | 'EVP';
// contaBanco.tipoConta accepted by Efí in homologation: checking, savings and payment
// accounts. A salary account (slry) is refused: it does not receive Pix transfers.
export const BANK_ACCOUNT_TYPES = ['cacc', 'svgs', 'tran'] as const;

export interface RecipientInput {
  name: string;
  document: string;
  pixKey?: string | null;
  bankIspb?: string | null;
  bankAgency?: string | null;
  bankAccount?: string | null;
  bankAccountType?: string | null;
}
export interface NormalizedRecipient {
  name: string;
  documentType: DisbursementDocumentType;
  document: string;
  pixKey: string | null;
  bankIspb: string | null;
  bankAgency: string | null;
  bankAccount: string | null;
  bankAccountType: string | null;
}
export type RecipientCheck =
  | { ok: true; data: NormalizedRecipient }
  | { ok: false; message: string };

const EVP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Keys in DICT format. A phone needs +55 so it is never mistaken for a CPF. */
export function normalizePixKey(
  raw: string,
): { type: PixKeyType; value: string } | null {
  const value = raw.trim();
  if (EVP.test(value.toLowerCase()))
    return { type: 'EVP', value: value.toLowerCase() };
  if (value.includes('@')) {
    const email = value.toLowerCase();
    return email.length <= 77 && EMAIL.test(email)
      ? { type: 'EMAIL', value: email }
      : null;
  }
  if (value.startsWith('+')) {
    const phone = `+${value.slice(1).replace(/[\s().-]/g, '')}`;
    return /^\+55\d{10,11}$/.test(phone)
      ? { type: 'PHONE', value: phone }
      : null;
  }
  if (!/^[\d.\-/\s]+$/.test(value)) return null;
  const document = validateDebtorDocument(value);
  if (!document.valid) return null;
  return {
    type: document.normalized.length === 11 ? 'CPF' : 'CNPJ',
    value: document.normalized,
  };
}

function blank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === '';
}

export function normalizeRecipient(input: RecipientInput): RecipientCheck {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120)
    return { ok: false, message: 'Informe o nome com 2 a 120 caracteres.' };
  const document = validateDebtorDocument(input.document);
  if (!document.valid) return { ok: false, message: 'CPF ou CNPJ inválido.' };
  const base = {
    name,
    documentType: (document.normalized.length === 11
      ? 'CPF'
      : 'CNPJ') as DisbursementDocumentType,
    document: document.normalized,
  };
  const bank = [
    input.bankIspb,
    input.bankAgency,
    input.bankAccount,
    input.bankAccountType,
  ];
  const hasKey = !blank(input.pixKey);
  const bankFilled = bank.filter((value) => !blank(value)).length;
  if (hasKey && bankFilled)
    return {
      ok: false,
      message: 'Informe a chave Pix ou os dados bancários, não os dois.',
    };
  if (hasKey) {
    const key = normalizePixKey(input.pixKey!);
    if (!key) return { ok: false, message: 'Chave Pix inválida.' };
    // A CPF/CNPJ key always belongs to that document; any other one cannot be the collaborator's.
    if (
      (key.type === 'CPF' || key.type === 'CNPJ') &&
      key.value !== base.document
    )
      return {
        ok: false,
        message:
          'A chave Pix por CPF ou CNPJ deve ser o documento do próprio colaborador.',
      };
    return {
      ok: true,
      data: {
        ...base,
        pixKey: key.value,
        bankIspb: null,
        bankAgency: null,
        bankAccount: null,
        bankAccountType: null,
      },
    };
  }
  if (bankFilled < 4)
    return {
      ok: false,
      message:
        'Informe a chave Pix ou os dados bancários completos: banco (ISPB), agência, conta e tipo.',
    };
  const ispb = input.bankIspb!.trim();
  const agency = input.bankAgency!.trim();
  const account = input.bankAccount!.replace(/[\s.-]/g, '');
  const type = input.bankAccountType!.trim().toLowerCase();
  if (!/^\d{8}$/.test(ispb))
    return { ok: false, message: 'O ISPB do banco deve ter 8 dígitos.' };
  if (!/^\d{1,4}$/.test(agency))
    return {
      ok: false,
      message: 'Agência inválida: use até 4 dígitos, sem o dígito verificador.',
    };
  if (!/^\d{1,20}$/.test(account))
    return {
      ok: false,
      message: 'Conta inválida: use somente números, com o dígito.',
    };
  if (!(BANK_ACCOUNT_TYPES as readonly string[]).includes(type))
    return { ok: false, message: 'Tipo de conta inválido.' };
  return {
    ok: true,
    data: {
      ...base,
      pixKey: null,
      bankIspb: ispb,
      bankAgency: agency,
      bankAccount: account,
      bankAccountType: type,
    },
  };
}
