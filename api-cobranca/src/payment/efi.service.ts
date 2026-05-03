import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayAccount, InvoiceStatus } from '@prisma/client';
import EfiPay from 'sdk-node-apis-efi';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGatewayAccountDto } from './dto/gateway-account.dto';
import { PaymentCryptoService } from './payment-crypto.service';

type EfiEnvironment = 'homologation' | 'production';
type BillingType = 'PIX' | 'BOLETO' | 'BOLIX';

interface EfiCredentials {
  clientId: string;
  clientSecret: string;
  certificate?: string;
  certificateIsBase64: boolean;
}

interface EfiPixCobvResponse {
  txid?: string;
  loc?: {
    id?: number;
    location?: string;
  };
  location?: string;
  pixCopiaECola?: string;
  status?: string;
}

interface EfiPixQrCodeResponse {
  qrcode?: string;
  imagemQrcode?: string;
}

interface EfiSplitConfigResponse {
  id?: string;
  splitConfigId?: string;
}

interface EfiChargeResponse {
  code?: number;
  data?: {
    charge_id?: number;
    status?: string;
    barcode?: string;
    link?: string;
    billet_link?: string;
    pdf?: {
      charge?: string;
    };
    pix?: {
      qrcode?: string;
      qrcode_image?: string;
    };
  };
}

interface EfiNotificationResponse {
  data?: Array<{
    custom_id?: string | null;
    identifiers?: {
      charge_id?: number;
    };
    status?: {
      current?: string;
    };
  }>;
}

interface EfiErrorResponse {
  nome?: string;
  mensagem?: string;
  message?: string;
  error?: string;
  error_description?: string;
  title?: string;
  detail?: string;
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
    useGlobalBillingSettings: boolean;
    collectionReminderDays: number[];
    autoDiscountEnabled: boolean | null;
    autoDiscountDaysAfterDue: number | null;
    autoDiscountPercentage: { toNumber(): number } | null;
  };
  company: {
    addressPostalCode: string | null;
    addressStreet: string | null;
    addressNumber: string | null;
    addressDistrict: string | null;
    addressCity: string | null;
    addressState: string | null;
    collectionReminderDays: number[];
    autoDiscountEnabled: boolean;
    autoDiscountDaysAfterDue: number | null;
    autoDiscountPercentage: { toNumber(): number } | null;
  };
}

interface ResolvedDiscountSettings {
  enabled: boolean;
  daysAfterDue: number | null;
  percentage: number | null;
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
      include: { debtor: true, company: true },
    });

    if (!invoice) {
      throw new HttpException('Fatura não encontrada', HttpStatus.NOT_FOUND);
    }

    const gatewayAccount = await this.getActiveGatewayAccount(companyId);

    if (billingType === 'BOLETO' || billingType === 'BOLIX') {
      return this.createBoleto(invoice, gatewayAccount, billingType);
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

    const gatewayAccount =
      await this.findGatewayAccountByNotification(notification);

    if (!gatewayAccount) {
      this.logger.warn('Webhook Efi Cobrancas sem conta Efi relacionada');
      return { processed: false };
    }

    const client = this.createSdkClient(gatewayAccount);
    const response = await this.runEfiRequest(
      () => client.getNotification({ token: notification }),
      'consultar notificacao de cobranca',
    );
    const data = response as EfiNotificationResponse;
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
            efiChargeId: event.identifiers?.charge_id?.toString(),
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

  private async createPixCobv(
    invoice: PaymentInvoice,
    gatewayAccount: GatewayAccount,
  ): Promise<EfiPaymentResult> {
    const existing = this.buildExistingPixResult(invoice);
    if (existing) {
      return existing;
    }

    this.ensurePixCertificate(gatewayAccount);

    const client = this.createSdkClient(gatewayAccount);
    const txid = invoice.efiTxid ?? this.generateTxid(invoice.id);
    const dueDate = this.formatDate(invoice.dueDate);
    const amount = this.formatAmount(invoice.originalAmount);
    const debtorDocument = this.onlyDigits(invoice.debtor.document ?? '');
    const discountSettings = this.resolveDiscountSettings(invoice);
    const cobvPayload = {
      calendario: {
        dataDeVencimento: dueDate,
        validadeAposVencimento: 30,
      },
      devedor: {
        ...this.buildPixDebtorAddress(invoice),
        nome: invoice.debtor.name,
        ...(debtorDocument.length === 14
          ? { cnpj: debtorDocument }
          : { cpf: debtorDocument || '00000000000' }),
      },
      valor: {
        original: amount,
        ...(discountSettings.enabled
          ? {
              desconto: {
                modalidade: 3,
                valorPerc: this.formatPercentage(discountSettings.percentage),
              },
            }
          : {}),
      },
      chave: gatewayAccount.pixKey,
      solicitacaoPagador: `Cobranca ${invoice.id.slice(0, 8)}`,
    };

    await this.runEfiRequest(
      () => client.pixCreateDueCharge({ txid }, cobvPayload),
      'criar Pix CobV',
    );

    const detail = (await this.runEfiRequest(
      () => client.pixDetailDueCharge({ txid }),
      'consultar Pix CobV',
    )) as EfiPixCobvResponse;

    const splitConfigId = await this.createPixSplitConfig(
      client,
      gatewayAccount,
      txid,
    );

    if (splitConfigId) {
      await this.runEfiRequest(
        () => client.pixSplitLinkDueCharge({ txid, splitConfigId }),
        'vincular split Pix CobV',
      );
    }

    const locId = detail.loc?.id;
    const qrCode = locId
      ? ((await this.runEfiRequest(
          () => client.pixGenerateQRCode({ id: locId }),
          'gerar QR Code Pix CobV',
        )) as EfiPixQrCodeResponse)
      : null;
    const pixCopyPaste = qrCode?.qrcode ?? detail.pixCopiaECola ?? '';
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
        efiLocId: detail.loc?.id?.toString(),
        efiPixCopiaECola: pixCopyPaste,
        splitConfigId,
        gatewayStatusRaw: detail.status,
        discountApplied: this.calculateDiscountAmount(
          invoice.originalAmount,
          discountSettings.percentage,
        ),
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
      pixQrCode: qrCode?.imagemQrcode,
      expiresAt,
      paymentLink: detail.loc?.location ?? detail.location ?? '',
    };
  }

  private async createBoleto(
    invoice: PaymentInvoice,
    gatewayAccount: GatewayAccount,
    billingType: 'BOLETO' | 'BOLIX',
  ): Promise<EfiPaymentResult> {
    const existing = this.buildExistingBoletoResult(invoice);
    if (existing) {
      return existing;
    }

    const client = this.createSdkClient(gatewayAccount);
    const webhookUrl = this.buildWebhookUrl('/webhooks/efi/cobrancas');
    const customer = this.buildBoletoCustomer(invoice);
    const marketplaceRepasses =
      this.buildBoletoMarketplaceRepasses(gatewayAccount);
    const discountSettings = this.resolveDiscountSettings(invoice);
    const boletoDiscount =
      discountSettings.enabled && discountSettings.percentage !== null
        ? {
            conditional_discount: {
              type: 'percentage' as const,
              value: discountSettings.percentage,
              until_date: this.formatDate(
                this.addDays(
                  invoice.dueDate,
                  discountSettings.daysAfterDue ?? 0,
                ),
              ),
            },
          }
        : {};
    const payload = {
      items: [
        {
          name: `Cobranca ${invoice.id.slice(0, 8)}`,
          value: Math.round(Number(invoice.originalAmount) * 100),
          amount: 1,
          ...(marketplaceRepasses.length > 0
            ? {
                marketplace: {
                  repasses: marketplaceRepasses,
                },
              }
            : {}),
        },
      ],
      payment: {
        banking_billet: {
          expire_at: this.formatDate(invoice.dueDate),
          customer,
          ...boletoDiscount,
        },
      },
      metadata: {
        custom_id: invoice.id,
        notification_url: webhookUrl,
      },
    };

    const charge = (await this.runEfiRequest(
      () => client.createOneStepCharge({}, payload),
      'criar boleto',
    )) as EfiChargeResponse;

    const chargeData = charge.data;
    const chargeId = chargeData?.charge_id?.toString();
    if (!chargeId) {
      throw new HttpException(
        'Efi nao retornou charge_id para o boleto.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const boletoLink = chargeData?.billet_link ?? chargeData?.link ?? '';
    const boletoPdf = chargeData?.pdf?.charge ?? '';
    const boletoCode = chargeData?.barcode ?? '';

    await this.prisma.invoice.updateMany({
      where: { id: invoice.id, companyId: invoice.companyId },
      data: {
        gatewayId: chargeId,
        billingType,
        pixExpiresAt: invoice.dueDate,
        efiChargeId: chargeId,
        boletoLinhaDigitavel: boletoCode,
        boletoLink,
        boletoPdf,
        efiPixCopiaECola: chargeData?.pix?.qrcode,
        gatewayStatusRaw: chargeData?.status,
        discountApplied: this.calculateDiscountAmount(
          invoice.originalAmount,
          discountSettings.percentage,
        ),
      },
    });

    await this.createLog(
      invoice.companyId,
      invoice.id,
      billingType === 'BOLIX' ? 'EFI_BOLIX_CREATED' : 'EFI_BOLETO_CREATED',
      billingType === 'BOLIX'
        ? 'Bolix Efi criado com split automatico'
        : 'Boleto Efi criado com split automatico',
      'PENDING',
    );

    return {
      gatewayId: chargeId,
      chargeId,
      boletoCode,
      boletoLink,
      boletoPdf,
      pixCopyPaste: chargeData?.pix?.qrcode,
      pixQrCode: chargeData?.pix?.qrcode_image,
      expiresAt: invoice.dueDate,
      paymentLink: boletoLink,
    };
  }

  private async createPixSplitConfig(
    client: EfiPay,
    gatewayAccount: GatewayAccount,
    txid: string,
  ): Promise<string | null> {
    const platformPayeeCode = this.config.get<string>(
      'EFI_PLATFORM_PAYEE_CODE',
    );
    const platformPercentage = this.getPlatformSplitPercentage();

    if (
      platformPercentage === 0 ||
      !platformPayeeCode ||
      platformPayeeCode === gatewayAccount.payeeCode
    ) {
      return null;
    }

    const clientPercentage = 10000 - platformPercentage;

    const response = (await this.runEfiRequest(
      () =>
        client.pixSplitConfig(
          {},
          {
            descricao: `Split invoice ${txid}`,
            lancamento: {
              imediato: true,
            },
            split: {
              divisaoTarifa: 'assumir_total',
              minhaParte: {
                tipo: 'porcentagem',
                valor: this.formatBasisPointsAsPercent(clientPercentage),
              },
              repasses: [
                {
                  tipo: 'porcentagem',
                  valor: this.formatBasisPointsAsPercent(platformPercentage),
                  favorecido: { conta: platformPayeeCode },
                },
              ],
            },
          },
        ),
      'criar configuracao de split Pix',
    )) as EfiSplitConfigResponse;

    const splitConfigId = response.id ?? response.splitConfigId;
    if (!splitConfigId) {
      throw new HttpException(
        'Efi nao retornou splitConfigId.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return splitConfigId;
  }

  private buildBoletoMarketplaceRepasses(
    gatewayAccount: GatewayAccount,
  ): Array<{ payee_code: string; percentage: number }> {
    const platformPayeeCode = this.config.get<string>(
      'EFI_PLATFORM_PAYEE_CODE',
    );
    const platformPercentage = this.getPlatformSplitPercentage();

    if (
      platformPercentage === 0 ||
      !platformPayeeCode ||
      platformPayeeCode === gatewayAccount.payeeCode
    ) {
      return [];
    }

    return [
      {
        payee_code: platformPayeeCode,
        percentage: platformPercentage,
      },
    ];
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

  private resolveDiscountSettings(
    invoice: PaymentInvoice,
  ): ResolvedDiscountSettings {
    if (!invoice.debtor.useGlobalBillingSettings) {
      const debtorEnabled = invoice.debtor.autoDiscountEnabled;

      if (!debtorEnabled) {
        return {
          enabled: false,
          daysAfterDue: null,
          percentage: null,
        };
      }

      return this.normalizeDiscountSettings({
        enabled: true,
        daysAfterDue: invoice.debtor.autoDiscountDaysAfterDue,
        percentage: invoice.debtor.autoDiscountPercentage?.toNumber(),
      });
    }

    return this.normalizeDiscountSettings({
      enabled: invoice.company.autoDiscountEnabled,
      daysAfterDue: invoice.company.autoDiscountDaysAfterDue,
      percentage: invoice.company.autoDiscountPercentage?.toNumber(),
    });
  }

  private normalizeDiscountSettings(input: {
    enabled: boolean | null | undefined;
    daysAfterDue: number | null | undefined;
    percentage: number | null | undefined;
  }): ResolvedDiscountSettings {
    if (!input.enabled) {
      return {
        enabled: false,
        daysAfterDue: null,
        percentage: null,
      };
    }

    const daysAfterDue = this.normalizeDiscountDays(input.daysAfterDue);
    const percentage = this.normalizeDiscountPercentage(input.percentage);

    if (percentage === null) {
      return {
        enabled: false,
        daysAfterDue: null,
        percentage: null,
      };
    }

    return {
      enabled: true,
      daysAfterDue,
      percentage,
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

  private createSdkClient(gatewayAccount: GatewayAccount): EfiPay {
    const credentials = this.getCredentials(gatewayAccount);

    if (!credentials.clientId || !credentials.clientSecret) {
      throw new HttpException(
        'Credenciais Efi nao configuradas.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return new EfiPay({
      sandbox:
        this.getEnvironment(gatewayAccount.environment) === 'homologation',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      certificate: credentials.certificate,
      cert_base64: credentials.certificateIsBase64,
      cache: true,
    });
  }

  private getCredentials(gatewayAccount: GatewayAccount): EfiCredentials {
    const platformClientId = this.config.get<string>('EFI_PLATFORM_CLIENT_ID');
    const platformClientSecret = this.config.get<string>(
      'EFI_PLATFORM_CLIENT_SECRET',
    );
    const certificateBase64 = gatewayAccount.encryptedCertificate
      ? this.crypto.decrypt(gatewayAccount.encryptedCertificate)
      : undefined;

    return {
      clientId: gatewayAccount.encryptedClientId
        ? this.crypto.decrypt(gatewayAccount.encryptedClientId)
        : (platformClientId ?? ''),
      clientSecret: gatewayAccount.encryptedClientSecret
        ? this.crypto.decrypt(gatewayAccount.encryptedClientSecret)
        : (platformClientSecret ?? ''),
      certificate:
        certificateBase64 ??
        gatewayAccount.certificatePath ??
        this.config.get<string>('EFI_PLATFORM_CERT_PATH'),
      certificateIsBase64: Boolean(certificateBase64),
    };
  }

  private ensurePixCertificate(gatewayAccount: GatewayAccount): void {
    if (!this.getCredentials(gatewayAccount).certificate) {
      throw new HttpException(
        'Certificado Efi nao configurado para Pix.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async runEfiRequest<T>(
    request: () => Promise<T>,
    action: string,
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      this.logger.error(`Erro Efi ao ${action}: ${this.formatEfiError(error)}`);
      throw new HttpException(
        'Falha ao processar cobranca na Efi.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private formatEfiError(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }

    if (this.isRecord(error)) {
      const efiError = error as EfiErrorResponse;
      return (
        efiError.error_description ??
        efiError.detail ??
        efiError.mensagem ??
        efiError.message ??
        efiError.error ??
        efiError.title ??
        'erro desconhecido'
      );
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'erro desconhecido';
  }

  private buildPixDebtorAddress(invoice: PaymentInvoice): {
    logradouro: string;
    cidade: string;
    uf: string;
    cep: string;
  } {
    return {
      logradouro: invoice.company.addressStreet ?? 'Nao informado',
      cidade: invoice.company.addressCity ?? 'Sao Paulo',
      uf: invoice.company.addressState ?? 'SP',
      cep: this.onlyDigits(invoice.company.addressPostalCode ?? '00000000'),
    };
  }

  private buildBoletoCustomer(invoice: PaymentInvoice): {
    name: string;
    cpf?: string;
    email?: string;
    phone_number?: string;
    address: {
      street: string;
      number: string;
      neighborhood: string;
      zipcode: string;
      city: string;
      state: string;
    };
  } {
    return {
      name: invoice.debtor.name,
      cpf: this.onlyDigits(invoice.debtor.document ?? '00000000000'),
      email: invoice.debtor.email ?? undefined,
      phone_number: this.onlyDigits(invoice.debtor.phoneNumber),
      address: {
        street: invoice.company.addressStreet ?? 'Nao informado',
        number: invoice.company.addressNumber ?? '0',
        neighborhood: invoice.company.addressDistrict ?? 'Nao informado',
        zipcode: this.onlyDigits(
          invoice.company.addressPostalCode ?? '00000000',
        ),
        city: invoice.company.addressCity ?? 'Sao Paulo',
        state: invoice.company.addressState ?? 'SP',
      },
    };
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
    if (status === 'paid' || status === 'settled') {
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
    const url = new URL(
      path.replace(/^\//, ''),
      `${baseUrl.replace(/\/$/, '')}/`,
    );
    url.searchParams.set(
      'token',
      this.config.getOrThrow<string>('EFI_WEBHOOK_SECRET'),
    );

    return url.toString();
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

  private formatPercentage(value: number | null): string {
    return (value ?? 0).toFixed(2);
  }

  private normalizeDiscountDays(value: number | null | undefined): number {
    if (!Number.isInteger(value) || value === undefined || value === null) {
      return 0;
    }

    if (value < 0) {
      return 0;
    }

    if (value > 365) {
      return 365;
    }

    return value;
  }

  private normalizeDiscountPercentage(
    value: number | null | undefined,
  ): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    if (value <= 0) {
      return null;
    }

    if (value > 100) {
      return 100;
    }

    return Number(value.toFixed(2));
  }

  private calculateDiscountAmount(
    originalAmount: unknown,
    percentage: number | null,
  ): string | null {
    if (percentage === null) {
      return null;
    }

    const total = Number(originalAmount);
    const discountAmount = (total * percentage) / 100;
    return discountAmount.toFixed(2);
  }

  private addDays(date: Date, days: number): Date {
    const target = new Date(date);
    target.setDate(target.getDate() + days);
    return target;
  }

  private getPlatformSplitPercentage(): number {
    const percentage = Number(
      this.config.get<string>('EFI_PLATFORM_SPLIT_PERCENTAGE') ?? '0',
    );

    if (
      !Number.isInteger(percentage) ||
      percentage < 0 ||
      percentage >= 10000
    ) {
      throw new HttpException(
        'EFI_PLATFORM_SPLIT_PERCENTAGE deve estar entre 0 e 9999.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return percentage;
  }

  private formatBasisPointsAsPercent(value: number): string {
    return (value / 100).toFixed(2);
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
