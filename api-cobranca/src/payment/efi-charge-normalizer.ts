// Efí Cobranças query responses. The detail (GET /v1/charge/:id) and the
// listing (GET /v1/charges) differ from the creation response and from each
// other: nothing here reuses the creation parser. Absent or malformed fields
// stay null; a value is never coerced into zero or an empty instrument.

export interface EfiChargeObservation {
  providerChargeId: string | null;
  customId: string | null;
  status: string | null;
  totalCents: number | null;
  paymentMethod: string | null;
  barcode: string | null;
  billetLink: string | null;
  pdfLink: string | null;
  pixQrcode: string | null;
  pixQrcodeImage: string | null;
  // YYYY-MM-DD, as returned by Efí.
  expireAt: string | null;
}

export interface EfiChargeListingEntry {
  providerChargeId: string | null;
  customId: string | null;
  status: string | null;
  totalCents: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    return String(value);
  return typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null;
}

function date(value: unknown): string | null {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

export function normalizeEfiChargeDetail(raw: unknown): EfiChargeObservation {
  const data = isRecord(raw) && isRecord(raw.data) ? raw.data : {};
  const payment = isRecord(data.payment) ? data.payment : {};
  const billet = isRecord(payment.banking_billet) ? payment.banking_billet : {};
  // Bolix returns its Pix inside the billet; accept the payment level too.
  const pix = isRecord(billet.pix)
    ? billet.pix
    : isRecord(payment.pix)
      ? payment.pix
      : {};
  const pdf = isRecord(billet.pdf) ? billet.pdf : {};
  return {
    providerChargeId: identifier(data.charge_id),
    customId: text(data.custom_id),
    status: text(data.status),
    totalCents: cents(data.total),
    paymentMethod: text(payment.method),
    barcode: text(billet.barcode),
    billetLink: text(billet.billet_link) ?? text(billet.link),
    pdfLink: text(pdf.charge),
    pixQrcode: text(pix.qrcode),
    pixQrcodeImage: text(pix.qrcode_image),
    expireAt: date(billet.expire_at),
  };
}

export function normalizeEfiChargeListing(
  raw: unknown,
): EfiChargeListingEntry[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.data)) return null;
  return raw.data.filter(isRecord).map((entry) => ({
    providerChargeId: identifier(entry.id ?? entry.charge_id),
    customId: text(entry.custom_id),
    status: text(entry.status),
    totalCents: cents(entry.total),
  }));
}
