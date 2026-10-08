import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import EfiPay from 'sdk-node-apis-efi';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from './payment-crypto.service';
import { CardInstallmentQuote, grossUpCard } from './card-amounts';

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'elo';
export interface CardProcessingRate {
  brand: CardBrand;
  installments: number;
  basisPoints: number;
  fixedCents: number;
}
export interface CardCustomer {
  name: string;
  cpf: string;
  email: string;
  phone_number: string;
  birth?: string;
  juridical_person?: { corporate_name: string; cnpj: string };
}
export interface CardAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipcode: string;
  complement?: string;
}
export interface CardSubmission {
  chargeId: string;
  status: string;
  totalCents: number;
  installments?: number;
}
function invalid(): never {
  throw new ConflictException({
    code: 'EFI_CARD_RESPONSE_INVALID',
    message: 'Não foi possível confirmar a resposta da Efí.',
  });
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
export function normalizeCardInstallments(
  raw: unknown,
): { installments: number; valueCents: number }[] {
  const body = record(raw);
  const data = record(body.data);
  if (body.code !== 200 || !Array.isArray(data.installments)) return invalid();
  return data.installments
    .map((entry) => {
      const item = record(entry);
      if (
        !Number.isInteger(item.installment) ||
        !Number.isSafeInteger(item.value) ||
        Number(item.value) <= 0
      )
        return invalid();
      return {
        installments: Number(item.installment),
        valueCents: Number(item.value),
      };
    })
    .filter((x) => x.installments >= 1 && x.installments <= 6);
}
export function normalizeCardSubmission(raw: unknown): CardSubmission {
  const body = record(raw);
  const data = record(body.data);
  if (typeof data.charge_id !== 'number' && typeof data.charge_id !== 'string')
    return invalid();
  const id = String(data.charge_id);
  if (
    body.code !== 200 ||
    !/^\d{1,20}$/.test(id) ||
    typeof data.status !== 'string' ||
    !Number.isSafeInteger(data.total) ||
    Number(data.total) <= 0
  )
    return invalid();
  if (data.credit_card !== undefined) {
    const card = record(data.credit_card);
    if (
      !Number.isInteger(card.installments) ||
      Number(card.installments) < 1 ||
      Number(card.installments) > 6 ||
      !Number.isSafeInteger(card.installment_value) ||
      Number(card.installment_value) <= 0
    )
      return invalid();
    const totalCents =
      Number(card.installments) * Number(card.installment_value);
    if (!Number.isSafeInteger(totalCents)) return invalid();
    return {
      chargeId: id,
      status: data.status,
      totalCents,
      installments: Number(card.installments),
    };
  }
  return { chargeId: id, status: data.status, totalCents: Number(data.total) };
}
export function buildCardChargeBody(
  attempt: {
    id: string;
    invoiceId: string;
    submissionCents: number;
    installments: number;
    platformFeeCents: number;
  },
  paymentToken: string,
  customer: CardCustomer,
  address: CardAddress,
  payeeCode: string,
  notificationUrl: string,
) {
  if (attempt.platformFeeCents > 0 && !payeeCode)
    throw new ConflictException('Recebedor Cifra+ indisponível.');
  return {
    items: [
      {
        name: `Cobrança ${attempt.invoiceId.slice(0, 8)}`,
        value: attempt.submissionCents,
        amount: 1,
        ...(attempt.platformFeeCents > 0
          ? {
              marketplace: {
                mode: 1 as const,
                repasses: [
                  { payee_code: payeeCode, fixed: attempt.platformFeeCents },
                ],
              },
            }
          : {}),
      },
    ],
    metadata: { custom_id: attempt.id, notification_url: notificationUrl },
    payment: {
      credit_card: {
        installments: attempt.installments,
        payment_token: paymentToken,
        customer,
        billing_address: address,
      },
    },
  };
}
@Injectable()
export class EfiCardClient {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly config: ConfigService,
  ) {}
  async account(identityId: string, companyId: string) {
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: { id: identityId, companyId, ownership: 'COMPANY' },
      include: { credentialVersions: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    const credential = identity?.credentialVersions[0];
    if (
      !identity?.payeeCode ||
      identity.healthStatus === 'UNAVAILABLE' ||
      !credential ||
      credential.certificateExpiresAt <= new Date()
    )
      throw new ConflictException({
        code: 'EFI_CARD_ACCOUNT_UNAVAILABLE',
        message: 'Conta emissora indisponível.',
      });
    return {
      identity,
      sdk: new EfiPay({
        sandbox: identity.environment !== 'PRODUCTION',
        client_id: this.crypto.decrypt(credential.encryptedClientId),
        client_secret: this.crypto.decrypt(credential.encryptedClientSecret),
        cache: false,
      }),
    };
  }
  async quote(
    identityId: string,
    companyId: string,
    debtCents: number,
    brand: CardBrand,
    rates: CardProcessingRate[],
  ): Promise<CardInstallmentQuote[]> {
    const { sdk } = await this.account(identityId, companyId);
    const initial = normalizeCardInstallments(
      await sdk.getInstallments({ total: debtCents, brand }),
    );
    const options: CardInstallmentQuote[] = [];
    for (const rate of rates.filter(
      (r) =>
        r.brand === brand &&
        initial.some((i) => i.installments === r.installments),
    )) {
      options.push(
        await grossUpCard(
          debtCents,
          rate.installments,
          rate.basisPoints,
          rate.fixedCents,
          async (submission) => {
            const rows = normalizeCardInstallments(
              await sdk.getInstallments({ total: submission, brand }),
            );
            const found = rows.find(
              (i) => i.installments === rate.installments,
            );
            if (!found)
              throw new ConflictException({
                code: 'CARD_INSTALLMENT_UNAVAILABLE',
                message: 'Parcelamento indisponível para este valor.',
              });
            return found.valueCents;
          },
        ),
      );
    }
    if (!options.length)
      throw new ConflictException({
        code: 'CARD_INSTALLMENT_UNAVAILABLE',
        message: 'Não há parcelas disponíveis para esta bandeira.',
      });
    return options.sort((a, b) => a.installments - b.installments);
  }
  platformPayee(issuerPayee: string): string {
    const payee = this.config.get<string>('EFI_PLATFORM_PAYEE_CODE');
    if (!payee || payee === issuerPayee)
      throw new ConflictException({
        code: 'CARD_SPLIT_UNAVAILABLE',
        message: 'Recebedor do split Cifra+ indisponível.',
      });
    return payee;
  }
  notificationUrl(identityId: string): string {
    const url = new URL(
      this.config.get<string>('EFI_CHARGES_WEBHOOK_BASE_URL') ?? '',
    );
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new ConflictException('URL de notificação indisponível.');
    return `${url.origin}/webhooks/efi/cobrancas?account=${encodeURIComponent(identityId)}`;
  }
  async submit(
    identityId: string,
    companyId: string,
    attempt: Parameters<typeof buildCardChargeBody>[0],
    token: string,
    customer: CardCustomer,
    address: CardAddress,
  ) {
    const { sdk, identity } = await this.account(identityId, companyId);
    const body = buildCardChargeBody(
      attempt,
      token,
      customer,
      address,
      attempt.platformFeeCents > 0
        ? this.platformPayee(identity.payeeCode!)
        : '',
      this.notificationUrl(identityId),
    );
    return normalizeCardSubmission(await sdk.createOneStepCharge({}, body));
  }
  async detail(
    identityId: string,
    companyId: string,
    chargeId: string,
  ): Promise<unknown> {
    return (await this.account(identityId, companyId)).sdk.detailCharge({
      id: chargeId,
    });
  }
  async findAttempt(
    identityId: string,
    companyId: string,
    attemptId: string,
    createdAt: Date,
  ): Promise<unknown> {
    return (await this.account(identityId, companyId)).sdk.listCharges({
      charge_type: 'card',
      begin_date: new Date(createdAt.getTime() - 86400000)
        .toISOString()
        .slice(0, 10),
      end_date: new Date().toISOString().slice(0, 10),
      custom_id: attemptId,
    });
  }
  async cancel(identityId: string, companyId: string, chargeId: string) {
    await (
      await this.account(identityId, companyId)
    ).sdk.cancelCharge({ id: chargeId });
  }
}
