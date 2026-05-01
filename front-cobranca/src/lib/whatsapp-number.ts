const DEFAULT_WHATSAPP_COUNTRY_CODE = "55";
const MIN_LOCAL_WITH_AREA_DIGITS = 10;
const MAX_LOCAL_WITH_AREA_DIGITS = 11;
const MIN_INTERNATIONAL_DIGITS = 11;
const MAX_INTERNATIONAL_DIGITS = 15;
const ONE_DIGIT_COUNTRY_CODES = new Set(["1", "7"]);
const TWO_DIGIT_COUNTRY_CODES = new Set([
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
]);

interface PhoneNumberParts {
  countryCode: string;
  areaCode: string;
  subscriberNumber: string;
}

export function normalizeWhatsAppNumber(value: string): string {
  const trimmedValue = value.trim();
  const digits = trimmedValue.replace(/\D/g, "");
  const internationalDigits = digits.startsWith("00")
    ? digits.slice(2)
    : digits;

  if (!internationalDigits) {
    throw new Error("WhatsApp invalido.");
  }

  const hasExplicitCountryCode =
    trimmedValue.startsWith("+") ||
    digits.startsWith("00") ||
    internationalDigits.length > MAX_LOCAL_WITH_AREA_DIGITS;

  if (
    !hasExplicitCountryCode &&
    (internationalDigits.length < MIN_LOCAL_WITH_AREA_DIGITS ||
      internationalDigits.length > MAX_LOCAL_WITH_AREA_DIGITS)
  ) {
    throw new Error("WhatsApp invalido. Informe DDD e numero.");
  }

  const normalizedDigits = hasExplicitCountryCode
    ? internationalDigits
    : `${DEFAULT_WHATSAPP_COUNTRY_CODE}${internationalDigits}`;

  if (
    normalizedDigits.length < MIN_INTERNATIONAL_DIGITS ||
    normalizedDigits.length > MAX_INTERNATIONAL_DIGITS
  ) {
    throw new Error("WhatsApp invalido. Informe o codigo do pais e DDD.");
  }

  if (
    normalizedDigits.startsWith(DEFAULT_WHATSAPP_COUNTRY_CODE) &&
    normalizedDigits.length !== 12 &&
    normalizedDigits.length !== 13
  ) {
    throw new Error("WhatsApp brasileiro invalido. Informe DDD e numero.");
  }

  return `+${normalizedDigits}`;
}

export function formatWhatsAppNumber(value: string): string {
  const digits = getDisplayDigits(value);

  if (!digits) {
    return "";
  }

  const parts = splitPhoneNumber(digits);
  const formattedSubscriber = formatSubscriberNumber(parts.subscriberNumber);

  if (!parts.areaCode) {
    return `+${parts.countryCode} ${formattedSubscriber}`;
  }

  return `+${parts.countryCode} (${parts.areaCode}) ${formattedSubscriber}`;
}

function getDisplayDigits(value: string): string {
  try {
    return normalizeWhatsAppNumber(value).replace(/\D/g, "");
  } catch {
    const digits = value.replace(/\D/g, "");

    if (digits.length >= MIN_INTERNATIONAL_DIGITS) {
      return digits.startsWith("00") ? digits.slice(2) : digits;
    }

    return digits;
  }
}

function splitPhoneNumber(digits: string): PhoneNumberParts {
  const shouldUseDefaultCountry =
    digits.length <= MAX_LOCAL_WITH_AREA_DIGITS &&
    !ONE_DIGIT_COUNTRY_CODES.has(digits.slice(0, 1));
  const normalizedDigits =
    shouldUseDefaultCountry
      ? `${DEFAULT_WHATSAPP_COUNTRY_CODE}${digits}`
      : digits;
  const countryCodeLength = getCountryCodeLength(normalizedDigits);
  const countryCode = normalizedDigits.slice(0, countryCodeLength);
  const nationalNumber = normalizedDigits.slice(countryCodeLength);
  const areaCodeLength = countryCode === "1" ? 3 : 2;
  const areaCode = nationalNumber.slice(0, areaCodeLength);
  const subscriberNumber = nationalNumber.slice(areaCode.length);

  return {
    countryCode,
    areaCode,
    subscriberNumber,
  };
}

function getCountryCodeLength(digits: string): number {
  if (digits.startsWith(DEFAULT_WHATSAPP_COUNTRY_CODE)) {
    return DEFAULT_WHATSAPP_COUNTRY_CODE.length;
  }

  if (ONE_DIGIT_COUNTRY_CODES.has(digits.slice(0, 1))) {
    return 1;
  }

  if (TWO_DIGIT_COUNTRY_CODES.has(digits.slice(0, 2))) {
    return 2;
  }

  return Math.min(3, digits.length);
}

function formatSubscriberNumber(value: string): string {
  if (value.length <= 4) {
    return value;
  }

  return `${value.slice(0, -4)}-${value.slice(-4)}`;
}
