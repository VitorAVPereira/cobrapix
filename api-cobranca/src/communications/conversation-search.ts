import { Prisma } from '@prisma/client';
import { normalizeDebtorDocument } from '../common/debtor-document';
import { normalizeWhatsAppNumberForTransport } from '../common/whatsapp-number';
import { messageRecipient } from './message-context';

/** "Find the client" term of the inbox, normalized once for the company and admin views. */
export interface ConversationSearch {
  term: string;
  /** Digits of the term, matched against debtor document and phone; '' when none. */
  digits: string;
  /** Exact recipient, so conversations without a debtor (e.g. unclassified) are found. */
  recipientHash: string | null;
}

export function conversationSearch(
  raw: string | undefined,
): ConversationSearch | null {
  const term = raw?.trim();
  if (!term) return null;
  return {
    term,
    digits: normalizeDebtorDocument(term),
    recipientHash: phoneHash(term),
  };
}

/** Same criteria as the debtor list search: name, e-mail, document and phone. */
export function debtorMatch(
  search: ConversationSearch,
): Prisma.DebtorWhereInput {
  return {
    OR: [
      { name: { contains: search.term, mode: 'insensitive' } },
      { email: { contains: search.term, mode: 'insensitive' } },
      ...(search.digits
        ? [
            { document: { contains: search.digits } },
            { phoneNumber: { contains: search.digits } },
          ]
        : []),
    ],
  };
}

/** LIKE pattern matching the text anywhere; the user's own wildcards are literal. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function phoneHash(term: string): string | null {
  try {
    return messageRecipient({
      type: 'PHONE',
      value: normalizeWhatsAppNumberForTransport(term),
    }).hash;
  } catch {
    // Not a phone number: the term still matches names, e-mails and documents.
    return null;
  }
}
