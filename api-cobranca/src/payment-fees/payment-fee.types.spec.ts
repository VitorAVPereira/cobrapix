import { validatePaymentFeeComponent } from './payment-fee.types';

describe('validatePaymentFeeComponent', () => {
  it.each([
    { kind: 'FIXED', amountCents: 0 },
    { kind: 'FIXED', amountCents: 199 },
    { kind: 'PERCENTAGE', basisPoints: 0 },
    { kind: 'PERCENTAGE', basisPoints: 10_000 },
  ])('accepts a valid fee component: $kind', (component: object) => {
    expect(validatePaymentFeeComponent(component)).toBe(true);
  });

  it.each([
    null,
    {},
    { kind: 'FIXED' },
    { kind: 'FIXED', amountCents: -1 },
    { kind: 'FIXED', amountCents: 1.5 },
    { kind: 'FIXED', amountCents: 100, basisPoints: 100 },
    { kind: 'PERCENTAGE' },
    { kind: 'PERCENTAGE', basisPoints: -1 },
    { kind: 'PERCENTAGE', basisPoints: 10_001 },
    { kind: 'PERCENTAGE', basisPoints: 1.5 },
    { kind: 'PERCENTAGE', basisPoints: 100, amountCents: 100 },
    { kind: 'UNKNOWN', amountCents: 100 },
  ])('rejects a malformed fee component: %#', (component: unknown) => {
    expect(validatePaymentFeeComponent(component)).toBe(false);
  });
});
