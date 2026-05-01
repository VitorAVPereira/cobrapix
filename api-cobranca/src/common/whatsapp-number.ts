export const DEFAULT_WHATSAPP_COUNTRY_CODE = '55';

const MIN_LOCAL_WITH_AREA_DIGITS = 10;
const MAX_LOCAL_WITH_AREA_DIGITS = 11;
const MIN_INTERNATIONAL_DIGITS = 11;
const MAX_INTERNATIONAL_DIGITS = 15;

export function normalizeWhatsAppNumber(value: string): string {
  const trimmedValue = value.trim();
  const digits = trimmedValue.replace(/\D/g, '');
  const internationalDigits = digits.startsWith('00')
    ? digits.slice(2)
    : digits;

  if (!internationalDigits) {
    throw new Error('WhatsApp invalido.');
  }

  const hasExplicitCountryCode =
    trimmedValue.startsWith('+') ||
    digits.startsWith('00') ||
    internationalDigits.length > MAX_LOCAL_WITH_AREA_DIGITS;

  if (
    !hasExplicitCountryCode &&
    (internationalDigits.length < MIN_LOCAL_WITH_AREA_DIGITS ||
      internationalDigits.length > MAX_LOCAL_WITH_AREA_DIGITS)
  ) {
    throw new Error('WhatsApp invalido. Informe DDD e numero.');
  }

  const normalizedDigits = hasExplicitCountryCode
    ? internationalDigits
    : `${DEFAULT_WHATSAPP_COUNTRY_CODE}${internationalDigits}`;

  if (
    normalizedDigits.length < MIN_INTERNATIONAL_DIGITS ||
    normalizedDigits.length > MAX_INTERNATIONAL_DIGITS
  ) {
    throw new Error('WhatsApp invalido. Informe o codigo do pais e DDD.');
  }

  if (
    normalizedDigits.startsWith(DEFAULT_WHATSAPP_COUNTRY_CODE) &&
    normalizedDigits.length !== 12 &&
    normalizedDigits.length !== 13
  ) {
    throw new Error('WhatsApp brasileiro invalido. Informe DDD e numero.');
  }

  return `+${normalizedDigits}`;
}

export function normalizeWhatsAppNumberForTransport(value: string): string {
  return normalizeWhatsAppNumber(value).replace(/\D/g, '');
}

export function getWhatsAppNumberLookupCandidates(value: string): string[] {
  const normalizedNumber = normalizeWhatsAppNumber(value);
  const digits = normalizedNumber.replace(/\D/g, '');
  const candidates = [normalizedNumber, digits];

  if (
    digits.startsWith(DEFAULT_WHATSAPP_COUNTRY_CODE) &&
    (digits.length === 12 || digits.length === 13)
  ) {
    candidates.push(digits.slice(DEFAULT_WHATSAPP_COUNTRY_CODE.length));
  }

  return Array.from(new Set(candidates));
}
