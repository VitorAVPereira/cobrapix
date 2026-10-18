import { ConflictException, Injectable } from '@nestjs/common';
import EfiPay from 'sdk-node-apis-efi';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EFI_REFUSALS } from './disbursement-reasons';

export interface DisbursementAccount {
  identityId: string;
  pixKey: string;
  environment: 'HOMOLOGATION' | 'PRODUCTION';
  sdk: EfiPay;
}

export interface SendInput {
  idEnvio: string;
  amountCents: number;
  reference: string;
  documentType: 'CPF' | 'CNPJ';
  document: string;
  recipientName: string;
  pixKey: string | null;
  bankIspb: string | null;
  bankAgency: string | null;
  bankAccount: string | null;
  bankAccountType: string | null;
}

export type SendOutcome =
  | { kind: 'IN_PROCESSING'; e2eId: string }
  | { kind: 'PAID'; e2eId: string }
  | { kind: 'REFUSED'; code: string; reason: string }
  // The send id was used already: the first attempt may have been processed.
  | { kind: 'DUPLICATE' }
  | { kind: 'RATE_LIMITED' }
  | { kind: 'UNCERTAIN' };

export type SentStatus =
  | { kind: 'FOUND'; status: string; e2eId: string; settledAt: Date | null }
  | { kind: 'NOT_FOUND' };

function providerName(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  for (const key of ['nome', 'error'])
    if (typeof record[key] === 'string') return record[key];
  return null;
}

function cents(value: number): string {
  return (value / 100).toFixed(2);
}

/** Pix send of a company's own Efí account, with the certificate of its active credential. */
@Injectable()
export class EfiDisbursementClient {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
  ) {}

  async account(
    identityId: string,
    companyId: string,
  ): Promise<DisbursementAccount> {
    const identity = await this.prisma.efiAccountIdentity.findFirst({
      where: { id: identityId, companyId, ownership: 'COMPANY' },
      include: {
        credentialVersions: { where: { status: 'ACTIVE' }, take: 1 },
      },
    });
    const credential = identity?.credentialVersions[0];
    if (
      !identity?.pixKey ||
      !credential ||
      credential.certificateExpiresAt <= new Date()
    )
      throw new ConflictException({
        code: 'EFI_ACCOUNT_UNAVAILABLE',
        message: 'Conta Efí indisponível.',
      });
    return {
      identityId: identity.id,
      pixKey: identity.pixKey,
      environment: identity.environment,
      sdk: new EfiPay({
        sandbox: identity.environment !== 'PRODUCTION',
        client_id: this.crypto.decrypt(credential.encryptedClientId),
        client_secret: this.crypto.decrypt(credential.encryptedClientSecret),
        certificate: this.crypto.decrypt(credential.encryptedCertificate),
        cert_base64: true,
        cache: false,
      }),
    };
  }

  /**
   * One send attempt. Known refusals never debited; a reused send id may have been
   * processed; anything unexpected (5xx, timeout, network) is uncertain.
   */
  async send(
    account: DisbursementAccount,
    input: SendInput,
  ): Promise<SendOutcome> {
    const document =
      input.documentType === 'CPF'
        ? { cpf: input.document }
        : { cnpj: input.document };
    const favorecido = input.pixKey
      ? { chave: input.pixKey, ...document }
      : {
          contaBanco: {
            nome: input.recipientName.slice(0, 200),
            ...document,
            codigoBanco: input.bankIspb!,
            agencia: input.bankAgency!,
            conta: input.bankAccount!,
            tipoConta: input.bankAccountType!,
          },
        };
    let response: Awaited<ReturnType<EfiPay['pixSend']>>;
    try {
      response = await account.sdk.pixSend(
        { idEnvio: input.idEnvio },
        {
          valor: cents(input.amountCents),
          pagador: {
            chave: account.pixKey,
            infoPagador: input.reference.slice(0, 140),
          },
          favorecido,
        },
      );
    } catch (error) {
      const name = providerName(error);
      if (name === 'id_envio_duplicado') return { kind: 'DUPLICATE' };
      if (name === 'balde_fichas_vazio') return { kind: 'RATE_LIMITED' };
      if (name && EFI_REFUSALS[name])
        return { kind: 'REFUSED', code: name, reason: EFI_REFUSALS[name] };
      return { kind: 'UNCERTAIN' };
    }
    if (
      !response ||
      response.idEnvio !== input.idEnvio ||
      typeof response.e2eId !== 'string'
    )
      return { kind: 'UNCERTAIN' };
    // Homologation answers 201 with NAO_REALIZADO and sends no webhook for it.
    if (response.status === 'NAO_REALIZADO')
      return {
        kind: 'REFUSED',
        code: 'NAO_REALIZADO',
        reason: 'Pix não realizado pela Efí',
      };
    if (response.status === 'REALIZADO')
      return { kind: 'PAID', e2eId: response.e2eId };
    return { kind: 'IN_PROCESSING', e2eId: response.e2eId };
  }

  async status(
    account: DisbursementAccount,
    idEnvio: string,
  ): Promise<SentStatus> {
    try {
      const detail = await account.sdk.pixSendDetailId({ idEnvio });
      return {
        kind: 'FOUND',
        status: detail.status,
        e2eId: detail.endToEndId,
        settledAt: detail.horario?.liquidacao
          ? new Date(detail.horario.liquidacao)
          : null,
      };
    } catch (error) {
      const type =
        error && typeof error === 'object'
          ? (error as Record<string, unknown>).type
          : null;
      if (typeof type === 'string' && type.endsWith('/PixEnviadoNaoEncontrado'))
        return { kind: 'NOT_FOUND' };
      throw error;
    }
  }

  /** Balance reported by Efí (`saldo`), in cents. Always zero in homologation. */
  async balanceCents(account: DisbursementAccount): Promise<number> {
    const { saldo } = await account.sdk.getAccountBalance();
    if (typeof saldo !== 'string' || !/^\d+\.\d{2}$/.test(saldo))
      throw new Error('EFI_BALANCE_INVALID');
    return Number(saldo.replace('.', ''));
  }

  receipt(account: DisbursementAccount, idEnvio: string): Promise<Buffer> {
    return account.sdk.pixGetReceipt({ idEnvio });
  }
}
