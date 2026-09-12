export interface FixedPaymentFeeComponent {
  kind: 'FIXED';
  amountCents: number;
}

export interface PercentagePaymentFeeComponent {
  kind: 'PERCENTAGE';
  basisPoints: number;
}

export type PaymentFeeComponent =
  | FixedPaymentFeeComponent
  | PercentagePaymentFeeComponent;

export function validatePaymentFeeComponent(
  value: unknown,
): value is PaymentFeeComponent {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === 'FIXED') {
    return (
      hasOnlyKeys(value, ['kind', 'amountCents']) &&
      isIntegerInRange(value.amountCents, 0, 2147483647)
    );
  }

  if (value.kind === 'PERCENTAGE') {
    return (
      hasOnlyKeys(value, ['kind', 'basisPoints']) &&
      isIntegerInRange(value.basisPoints, 0, 10_000)
    );
  }

  return false;
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

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
