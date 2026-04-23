import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayAccount, InvoiceStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import { request as httpsRequest, RequestOptions } from 'https';
import { URL } from 'url';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGatewayAccountDto } from './dto/gateway-account.dto';
import { PaymentCryptoService } from './payment-crypto.service';

type EfiEnvironment = 'homologation' | 'production';
type EfiApi = 'pix' | 'charges' | 'accounts';
type BillingType = 'PIX' | 'BOLETO';

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

interface EfiCredentials {
  clientId: string;
  clientSecret: string;
  certificatePath?: string;
  certificatePassword?: string;
  encryptedCertificate?: string;
}

interface EfiErrorResponse {
  error?: string;
  error_description?: string;
  message?: string;
  nome?: string;
}

interface EfiPixCobvResponse {
  txid?: string;
  loc?: {
    id?: number;
    location?: string;
  };
  pixCopiaECola?: string;
  copiaECola?: string;
  status?: string;
}

interface EfiSplitConfigResponse {
  id?: string;
  splitConfigId?: string;
}

interface EfiChargeResponse {
  charge_id?: number;
  chargeId?: number;
  total?: number;
  status?: string;
  link?: string;
  pdf?: {
    charge?: string;
  };
  payment?: {
    banking_billet?: {
      barcode?: string;
      link?: string;
      pdf?: {
        charge?: string;
      };
    };
    pix?: {
      qrcode?: string;
      qrcode_image?: string;
    };
  };
}

interface EfiNotificationResponse {
  data?: Array<{
    custom_id?: string;
    charge_id?: number;
    status?: {
      current?: string;
    };
  }>;
}

interface PaymentInvoice {
  id: string;
  companyId: string;
  originalAmount: unknown;
  dueDate: Date;
  gatewayId: string | null;
  efiTxid: string | null;
  efiChargeId: string | null;
  efiPixCopiaECola: string | null;
  boletoLinhaDigitavel: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
  pixExpiresAt: Date | null;
  debtor: {
    name: string;
    document: string | null;
    email: string | null;
    phoneNumber: string;
  };
}

export interface EfiPaymentResult {
  gatewayId: string;
  txid?: string;
  chargeId?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  boletoCode?: string;
  boletoLink?: string;
  boletoPdf?: string;
  expiresAt: Date;
  paymentLink: string;
}

@Injectable()
export class EfiService {
  private readonly logger = new Logger(EfiService.name);
  private readonly tokenCache = new Map<string, TokenCacheEntry>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
  ) {}

  async upsertManualGatewayAccount(
    companyId: string,
    dto: CreateGatewayAccountDto,
  ): Promise<void> {
    const environment = this.getEnvironment(dto.environment);
    const encryptedClientId = this.crypto.encrypt(dto.efiClientId);
    const encryptedClientSecret = this.crypto.encrypt(dto.efiClientSecret);
    const encryptedCertificatePassword = dto.efiCertificatePassword
      ? this.crypto.encrypt(dto.efiCertificatePassword)
      : null;
    const encryptedCertificate = dto.efiCertificateBase64
      ? this.crypto.encrypt(dto.efiCertificateBase64)
      : null;

    await this.prisma.gatewayAccount.upsert({
      where: { companyId },
      create: {
        companyId,
        provider: 'EFI',
        environment,
        status: dto.gatewayStatus ?? 'ACTIVE',
        payeeCode: dto.efiPayeeCode,
        efiAccountNumber: dto.efiAccountNumber,
        efiAccountDigit: dto.efiAccountDigit,
        pixKey: dto.efiPixKey,
        encryptedClientId,
        encryptedClientSecret,
        encryptedCertificate,
        certificatePath: dto.efiCertificatePath,
        encryptedCertificatePassword,
      },
      update: {
        provider: 'EFI',
        environment,
        status: dto.gatewayStatus ?? 'ACTIVE',
        payeeCode: dto.efiPayeeCode,
        efiAccountNumber: dto.efiAccountNumber,
        efiAccountDigit: dto.efiAccountDigit,
        pixKey: dto.efiPixKey,
        encryptedClientId,
        encryptedClientSecret,
        encryptedCertificate,
        certificatePath: dto.efiCertificatePath,
        encryptedCertificatePassword,
        lastError: null,
      },
    });
  }

  async createPayment(
    invoiceId: string,
    companyId: string,
    billingType: BillingType,
  ): Promise<EfiPaymentResult> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { debtor: true },
    });

    if (!invoice) {
      throw new HttpException('Fatura nao encontrada', HttpStatus.NOT_FOUND);
    }

    const gatewayAccount = await this.getActiveGatewayAccount(companyId);

    if (billingType === 'BOLETO') {
      return this.createBoleto(invoice, gatewayAccount);
    }

    return this.createPixCobv(invoice, gatewayAccount);
  }

  async handlePixWebhook(payload: unknown): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: InvoiceStatus;
  }> {
    const txids = this.extractPixTxids(payload);

    if (txids.length === 0) {
      this.logger.warn('Webhook Efi Pix sem txid processavel');
      return { processed: false };
    }

    let processed = false;
    let lastInvoiceId: string | undefined;
    let lastStatus: InvoiceStatus | undefined;

    for (const txid of txids) {
      const invoice = await this.prisma.invoice.findFirst({
        where: { efiTxid: txid },
      });

      if (!invoice) {
        this.logger.warn(`Webhook Efi Pix sem fatura para txid ${txid}`);
        continue;
      }

      await this.markInvoice(invoice.id, invoice.companyId, 'PAID', {
        actionType: 'EFI_PIX_WEBHOOK',
        description: `Pix Efi confirmado para txid ${txid}`,
        gatewayStatusRaw: 'CONCLUIDA',
      });
      processed = true;
      lastInvoiceId = invoice.id;
      lastStatus = 'PAID';
    }

    return { processed, invoiceId: lastInvoiceId, status: lastStatus };
  }

  async handleChargesWebhook(payload: unknown): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: InvoiceStatus;
  }> {
    const notification = this.extractNotificationToken(payload);

    if (!notification) {
      this.logger.warn('Webhook Efi Cobrancas sem notification');
      return { processed: false };
    }

    const gatewayAccount = await this.findGatewayAccountByNotification(
      notification,
    );

    if (!gatewayAccount) {
      this.logger.warn('Webhook Efi Cobrancas sem conta Efi relacionada');
      return { processed: false };
    }

    const data = await this.requestJson<EfiNotificationResponse>(
      gatewayAccount,
      'charges',
      'GET',
      `/v1/notification/${encodeURIComponent(notification)}`,
    );
    const event = data.data?.at(-1);

    if (!event) {
      return { processed: false };
    }

    const invoice = event.custom_id
      ? await this.prisma.invoice.findFirst({
          where: { id: event.custom_id, companyId: gatewayAccount.companyId },
        })
      : await this.prisma.invoice.findFirst({
          where: {
            efiChargeId: event.charge_id?.toString(),
            companyId: gatewayAccount.companyId,
          },
        });

    if (!invoice) {
      return { processed: false };
    }

    const mappedStatus = this.mapChargeStatus(event.status?.current);

    if (!mappedStatus) {
      await this.prisma.invoice.updateMany({
        where: { id: invoice.id, companyId: gatewayAccount.companyId },
        data: {
          notificationToken: notification,
          gatewayStatusRaw: event.status?.current,
        },
      });
      return { processed: true, invoiceId: invoice.id };
    }

    await this.markInvoice(invoice.id, invoice.companyId, mappedStatus, {
      actionType: 'EFI_CHARGES_WEBHOOK',
      description: `Boleto/Bolix Efi atualizado para ${event.status?.current}`,
      gatewayStatusRaw: event.status?.current,
      notificationToken: notification,
    });

    return { processed: true, invoiceId: invoice.id, status: mappedStatus };
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('PAYMENT_SECRET_KEY'));
  }

  getEnvironment(value?: string): EfiEnvironment {
    return value === 'production' ? 'production' : 'homologation';
  }

  getBaseUrl(api: EfiApi, environment: EfiEnvironment): string {
    const hosts: Record<EfiApi, Record<EfiEnvironment, string>> = {
      charges: {
        homologation: 'https://cobrancas-h.api.efipay.com.br',
        production: 'https://cobrancas.api.efipay.com.br',
      },
      pix: {
        homologation: 'https://pix-h.api.efipay.com.br',
        production: 'https://pix.api.efipay.com.br',
      },
      accounts: {
        homologation: 'https://abrircontas-h.api.efipay.com.br',
        production: 'https://abrircontas.api.efipay.com.br',
      },
    };

    return hosts[api][environment];
  }

  private async createPixCobv(
    invoice: PaymentInvoice,
    gatewayAccount: GatewayAccount,
  ): Promise<EfiPaymentResult> {
    const existing = this.buildExistingPixResult(invoice);
    if (existing) {
      return existing;
    }

    const txid = invoice.efiTxid ?? this.generateTxid(invoice.id);
    const dueDate = this.formatDate(invoice.dueDate);
    const amount = this.formatAmount(invoice.originalAmount);
    const debtorDocument = this.onlyDigits(invoice.debtor.document ?? '');
    const cobvPayload = {
      calendario: {
        dataDeVencimento: dueDate,
        validadeAposVencimento: 30,
      },
      devedor: {
        nome: invoice.debtor.name,
        ...(debtorDocument.length === 14
          ? { cnpj: debtorDocument }
          : { cpf: debtorDocument || '00000000000' }),
      },
      valor: {
        original: amount,
      },
      chave: gatewayAccount.pixKey,
      solicitacaoPagador: `Cobranca ${invoice.id.slice(0, 8)}`,
    };

    const cobv = await this.requestJson<EfiPixCobvResponse>(
      gatewayAccount,
      'pix',
      'PUT',
      `/v2/cobv/${txid}`,
      cobvPayload,
    );

    const splitConfigId = await this.createPixSplitConfig(
      gatewayAccount,
      txid,
      amount,
    );

    await this.requestJson<Record<string, unknown>>(
      gatewayAccount,
      'pix',
      'PUT',
      `/v2/gn/split/cobv/${txid}/vinculo/${splitConfigId}`,
    );

    const pixCopyPaste = cobv.pixCopiaECola ?? cobv.copiaECola ?? '';
    const expiresAt = new Date(invoice.dueDate);
    expiresAt.setDate(expiresAt.getDate() + 1);

    await this.prisma.invoice.updateMany({
      where: { id: invoice.id, companyId: invoice.companyId },
      data: {
        gatewayId: txid,
        billingType: 'PIX',
        pixPayload: pixCopyPaste,
        pixExpiresAt: expiresAt,
        efiTxid: txid,
        efiLocId: cobv.loc?.id?.toString(),
        efiPixCopiaECola: pixCopyPaste,
        splitConfigId,
        gatewayStatusRaw: cobv.status,
      },
    });

    await this.createLog(
      invoice.companyId,
      invoice.id,
      'EFI_PIX_CREATED',
      'Pix CobV Efi criado com split automatico',
      'PENDING',
    );

    return {
      gatewayId: txid,
      txid,
      pixCopyPaste,
      expiresAt,
      paymentLink: cobv.loc?.location ?? '',
    };
  }

  private async createBoleto(
    invoice: PaymentInvoice,
    gatewayAccount: GatewayAccount,
  ): Promise<EfiPaymentResult> {
    const existing = this.buildExistingBoletoResult(invoice);
    if (existing) {
      return existing;
    }

    const webhookUrl = this.buildWebhookUrl('/webhooks/efi/cobrancas');
    const payload = {
      items: [
        {
          name: `Cobranca ${invoice.id.slice(0, 8)}`,
          value: Math.round(Number(invoice.originalAmount) * 100),
          amount: 1,
          marketplace: {
            repasses: [
              {
                payee_code: gatewayAccount.payeeCode,
                percentage: 10000,
              },
            ],
          },
        },
      ],
      payment: {
        banking_billet: {
          expire_at: this.formatDate(invoice.dueDate),
          customer: {
            name: invoice.debtor.name,
            cpf: this.onlyDigits(invoice.debtor.document ?? '00000000000'),
            email: invoice.debtor.email ?? undefined,
            phone_number: this.onlyDigits(invoice.debtor.phoneNumber),
          },
        },
      },
      metadata: {
        custom_id: invoice.id,
        notification_url: webhookUrl,
      },
    };

    const charge = await this.requestJson<EfiChargeResponse>(
      gatewayAccount,
      'charges',
      'POST',
      '/v1/charge/one-step',
      payload,
    );

    const chargeId = (charge.charge_id ?? charge.chargeId)?.toString();
    if (!chargeId) {
      throw new HttpException(
        'Efi nao retornou charge_id para o boleto.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const bankingBillet = charge.payment?.banking_billet;
    const boletoLink = bankingBillet?.link ?? charge.link ?? '';
    const boletoPdf = bankingBillet?.pdf?.charge ?? charge.pdf?.charge ?? '';
    const boletoCode = bankingBillet?.barcode ?? '';

    await this.prisma.invoice.updateMany({
      where: { id: invoice.id, companyId: invoice.companyId },
      data: {
        gatewayId: chargeId,
        billingType: 'BOLETO',
        pixExpiresAt: invoice.dueDate,
        efiChargeId: chargeId,
        boletoLinhaDigitavel: boletoCode,
        boletoLink,
        boletoPdf,
        efiPixCopiaECola: charge.payment?.pix?.qrcode,
        gatewayStatusRaw: charge.status,
      },
    });

    await this.createLog(
      invoice.companyId,
      invoice.id,
      'EFI_BOLETO_CREATED',
      'Boleto/Bolix Efi criado com split automatico',
      'PENDING',
    );

    return {
      gatewayId: chargeId,
      chargeId,
      boletoCode,
      boletoLink,
      boletoPdf,
      pixCopyPaste: charge.payment?.pix?.qrcode,
      expiresAt: invoice.dueDate,
      paymentLink: boletoLink,
    };
  }

  private async createPixSplitConfig(
    gatewayAccount: GatewayAccount,
    txid: string,
    amount: string,
  ): Promise<string> {
    const platformPayeeCode =
      this.config.get<string>('EFI_PLATFORM_PAYEE_CODE') ?? gatewayAccount.payeeCode;
    const platformPercentage = Number(
      this.config.get<string>('EFI_PLATFORM_SPLIT_PERCENTAGE') ?? '0',
    );
    const clientPercentage = Math.max(0, 10000 - platformPercentage);
    const repasses =
      platformPercentage > 0 && platformPayeeCode !== gatewayAccount.payeeCode
        ? [
            { tipo: 'porcentagem', valor: platformPercentage, favorecido: { conta: platformPayeeCode } },
            { tipo: 'porcentagem', valor: clientPercentage, favorecido: { conta: gatewayAccount.payeeCode } },
          ]
        : [
            { tipo: 'porcentagem', valor: 10000, favorecido: { conta: gatewayAccount.payeeCode } },
          ];

    const response = await this.requestJson<EfiSplitConfigResponse>(
      gatewayAccount,
      'pix',
      'POST',
      '/v2/gn/split/config',
      {
        descricao: `Split invoice ${txid}`,
        lancamento: {
          imediato: true,
        },
        split: {
          divisaoTarifa: 'assumir_total',
          minhaParte: {
            tipo: 'porcentagem',
            valor: 0,
          },
          repasses,
        },
        valor: amount,
      },
    );

    const splitConfigId = response.id ?? response.splitConfigId;
    if (!splitConfigId) {
      throw new HttpException(
        'Efi nao retornou splitConfigId.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return splitConfigId;
  }

  private buildExistingPixResult(
    invoice: PaymentInvoice,
  ): EfiPaymentResult | null {
    if (!invoice.efiTxid || !invoice.efiPixCopiaECola) {
      return null;
    }

    return {
      gatewayId: invoice.efiTxid,
      txid: invoice.efiTxid,
      pixCopyPaste: invoice.efiPixCopiaECola,
      expiresAt: invoice.pixExpiresAt ?? invoice.dueDate,
      paymentLink: '',
    };
  }

  private buildExistingBoletoResult(
    invoice: PaymentInvoice,
  ): EfiPaymentResult | null {
    if (!invoice.efiChargeId) {
      return null;
    }

    return {
      gatewayId: invoice.efiChargeId,
      chargeId: invoice.efiChargeId,
      boletoCode: invoice.boletoLinhaDigitavel ?? undefined,
      boletoLink: invoice.boletoLink ?? undefined,
      boletoPdf: invoice.boletoPdf ?? undefined,
      expiresAt: invoice.pixExpiresAt ?? invoice.dueDate,
      paymentLink: invoice.boletoLink ?? '',
    };
  }

  private async getActiveGatewayAccount(
    companyId: string,
  ): Promise<GatewayAccount> {
    const gatewayAccount = await this.prisma.gatewayAccount.findFirst({
      where: { companyId, provider: 'EFI' },
    });

    if (!gatewayAccount) {
      throw new HttpException(
        'Conta Efi nao cadastrada para esta empresa.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (gatewayAccount.status !== 'ACTIVE') {
      throw new HttpException(
        'Conta Efi precisa estar ACTIVE para emitir cobrancas.',
        HttpStatus.CONFLICT,
      );
    }

    return gatewayAccount;
  }

  private async findGatewayAccountByNotification(
    notification: string,
  ): Promise<GatewayAccount | null> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { notificationToken: notification },
    });

    if (invoice) {
      return this.prisma.gatewayAccount.findFirst({
        where: { companyId: invoice.companyId, provider: 'EFI' },
      });
    }

    return this.prisma.gatewayAccount.findFirst({
      where: { provider: 'EFI', status: 'ACTIVE' },
    });
  }

  private async requestJson<T>(
    gatewayAccount: GatewayAccount,
    api: EfiApi,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken(gatewayAccount, api);
    const environment = this.getEnvironment(gatewayAccount.environment);
    const url = `${this.getBaseUrl(api, environment)}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const response =
      api === 'pix' || api === 'accounts'
        ? await this.requestWithMtls(gatewayAccount, url, method, headers, body)
        : await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });

    if (!response.ok) {
      const message = await this.getSafeErrorMessage(response);
      this.logger.error(`Erro Efi ${api} ${method} ${path}: ${message}`);
      throw new HttpException(
        'Falha ao processar cobranca na Efi.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  private async getAccessToken(
    gatewayAccount: GatewayAccount,
    api: EfiApi,
  ): Promise<string> {
    const environment = this.getEnvironment(gatewayAccount.environment);
    const cacheKey = `${gatewayAccount.companyId}:${api}:${environment}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + 30_000) {
      return cached.accessToken;
    }

    const credentials = this.getCredentials(gatewayAccount);
    const authorization = Buffer.from(
      `${credentials.clientId}:${credentials.clientSecret}`,
      'utf8',
    ).toString('base64');
    const url =
      api === 'charges'
        ? `${this.getBaseUrl(api, environment)}/v1/authorize`
        : `${this.getBaseUrl(api, environment)}/oauth/token`;
    const payload =
      api === 'charges'
        ? { grant_type: 'client_credentials' }
        : {
            grant_type: 'client_credentials',
            scope:
              'cobv.write cobv.read pix.read webhook.write webhook.read gn.split.write gn.split.read',
          };
    const headers = {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/json',
    };
    const response =
      api === 'charges'
        ? await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          })
        : await this.requestWithMtls(
            gatewayAccount,
            url,
            'POST',
            headers,
            payload,
          );

    if (!response.ok) {
      const message = await this.getSafeErrorMessage(response);
      this.logger.error(`Erro ao autenticar Efi ${api}: ${message}`);
      throw new HttpException(
        'Falha ao autenticar na Efi.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const token = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!token.access_token) {
      throw new HttpException(
        'Efi nao retornou access_token.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.tokenCache.set(cacheKey, {
      accessToken: token.access_token,
      expiresAt: Date.now() + (token.expires_in ?? 300) * 1000,
    });

    return token.access_token;
  }

  private requestWithMtls(
    gatewayAccount: GatewayAccount,
    urlValue: string,
    method: 'GET' | 'POST' | 'PUT',
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const credentials = this.getCredentials(gatewayAccount);
    const url = new URL(urlValue);
    const bodyText = body ? JSON.stringify(body) : undefined;
    const pfx = credentials.encryptedCertificate
      ? Buffer.from(credentials.encryptedCertificate, 'base64')
      : credentials.certificatePath
        ? readFileSync(credentials.certificatePath)
        : undefined;

    if (!pfx) {
      throw new HttpException(
        'Certificado Efi nao configurado para APIs com mTLS.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const options: RequestOptions = {
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      pfx,
      passphrase: credentials.certificatePassword,
    };

    return new Promise<Response>((resolve, reject) => {
      const req = httpsRequest(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks);
          const response = new Response(responseBody, {
            status: res.statusCode ?? 500,
            statusText: res.statusMessage,
            headers: res.headers as HeadersInit,
          });
          resolve(response);
        });
      });

      req.on('error', reject);

      if (bodyText) {
        req.write(bodyText);
      }

      req.end();
    });
  }

  private getCredentials(gatewayAccount: GatewayAccount): EfiCredentials {
    const platformClientId = this.config.get<string>('EFI_PLATFORM_CLIENT_ID');
    const platformClientSecret = this.config.get<string>(
      'EFI_PLATFORM_CLIENT_SECRET',
    );

    return {
      clientId: gatewayAccount.encryptedClientId
        ? this.crypto.decrypt(gatewayAccount.encryptedClientId)
        : platformClientId ?? '',
      clientSecret: gatewayAccount.encryptedClientSecret
        ? this.crypto.decrypt(gatewayAccount.encryptedClientSecret)
        : platformClientSecret ?? '',
      certificatePath:
        gatewayAccount.certificatePath ??
        this.config.get<string>('EFI_PLATFORM_CERT_PATH'),
      certificatePassword: gatewayAccount.encryptedCertificatePassword
        ? this.crypto.decrypt(gatewayAccount.encryptedCertificatePassword)
        : this.config.get<string>('EFI_PLATFORM_CERT_PASSWORD'),
      encryptedCertificate: gatewayAccount.encryptedCertificate
        ? this.crypto.decrypt(gatewayAccount.encryptedCertificate)
        : undefined,
    };
  }

  private async getSafeErrorMessage(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as EfiErrorResponse;
      return (
        body.error_description ??
        body.message ??
        body.error ??
        body.nome ??
        response.statusText
      );
    } catch {
      return response.statusText;
    }
  }

  private extractPixTxids(payload: unknown): string[] {
    if (!this.isRecord(payload)) {
      return [];
    }

    const pix = payload.pix;
    if (Array.isArray(pix)) {
      return pix
        .map((event) =>
          this.isRecord(event) && typeof event.txid === 'string'
            ? event.txid
            : null,
        )
        .filter((txid): txid is string => Boolean(txid));
    }

    return typeof payload.txid === 'string' ? [payload.txid] : [];
  }

  private extractNotificationToken(payload: unknown): string | null {
    if (!this.isRecord(payload)) {
      return null;
    }

    if (typeof payload.notification === 'string') {
      return payload.notification;
    }

    if (typeof payload.token === 'string') {
      return payload.token;
    }

    return null;
  }

  private mapChargeStatus(status?: string): InvoiceStatus | null {
    if (status === 'paid') {
      return 'PAID';
    }

    if (status === 'canceled' || status === 'expired' || status === 'unpaid') {
      return 'CANCELED';
    }

    return null;
  }

  private async markInvoice(
    invoiceId: string,
    companyId: string,
    status: InvoiceStatus,
    context: {
      actionType: string;
      description: string;
      gatewayStatusRaw?: string;
      notificationToken?: string;
    },
  ): Promise<void> {
    await this.prisma.invoice.updateMany({
      where: { id: invoiceId, companyId },
      data: {
        status,
        gatewayStatusRaw: context.gatewayStatusRaw,
        notificationToken: context.notificationToken,
      },
    });

    await this.createLog(
      companyId,
      invoiceId,
      context.actionType,
      context.description,
      status,
    );
  }

  private async createLog(
    companyId: string,
    invoiceId: string,
    actionType: string,
    description: string,
    status: string,
  ): Promise<void> {
    await this.prisma.collectionLog.create({
      data: {
        companyId,
        invoiceId,
        actionType,
        description,
        status,
      },
    });
  }

  private buildWebhookUrl(path: string): string {
    const baseUrl = this.config.get<string>('EFI_WEBHOOK_BASE_URL') ?? '';
    return `${baseUrl.replace(/\/$/, '')}${path}`;
  }

  private generateTxid(invoiceId: string): string {
    return invoiceId.replace(/-/g, '').slice(0, 32);
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0] as string;
  }

  private formatAmount(value: unknown): string {
    return Number(value).toFixed(2);
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
