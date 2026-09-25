// Sanitized validation steps stored in FinancialValidationAttempt.steps.
export const VALIDATION_STEP_CODES = [
  'CERTIFICATE',
  'FEE_VERSIONS',
  'PLATFORM_RECIPIENT',
  'PIX_AUTH',
  'PIX_WEBHOOK',
  'PIX_SPLIT',
  'CHARGES_AUTH',
  'CHARGES_WEBHOOK_URL',
  'BOLIX_ISSUANCE',
  'BOLIX_SPLIT',
] as const;
export type ValidationStepCode = (typeof VALIDATION_STEP_CODES)[number];

export type ValidationStepStatus =
  | 'PENDING'
  | 'PASSED'
  | 'FAILED'
  | 'SKIPPED'
  // The provider offers no way to prove it without issuing a payable charge.
  | 'NOT_VERIFIABLE';

// External change a step makes in the company's Efí account.
export type ValidationStepEffect =
  | 'NONE'
  | 'PIX_WEBHOOK_CONFIGURED'
  | 'VALIDATION_SPLIT_CONFIGURED';

export interface ValidationStep {
  code: ValidationStepCode;
  status: ValidationStepStatus;
  effect: ValidationStepEffect;
  errorCode?: string;
  checkedAt?: string;
}

export interface EfiErrorClassification {
  // Temporary provider or network failure: the attempt may be retried.
  transient: boolean;
  code: string;
}

// The SDK throws the provider body when Efí answered (a rejection) and a
// TypeError or string when the request never completed (transient).
export function classifyEfiError(error: unknown): EfiErrorClassification {
  if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    const name = [record.nome, record.error, record.code].find(
      (value): value is string | number =>
        typeof value === 'string' || typeof value === 'number',
    );
    if (name !== undefined && !(error instanceof Error)) {
      // `code` is an application code on the Cobranças API, not an HTTP status.
      const status = Number(record.status);
      if (Number.isInteger(status) && status >= 500)
        return { transient: true, code: 'EFI_UNAVAILABLE' };
      const safe = String(name)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 48)
        .toUpperCase();
      return { transient: false, code: `EFI_REJECTED_${safe}` };
    }
  }
  return { transient: true, code: 'EFI_UNAVAILABLE' };
}
