import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateDisbursementBatchDto,
  ScheduleDisbursementBatchDto,
} from './disbursement-batch.dto';

async function errors(type: new () => object, body: object) {
  const found = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return found.flatMap((error) => [
    error.property,
    ...(error.children ?? []).map(
      (child) => `${error.property}.${child.property}`,
    ),
  ]);
}

describe('disbursement batch DTOs', () => {
  const base = {
    reference: 'Folha',
    items: [
      { recipientId: '6f1c2f62-1a1b-4c55-9f4e-0d1c2b3a4f5e', amountCents: 100 },
    ],
  };

  it('accepts a payment date and a repetition', async () => {
    expect(
      await errors(CreateDisbursementBatchDto, {
        ...base,
        scheduledFor: '2026-10-31',
        repeat: { unit: 'MONTH', every: 1, endsOn: '2027-10-31' },
      }),
    ).toEqual([]);
    expect(
      await errors(ScheduleDisbursementBatchDto, {
        expectedVersion: 1,
        scheduledFor: '2026-11-05',
      }),
    ).toEqual([]);
  });

  it('refuses a date in another format and an unknown repetition unit', async () => {
    expect(
      await errors(CreateDisbursementBatchDto, {
        ...base,
        scheduledFor: '31/10/2026',
      }),
    ).toEqual(['scheduledFor']);
    expect(
      await errors(CreateDisbursementBatchDto, {
        ...base,
        repeat: { unit: 'YEAR', every: 0 },
      }),
    ).toEqual(
      expect.arrayContaining(['repeat', 'repeat.unit', 'repeat.every']),
    );
  });
});
