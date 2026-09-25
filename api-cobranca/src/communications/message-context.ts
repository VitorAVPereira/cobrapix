import { BadRequestException } from '@nestjs/common';
import { CommunicationRecipientType } from '@prisma/client';
import { createHash } from 'node:crypto';

export interface MessageContextInput {
  companyId?: string | null;
  invoiceId?: string | null;
  debtorId?: string | null;
}

export interface MessageContext {
  companyId: string | null;
  invoiceId: string | null;
  debtorId: string | null;
}

export interface MessageRecipientInput {
  type: CommunicationRecipientType;
  value: string;
}

export interface MessageRecipient extends MessageRecipientInput {
  hash: string;
}

/** The legacy phone hash identifies the contact, independently of the transport. */
export function messageRecipient(
  input: MessageRecipientInput,
): MessageRecipient {
  if (typeof input.value !== 'string') {
    throw new BadRequestException('Destinatario invalido');
  }
  let value = input.value.trim();
  let hashInput: string;
  if (input.type === 'PHONE') {
    if (!/^\+?[\d().\s-]+$/.test(value)) {
      throw new BadRequestException('Telefone internacional invalido');
    }
    value = value.replace(/\D/g, '');
    if (!/^[1-9]\d{7,14}$/.test(value)) {
      throw new BadRequestException('Telefone internacional invalido');
    }
    hashInput = value;
  } else if (input.type === 'BSUID' && /^[\x21-\x7e]{1,256}$/.test(value)) {
    hashInput = `BSUID\0${value}`;
  } else {
    throw new BadRequestException(
      'Tipo ou identificador de destinatario invalido',
    );
  }
  return {
    type: input.type,
    value,
    hash: createHash('sha256').update(hashInput).digest('hex'),
  };
}

export function normalizeMessageContext(
  input: MessageContextInput,
): MessageContext {
  const id = (value: string | null | undefined): string | null => {
    if (value === undefined || value === null) return null;
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value !== value.trim() ||
      value.length > 128
    ) {
      throw new BadRequestException('Contexto de comunicacao invalido');
    }
    return value;
  };
  const result = {
    companyId: id(input.companyId),
    invoiceId: id(input.invoiceId),
    debtorId: id(input.debtorId),
  };
  if (!result.companyId && (result.invoiceId || result.debtorId)) {
    throw new BadRequestException('Contexto de cobranca exige empresa');
  }
  return result;
}

/** Hash only JSON values, without lossy serialization or object key order effects. */
export function canonicalPayload(input: unknown): string {
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): string => {
    if (depth > 64)
      throw new BadRequestException('Payload excede a profundidade permitida');
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean')
      return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value))
      return JSON.stringify(value);
    if (
      typeof value !== 'object' ||
      ancestors.has(value) ||
      Object.getOwnPropertySymbols(value).length
    ) {
      throw new BadRequestException('Payload deve conter somente JSON valido');
    }
    ancestors.add(value);
    let result: string;
    if (Array.isArray(value)) {
      result = `[${Array.from(value, (item: unknown) => visit(item, depth + 1)).join(',')}]`;
    } else {
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new BadRequestException(
          'Payload deve conter somente JSON valido',
        );
      }
      const record = value as Record<string, unknown>;
      result = `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(record[key], depth + 1)}`)
        .join(',')}}`;
    }
    ancestors.delete(value);
    return result;
  };
  return visit(input, 0);
}
