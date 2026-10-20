import { BadRequestException, ConflictException } from '@nestjs/common';
import { getWhatsAppNumberLookupCandidates } from '../common/whatsapp-number';

export type ImportField = 'name' | 'phone' | 'email';
const IMPORT_FIELDS: ImportField[] = ['name', 'phone', 'email'];

export interface ImportClientData {
  name: string;
  phone: string;
  email: string | null;
}

export interface ExistingClient extends ImportClientData {
  debtorId: string;
  document: string | null;
  whatsappOptIn: boolean;
  /** updatedAt of the client: a decision only applies to the version reviewed. */
  version: string;
}

/** Spreadsheet rows of one CPF/CNPJ (row indexes are 0-based). */
export interface ImportClientGroup {
  document: string;
  rows: number[];
  csv: ImportClientData;
  optIn: boolean;
}

export type ImportClientReview = {
  document: string;
  rows: number[];
  csv: ImportClientData;
  optIn: boolean;
  /** Client that already has the spreadsheet WhatsApp, if any. */
  phoneOwner: { debtorId: string; name: string } | null;
} & (
  | { kind: 'NEW' }
  | { kind: 'SAME'; existing: ExistingClient }
  | { kind: 'DIFFERENT'; existing: ExistingClient; differences: ImportField[] }
  /** New document, but the WhatsApp belongs to an older client without one. */
  | {
      kind: 'UNDOCUMENTED_OWNER';
      existing: ExistingClient;
      differences: ImportField[];
    }
  | { kind: 'PHONE_TAKEN' }
  | { kind: 'DUPLICATE_DOCUMENT'; candidates: ExistingClient[] }
);

export type ImportDecision =
  | { document: string; action: 'SKIP' }
  | {
      document: string;
      action: 'LINK';
      debtorId: string;
      version: string;
      use: Record<ImportField, 'CSV' | 'EXISTING'>;
    };

export type ImportPlanItem = {
  group: ImportClientGroup;
} & (
  | { action: 'CREATE' }
  | { action: 'SKIP' }
  | {
      action: 'LINK';
      debtorId: string;
      update: Partial<{
        name: string;
        phoneNumber: string;
        email: string;
        document: string;
      }>;
      grantOptIn: boolean;
    }
);

interface ImportRowClient {
  document: string;
  name: string;
  phone_number: string;
  email?: string;
  whatsapp_opt_in?: boolean;
}

const lines = (rows: number[]): string =>
  `Linhas ${rows.map((row) => row + 1).join(', ')}`;

function samePhone(a: string, b: string): boolean {
  return getWhatsAppNumberLookupCandidates(a).includes(b);
}

/**
 * One client per CPF/CNPJ. A spreadsheet that gives the same document
 * different data, or the same WhatsApp to different documents, is an error of
 * the file itself and is reported like any other invalid row.
 */
export function groupImportRows(rows: ImportRowClient[]): {
  groups: ImportClientGroup[];
  errors: string[];
} {
  const groups = new Map<string, ImportClientGroup>();
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const email = row.email?.trim().toLowerCase() || null;
    const group = groups.get(row.document);
    if (!group) {
      groups.set(row.document, {
        document: row.document,
        rows: [index],
        csv: { name: row.name, phone: row.phone_number, email },
        optIn: row.whatsapp_opt_in === true,
      });
      return;
    }
    group.rows.push(index);
    group.optIn ||= row.whatsapp_opt_in === true;
    if (
      row.name !== group.csv.name ||
      row.phone_number !== group.csv.phone ||
      (email && group.csv.email && email !== group.csv.email)
    ) {
      errors.push(
        `${lines([group.rows[0] ?? index, index])}: mesmo CPF/CNPJ com nome, WhatsApp ou e-mail diferentes.`,
      );
    }
    group.csv.email ??= email;
  });

  const documentByPhone = new Map<string, ImportClientGroup>();
  for (const group of groups.values()) {
    const other = documentByPhone.get(group.csv.phone);
    if (other) {
      errors.push(
        `${lines([...other.rows.slice(0, 1), ...group.rows.slice(0, 1)])}: o mesmo WhatsApp em CPF/CNPJ diferentes.`,
      );
    }
    documentByPhone.set(group.csv.phone, group);
  }
  return { groups: [...groups.values()], errors };
}

function differences(
  existing: ImportClientData,
  csv: ImportClientData,
): ImportField[] {
  return IMPORT_FIELDS.filter((field) => {
    if (field === 'phone') return !samePhone(csv.phone, existing.phone);
    // An empty e-mail in the spreadsheet says nothing about the client.
    if (field === 'email')
      return csv.email !== null && csv.email !== existing.email;
    return csv.name !== existing.name;
  });
}

/** Compares each spreadsheet client with the clients found by document or WhatsApp. */
export function reviewImportGroups(
  groups: ImportClientGroup[],
  debtors: ExistingClient[],
): ImportClientReview[] {
  return groups.map((group) => {
    const owner = debtors.find((debtor) =>
      samePhone(group.csv.phone, debtor.phone),
    );
    const base = {
      document: group.document,
      rows: group.rows,
      csv: group.csv,
      optIn: group.optIn,
      phoneOwner: owner ? { debtorId: owner.debtorId, name: owner.name } : null,
    };
    const byDocument = debtors.filter(
      (debtor) => debtor.document === group.document,
    );
    const [existing, ...others] = byDocument;
    if (!existing) {
      if (!owner) return { ...base, kind: 'NEW' as const };
      // An older client without a document may be the same person: the user
      // can link them and record the spreadsheet document.
      return owner.document
        ? { ...base, kind: 'PHONE_TAKEN' as const }
        : {
            ...base,
            kind: 'UNDOCUMENTED_OWNER' as const,
            existing: owner,
            differences: differences(owner, group.csv),
          };
    }
    if (others.length > 0) {
      return {
        ...base,
        kind: 'DUPLICATE_DOCUMENT' as const,
        candidates: byDocument,
      };
    }
    const found = differences(existing, group.csv);
    return found.length === 0
      ? { ...base, kind: 'SAME' as const, existing }
      : { ...base, kind: 'DIFFERENT' as const, existing, differences: found };
  });
}

/**
 * Turns the review and the user's decisions into what will be written. The
 * server reviews again inside the import transaction: anything that no longer
 * matches what the user saw stops the import instead of guessing.
 */
export function planImport(
  reviews: ImportClientReview[],
  decisions: ImportDecision[] | undefined,
): ImportPlanItem[] {
  const fail = (): never => {
    throw new ConflictException(
      decisions === undefined
        ? {
            code: 'IMPORT_NEEDS_REVIEW',
            message:
              'Alguns clientes da planilha precisam de revisão antes da importação.',
          }
        : {
            code: 'IMPORT_CHANGED',
            message:
              'Os cadastros de clientes mudaram desde a revisão. Revise a importação de novo.',
          },
    );
  };
  const byDocument = new Map(
    (decisions ?? []).map((decision) => [decision.document, decision]),
  );

  return reviews.map((review): ImportPlanItem => {
    const group = {
      document: review.document,
      rows: review.rows,
      csv: review.csv,
      optIn: review.optIn,
    };
    const decision = byDocument.get(review.document);
    if (decision?.action === 'SKIP') return { group, action: 'SKIP' };
    if (review.kind === 'NEW') {
      return decision ? fail() : { group, action: 'CREATE' };
    }
    if (review.kind === 'PHONE_TAKEN') return fail();

    const candidates =
      review.kind === 'DUPLICATE_DOCUMENT'
        ? review.candidates
        : [review.existing];
    if (review.kind === 'SAME' && !decision) {
      return {
        group,
        action: 'LINK',
        debtorId: review.existing.debtorId,
        update: {},
        grantOptIn: group.optIn && !review.existing.whatsappOptIn,
      };
    }
    if (!decision) return fail();
    const chosen = candidates.find(
      (candidate) =>
        candidate.debtorId === decision.debtorId &&
        candidate.version === decision.version,
    );
    if (!chosen) return fail();

    const changed = differences(chosen, review.csv);
    const useCsv = (field: ImportField) =>
      changed.includes(field) && decision.use[field] === 'CSV';
    if (
      useCsv('phone') &&
      review.phoneOwner &&
      review.phoneOwner.debtorId !== chosen.debtorId
    ) {
      return fail();
    }
    const keepsCsvPhone = !changed.includes('phone') || useCsv('phone');
    return {
      group,
      action: 'LINK',
      debtorId: chosen.debtorId,
      update: {
        ...(useCsv('name') && { name: review.csv.name }),
        ...(useCsv('phone') && { phoneNumber: review.csv.phone }),
        ...(useCsv('email') && review.csv.email && { email: review.csv.email }),
        ...(review.kind === 'UNDOCUMENTED_OWNER' && {
          document: review.document,
        }),
      },
      // The spreadsheet consent is for its WhatsApp; it only grants, never revokes.
      grantOptIn:
        group.optIn &&
        keepsCsvPhone &&
        !(chosen.whatsappOptIn && !useCsv('phone')),
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decisions arrive in a free JSON body, next to the rows. */
export function parseImportDecisions(
  raw: unknown,
): ImportDecision[] | undefined {
  if (raw === undefined) return undefined;
  const invalid = () =>
    new BadRequestException('Decisões de importação inválidas.');
  if (!Array.isArray(raw)) throw invalid();
  return raw.map((item: unknown): ImportDecision => {
    const value = item as Record<string, unknown>;
    if (!value || typeof value.document !== 'string') throw invalid();
    if (value.action === 'SKIP') {
      return { document: value.document, action: 'SKIP' };
    }
    const use = value.use as Record<string, unknown> | undefined;
    if (
      value.action !== 'LINK' ||
      typeof value.debtorId !== 'string' ||
      !UUID.test(value.debtorId) ||
      typeof value.version !== 'string' ||
      !use ||
      !IMPORT_FIELDS.every(
        (field) => use[field] === 'CSV' || use[field] === 'EXISTING',
      )
    ) {
      throw invalid();
    }
    return {
      document: value.document,
      action: 'LINK',
      debtorId: value.debtorId,
      version: value.version,
      use: use as Record<ImportField, 'CSV' | 'EXISTING'>,
    };
  });
}

/** "Enviar cobrança agora" of new invoices; absent keeps the client or company default. */
export interface EmissionRequest {
  send_now?: boolean;
  send_channels?: Array<'WHATSAPP' | 'EMAIL'>;
}

/** The import's emission choice arrives in the same free JSON body as the rows. */
export function parseEmissionRequest(
  sendNow: unknown,
  sendChannels: unknown,
): EmissionRequest {
  const invalid = () =>
    new BadRequestException('Envio da cobrança na importação inválido.');
  if (sendNow === undefined) return {};
  if (typeof sendNow !== 'boolean') throw invalid();
  if (sendChannels === undefined) return { send_now: sendNow };
  if (
    !Array.isArray(sendChannels) ||
    sendChannels.some(
      (channel) => channel !== 'WHATSAPP' && channel !== 'EMAIL',
    )
  )
    throw invalid();
  return {
    send_now: sendNow,
    send_channels: [...new Set(sendChannels as Array<'WHATSAPP' | 'EMAIL'>)],
  };
}
