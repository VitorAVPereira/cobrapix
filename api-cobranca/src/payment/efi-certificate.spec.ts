import * as forge from 'node-forge';
import { inspectEfiCertificate } from './efi-certificate';

describe('actual PKCS12 validity', () => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  function p12(expiresAt: Date, password = ''): string {
    const certificate = forge.pki.createCertificate();
    certificate.publicKey = keys.publicKey;
    certificate.serialNumber = '01';
    certificate.validity.notBefore = new Date('2025-01-01');
    certificate.validity.notAfter = expiresAt;
    certificate.setSubject([{ name: 'commonName', value: 'test-only' }]);
    certificate.setIssuer(certificate.subject.attributes);
    certificate.sign(keys.privateKey, forge.md.sha256.create());
    return forge.util.encode64(
      forge.asn1
        .toDer(
          forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, {
            algorithm: '3des',
          }),
        )
        .getBytes(),
    );
  }
  it('extracts real expiry/fingerprint and normalizes password-protected P12 for the SDK', () => {
    const result = inspectEfiCertificate(
      p12(new Date('2030-01-01'), 'secret'),
      'secret',
      new Date('2026-01-01'),
    );
    expect(result.expiresAt.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(result.fingerprint).toMatch(/^[A-F0-9:]{95}$/);
    expect(() =>
      inspectEfiCertificate(result.base64, '', new Date('2026-01-01')),
    ).not.toThrow();
  });
  it('rejects expired, malformed or wrong-password certificates with a safe error', () => {
    expect(() =>
      inspectEfiCertificate(
        p12(new Date('2025-02-01')),
        '',
        new Date('2026-01-01'),
      ),
    ).toThrow('EFI_CERTIFICATE_INVALID');
    expect(() => inspectEfiCertificate('private-data')).toThrow(
      'EFI_CERTIFICATE_INVALID',
    );
    expect(() =>
      inspectEfiCertificate(p12(new Date('2030-01-01'), 'secret'), 'wrong'),
    ).toThrow('EFI_CERTIFICATE_INVALID');
  });
});
