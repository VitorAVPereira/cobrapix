// Domain vocabulary for financial activation. Where a financial profile came
// from, which Efí account issues the charge and how the company receives its
// share are independent decisions; only the combinations below are valid.

export const ACTIVATION_ORIGINS = [
  'AUTOMATIC_OPENING',
  'MANUAL_ADMIN',
] as const;
export type ActivationOrigin = (typeof ACTIVATION_ORIGINS)[number];

export const ACCOUNT_MODES = ['CUSTOMER_ACCOUNT', 'PLATFORM_ACCOUNT'] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];

export const PAYOUT_MODES = [
  'DIRECT_TO_CUSTOMER',
  'EFI_SPLIT',
  'MANUAL',
] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

// New issuances are restricted to Pix and Bolix (see billing-method-policy.ts).
export const FINANCIAL_ISSUANCE_METHODS = ['PIX', 'BOLIX'] as const;
export type FinancialIssuanceMethod =
  (typeof FINANCIAL_ISSUANCE_METHODS)[number];

export interface FinancialModeSelection {
  origin: ActivationOrigin;
  accountMode: AccountMode;
  payoutMode: PayoutMode;
}

export type FinancialModeRejection =
  | 'MALFORMED'
  | 'PAYOUT_MODE_INCOMPATIBLE'
  | 'OPENING_REQUIRES_CUSTOMER_ACCOUNT';

export type FinancialModeValidation =
  | { valid: true; selection: FinancialModeSelection }
  | { valid: false; reason: FinancialModeRejection };

const PAYOUT_MODES_BY_ACCOUNT: Record<AccountMode, readonly PayoutMode[]> = {
  CUSTOMER_ACCOUNT: ['DIRECT_TO_CUSTOMER'],
  PLATFORM_ACCOUNT: ['EFI_SPLIT', 'MANUAL'],
};

export function validateFinancialModeSelection(
  value: unknown,
): FinancialModeValidation {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['origin', 'accountMode', 'payoutMode']) ||
    !isOneOf(value.origin, ACTIVATION_ORIGINS) ||
    !isOneOf(value.accountMode, ACCOUNT_MODES) ||
    !isOneOf(value.payoutMode, PAYOUT_MODES)
  ) {
    return { valid: false, reason: 'MALFORMED' };
  }

  if (!PAYOUT_MODES_BY_ACCOUNT[value.accountMode].includes(value.payoutMode)) {
    return { valid: false, reason: 'PAYOUT_MODE_INCOMPATIBLE' };
  }

  // Automatic opening provisions the company's own Efí account.
  if (
    value.origin === 'AUTOMATIC_OPENING' &&
    value.accountMode !== 'CUSTOMER_ACCOUNT'
  ) {
    return { valid: false, reason: 'OPENING_REQUIRES_CUSTOMER_ACCOUNT' };
  }

  return {
    valid: true,
    selection: {
      origin: value.origin,
      accountMode: value.accountMode,
      payoutMode: value.payoutMode,
    },
  };
}

// How the gross amount is divided at issuance for each mode and method.
export type ChargeDistribution =
  // Customer account issues; the split sends the CifraMais fee to the platform.
  | 'PLATFORM_FEE_SPLIT'
  // Platform account issues; the split sends the customer share to the customer.
  | 'CUSTOMER_SHARE_SPLIT'
  // No split: the issuer keeps the whole amount.
  | 'NONE';

// Efí product that carries the split for each method: Pix CobV uses a split
// configuration linked to the txid; Bolix uses marketplace repasses (payee_code).
export type SplitMechanism = 'PIX_SPLIT_CONFIG' | 'CHARGES_MARKETPLACE';

// Evidence required before the customer share counts as settled.
export type PayoutConfirmation =
  // The customer account received the payment itself.
  | 'NOT_APPLICABLE'
  // The split must be confirmed by provider evidence or an admin check.
  | 'SPLIT_EVIDENCE'
  // An admin-reconciled manual payout batch.
  | 'MANUAL_BATCH';

export interface ChargeDistributionPlan {
  issuer: 'COMPANY' | 'PLATFORM';
  distribution: ChargeDistribution;
  splitMechanism: SplitMechanism | null;
  payoutConfirmation: PayoutConfirmation;
}

export interface ChargeDistributionInput {
  accountMode: AccountMode;
  payoutMode: PayoutMode;
  method: FinancialIssuanceMethod;
  // Whether the fee version charges a CifraMais fee (fixed or percentage > 0).
  platformFeeCharged: boolean;
}

export function resolveChargeDistribution(
  input: ChargeDistributionInput,
): ChargeDistributionPlan {
  const mechanism: SplitMechanism =
    input.method === 'PIX' ? 'PIX_SPLIT_CONFIG' : 'CHARGES_MARKETPLACE';

  if (input.accountMode === 'CUSTOMER_ACCOUNT') {
    if (input.payoutMode !== 'DIRECT_TO_CUSTOMER') {
      throw new Error('FINANCIAL_MODE_INVALID');
    }
    return input.platformFeeCharged
      ? {
          issuer: 'COMPANY',
          distribution: 'PLATFORM_FEE_SPLIT',
          splitMechanism: mechanism,
          payoutConfirmation: 'NOT_APPLICABLE',
        }
      : {
          issuer: 'COMPANY',
          distribution: 'NONE',
          splitMechanism: null,
          payoutConfirmation: 'NOT_APPLICABLE',
        };
  }

  if (input.payoutMode === 'EFI_SPLIT') {
    // The customer share must always be split out, even with a zero CifraMais
    // fee; skipping it would leave the whole payment with the platform.
    return {
      issuer: 'PLATFORM',
      distribution: 'CUSTOMER_SHARE_SPLIT',
      splitMechanism: mechanism,
      payoutConfirmation: 'SPLIT_EVIDENCE',
    };
  }

  if (input.payoutMode === 'MANUAL') {
    return {
      issuer: 'PLATFORM',
      distribution: 'NONE',
      splitMechanism: null,
      payoutConfirmation: 'MANUAL_BATCH',
    };
  }

  throw new Error('FINANCIAL_MODE_INVALID');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key: string) => allowedKeys.includes(key));
}

function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return (
    typeof value === 'string' && (options as readonly string[]).includes(value)
  );
}
