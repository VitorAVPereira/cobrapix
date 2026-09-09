import {
  canEditOnboarding,
  assertFreshConsent,
  functionalRefusal,
} from './onboarding-policy';

describe('onboarding state and consent policy', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  it.each([
    'NOTICE_PENDING',
    'AWAITING_REPRESENTATIVE',
    'EFI_PROCESSING',
    'SUBMISSION_UNCERTAIN',
    'PROVISIONING',
    'ACTIVE',
    'CONFIGURATION_ERROR',
    'DISCONNECTED',
  ] as const)('locks editing while %s', (status): void => {
    expect(canEditOnboarding(status, null, now)).toBe(false);
  });
  it('allows refusal correction only after two full days', () => {
    expect(
      canEditOnboarding('REFUSED', new Date('2026-09-09T12:00:01Z'), now),
    ).toBe(false);
    expect(canEditOnboarding('REFUSED', now, now)).toBe(true);
    expect(canEditOnboarding('DRAFT', null, now)).toBe(true);
  });
  it('rejects stale or missing consent after any draft correction', () => {
    expect(() =>
      assertFreshConsent(
        2,
        1,
        new Date(),
        ['v1', 'v1', 'v1'],
        ['v1', 'v1', 'v1'],
      ),
    ).toThrow('CONSENT_REQUIRED');
    expect(() =>
      assertFreshConsent(2, 2, null, ['v1', 'v1', 'v1'], ['v1', 'v1', 'v1']),
    ).toThrow('CONSENT_REQUIRED');
    expect(() =>
      assertFreshConsent(
        2,
        2,
        new Date(),
        ['v1', 'v1', 'v1'],
        ['v2', 'v1', 'v1'],
      ),
    ).toThrow('CONSENT_REQUIRED');
    expect(() =>
      assertFreshConsent(
        2,
        2,
        new Date(),
        ['v1', 'v1', 'v1'],
        ['v1', 'v1', 'v1'],
      ),
    ).not.toThrow();
  });
  it('uses approved friendly reasons without echoing provider details', () => {
    expect(functionalRefusal('cnpj_invalido')).toContain('CNPJ');
    expect(functionalRefusal('document=12345678900')).not.toContain(
      '12345678900',
    );
  });
});
