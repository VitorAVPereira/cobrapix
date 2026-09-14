export interface EfiCertificate {
  base64: string;
  expiresAt: Date;
  fingerprint: string;
}
export function inspectEfiCertificate(
  base64: string,
  password = '',
  now = new Date(),
): EfiCertificate {
  try {
    if (
      !base64 ||
      base64.length > 2_000_000 ||
      !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)
    )
      throw new Error();
    const container = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forge.util.decode64(base64)),
      password,
    );
    const keys = container.safeContents
      .flatMap((content): forge.pkcs12.Bag[] => content.safeBags)
      .filter((bag): boolean => Boolean(bag.key));
    const certificates = container.safeContents
      .flatMap((content): forge.pkcs12.Bag[] => content.safeBags)
      .flatMap((bag): forge.pki.Certificate[] => (bag.cert ? [bag.cert] : []));
    const key = keys[0]?.key;
    if (!key || keys.length !== 1) throw new Error();
    const privateKey = createPrivateKey(forge.pki.privateKeyToPem(key));
    const certificate = certificates.find((item): boolean =>
      new X509Certificate(forge.pki.certificateToPem(item)).checkPrivateKey(
        privateKey,
      ),
    );
    if (
      !certificate ||
      certificate.validity.notBefore > now ||
      certificate.validity.notAfter <= now
    )
      throw new Error();
    const x509 = new X509Certificate(forge.pki.certificateToPem(certificate));
    // The installed Efí SDK uses an empty P12 passphrase. Normalize before encrypting at rest.
    const normalized = forge.pkcs12.toPkcs12Asn1(
      key,
      [
        certificate,
        ...certificates.filter((item): boolean => item !== certificate),
      ],
      '',
      { algorithm: '3des' },
    );
    return {
      base64: forge.util.encode64(forge.asn1.toDer(normalized).getBytes()),
      expiresAt: certificate.validity.notAfter,
      fingerprint: x509.fingerprint256,
    };
  } catch {
    throw new Error('EFI_CERTIFICATE_INVALID');
  }
}
import * as forge from 'node-forge';
import { createPrivateKey, X509Certificate } from 'crypto';
