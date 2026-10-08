import { BadRequestException, ConflictException } from '@nestjs/common';

export interface CardDebtInput {
  principalCents: number;
  discountCents: number;
  dueDate: string;
  today: string;
  lateFineBasisPoints: number;
  lateInterestMonthlyBasisPoints: number;
}
export interface CardDebtAmounts {
  principalCents: number;
  discountCents: number;
  daysLate: number;
  lateFineCents: number;
  lateInterestCents: number;
  baseDebtCents: number;
  platformFeeBaseCents: number;
}
export function cardCivilDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function cardDaysBetween(due: string, today: string): number {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException('Data inválida.');
    const d = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value)
      throw new BadRequestException('Data inválida.');
    return d.getTime();
  };
  return (parse(today) - parse(due)) / 86400000;
}
function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
    throw new BadRequestException('Valor inválido.');
  return value;
}
export function calculateCardDebt(input: CardDebtInput): CardDebtAmounts {
  const principalCents = cents(input.principalCents);
  const discountCents = cents(input.discountCents);
  if (principalCents <= 0 || discountCents > principalCents)
    throw new BadRequestException('Desconto inválido.');
  const daysLate = Math.max(0, cardDaysBetween(input.dueDate, input.today));
  if (
    !Number.isInteger(input.lateFineBasisPoints) ||
    input.lateFineBasisPoints < 0 ||
    input.lateFineBasisPoints > 1000 ||
    !Number.isInteger(input.lateInterestMonthlyBasisPoints) ||
    input.lateInterestMonthlyBasisPoints < 0 ||
    input.lateInterestMonthlyBasisPoints > 10000
  )
    throw new BadRequestException('Encargos inválidos.');
  // BigInt keeps intermediate products exact; positive amounts use half-up rounding.
  const round = (n: bigint, divisor: bigint) =>
    cents(Number((n + divisor / 2n) / divisor));
  const lateFineCents = daysLate
    ? round(BigInt(principalCents) * BigInt(input.lateFineBasisPoints), 10000n)
    : 0;
  const lateInterestCents = round(
    BigInt(principalCents) *
      BigInt(input.lateInterestMonthlyBasisPoints) *
      BigInt(daysLate),
    300000n,
  );
  const platformFeeBaseCents = principalCents - discountCents;
  if (platformFeeBaseCents + lateFineCents + lateInterestCents <= 0)
    throw new ConflictException({
      code: 'CARD_ZERO_AMOUNT',
      message:
        'Não há valor a cobrar por cartão. Fale com a empresa para regularizar esta fatura.',
    });
  return {
    principalCents,
    discountCents,
    daysLate,
    lateFineCents,
    lateInterestCents,
    platformFeeBaseCents,
    baseDebtCents: cents(
      platformFeeBaseCents + lateFineCents + lateInterestCents,
    ),
  };
}
interface DiscountSettings {
  autoDiscountEnabled?: boolean | null;
  autoDiscountDaysAfterDue?: number | null;
  autoDiscountPercentage?: unknown;
}
export function resolveCardDiscount(
  principal: number,
  days: number,
  debtor: DiscountSettings & { useGlobalBillingSettings: boolean },
  company: DiscountSettings,
): number {
  const s = debtor.useGlobalBillingSettings ? company : debtor;
  const percentage = Number(s.autoDiscountPercentage);
  if (
    !s.autoDiscountEnabled ||
    days > (s.autoDiscountDaysAfterDue ?? 0) ||
    !Number.isFinite(percentage) ||
    percentage <= 0 ||
    percentage > 100
  )
    return 0;
  return Math.round((principal * percentage) / 100);
}
export interface CardInstallmentQuote {
  installments: number;
  submissionCents: number;
  totalCents: number;
  installmentValueCents: number;
  efiFeeCents: number;
}
// The provider adds installment interest itself. Gross up only the contractual
// processing tariff, assessed on the provider's final total, not the debt.
export async function grossUpCard(
  debt: number,
  installments: number,
  basisPoints: number,
  fixedCents: number,
  installmentFor: (submission: number) => Promise<number>,
): Promise<CardInstallmentQuote> {
  cents(debt);
  cents(fixedCents);
  if (
    debt <= 0 ||
    !Number.isInteger(installments) ||
    installments < 1 ||
    installments > 6 ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints >= 10000
  )
    throw new BadRequestException('Tarifa de cartão inválida.');
  let submissionCents = debt + fixedCents;
  for (let iteration = 0; iteration < 20; iteration++) {
    cents(submissionCents);
    const installmentValueCents = cents(await installmentFor(submissionCents));
    const totalCents = cents(installmentValueCents * installments);
    if (totalCents < submissionCents || installmentValueCents <= 0)
      throw new ConflictException({
        code: 'CARD_QUOTE_INVALID',
        message: 'A Efí retornou parcelas incompatíveis.',
      });
    const processing =
      Math.round((totalCents * basisPoints) / 10000) + fixedCents;
    const next = debt + processing;
    if (next === submissionCents)
      return {
        installments,
        submissionCents,
        totalCents,
        installmentValueCents,
        efiFeeCents: totalCents - debt,
      };
    submissionCents = next;
  }
  throw new ConflictException({
    code: 'CARD_QUOTE_INVALID',
    message: 'Não foi possível validar o custo do cartão.',
  });
}
