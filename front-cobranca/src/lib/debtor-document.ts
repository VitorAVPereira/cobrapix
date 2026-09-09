export interface DebtorDocumentValidation {
  valid: boolean;
  normalized: string;
}

export function normalizeDebtorDocument(value: string): string {
  return value.replace(/\D/g, "");
}

export function validateDebtorDocument(value: string): DebtorDocumentValidation {
  const normalized = normalizeDebtorDocument(value);

  return {
    valid: isValidCpf(normalized) || isValidCnpj(normalized),
    normalized,
  };
}

export function normalizeRequiredDebtorDocument(value: string): string {
  const result = validateDebtorDocument(value);

  if (!result.valid) {
    throw new Error("CPF/CNPJ deve ter 11 ou 14 digitos validos.");
  }

  return result.normalized;
}

function isValidCpf(value: string): boolean {
  if (value.length !== 11 || hasRepeatedDigits(value)) {
    return false;
  }

  const firstDigit = calculateCpfDigit(value.slice(0, 9), 10);
  const secondDigit = calculateCpfDigit(
    `${value.slice(0, 9)}${firstDigit}`,
    11,
  );

  return value === `${value.slice(0, 9)}${firstDigit}${secondDigit}`;
}

function calculateCpfDigit(base: string, initialWeight: number): number {
  const sum = base
    .split("")
    .reduce(
      (total, digit, index) =>
        total + Number.parseInt(digit, 10) * (initialWeight - index),
      0,
    );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCnpj(value: string): boolean {
  if (value.length !== 14 || hasRepeatedDigits(value)) {
    return false;
  }

  const firstDigit = calculateCnpjDigit(
    value.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  const secondDigit = calculateCnpjDigit(
    `${value.slice(0, 12)}${firstDigit}`,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );

  return value === `${value.slice(0, 12)}${firstDigit}${secondDigit}`;
}

function calculateCnpjDigit(base: string, weights: number[]): number {
  const sum = base
    .split("")
    .reduce(
      (total, digit, index) =>
        total + Number.parseInt(digit, 10) * (weights[index] ?? 0),
      0,
    );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function hasRepeatedDigits(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}
