import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayAccount } from '@prisma/client';
import { createHash } from 'crypto';
import EfiPay from 'sdk-node-apis-efi';
import { PaymentCryptoService } from './payment-crypto.service';

// Decrypted material of one credential version. Lives only in memory for the
// duration of a validation; never persisted, queued or logged.
export interface EfiAccountMaterial {
  environment: 'HOMOLOGATION' | 'PRODUCTION';
  clientId: string;
  clientSecret: string;
  certificateBase64: string;
}

// Operations used to prepare an existing account, without the opening API.
export interface EfiAccountOperations {
  // Read: proves Pix OAuth and CobV read scope, not issuance.
  listRecentDueCharges(): Promise<void>;
  // Changes the Pix webhook of the key; fails when the key is not the account's.
  configurePixWebhook(pixKey: string): Promise<void>;
  // Read: URL currently registered for the key.
  pixWebhookUrl(pixKey: string): Promise<string | undefined>;
  // Changes a split configuration identified by a stable id; creates no charge.
  upsertValidationSplit(id: string): Promise<void>;
  // Read on the Cobranças API: proves its OAuth, not boleto/Bolix issuance.
  listChargePlans(): Promise<void>;
}

@Injectable()
export class EfiGatewayClient {
  constructor(
    private readonly config: ConfigService,
    private readonly crypto: PaymentCryptoService,
  ) {}
  async listEvp(account: GatewayAccount): Promise<string[]> {
    return (await this.sdk(account).pixListEvp()).chaves;
  }
  async createEvp(account: GatewayAccount): Promise<string> {
    return (await this.sdk(account).pixCreateEvp()).chave;
  }
  async configureWebhooks(account: GatewayAccount): Promise<void> {
    await this.sdk(account).pixConfigWebhook(
      { chave: account.pixKey },
      { webhookUrl: `${this.webhookBase()}/webhooks/efi/pix?ignorar=` },
    );
    // Cobranças registers notification_url per charge, not per account. The same validated URL is mandatory at issuance.
    this.chargesWebhookUrl(account.companyId);
  }
  chargesWebhookUrl(companyId: string): string {
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
      throw new Error('EFI_CHARGES_WEBHOOK_URL_INVALID');
    return `${url.origin}/webhooks/efi/cobrancas?companyId=${encodeURIComponent(companyId)}`;
  }
  async validate(account: GatewayAccount): Promise<void> {
    const client = this.sdk(account);
    const fim = new Date().toISOString();
    const inicio = new Date(Date.now() - 3600_000).toISOString();
    await client.pixListDueCharges({ inicio, fim });
    const webhook = await client.pixDetailWebhook({ chave: account.pixKey });
    if (
      webhook.webhookUrl !== `${this.webhookBase()}/webhooks/efi/pix?ignorar=`
    )
      throw new Error('EFI_WEBHOOK_MISMATCH');
    await client.listPlans({ limit: 1 });
    const cnpj = this.config.get<string>('EFI_PLATFORM_CNPJ');
    const conta = this.config.get<string>('EFI_PLATFORM_ACCOUNT_NUMBER');
    if (!cnpj || !conta || conta === account.efiAccountNumber)
      throw new Error('EFI_PLATFORM_ACCOUNT_INVALID');
    // PUT with a stable ID validates split permission without issuing a payable charge or transferring money.
    const id = createHash('sha256')
      .update(`efi-validation-${account.companyId}`)
      .digest('hex')
      .slice(0, 32);
    await client.pixSplitConfigId(
      { id },
      {
        descricao: 'Validação CifraMais',
        lancamento: { imediato: true },
        split: {
          divisaoTarifa: 'assumir_total',
          minhaParte: { tipo: 'porcentagem', valor: '99.00' },
          repasses: [
            { tipo: 'porcentagem', valor: '1.00', favorecido: { cnpj, conta } },
          ],
        },
      },
    );
  }
  // Pix and Cobranças authenticate on different servers; one SDK instance per
  // API keeps their tokens apart.
  operations(material: EfiAccountMaterial): EfiAccountOperations {
    const client = (): EfiPay =>
      new EfiPay({
        sandbox: material.environment !== 'PRODUCTION',
        client_id: material.clientId,
        client_secret: material.clientSecret,
        certificate: material.certificateBase64,
        cert_base64: true,
        cache: false,
      });
    let pix: EfiPay | undefined;
    let charges: EfiPay | undefined;
    const pixClient = (): EfiPay => (pix ??= client());
    const chargesClient = (): EfiPay => (charges ??= client());
    return {
      listRecentDueCharges: async (): Promise<void> => {
        const fim = new Date().toISOString();
        const inicio = new Date(Date.now() - 3600_000).toISOString();
        await pixClient().pixListDueCharges({ inicio, fim });
      },
      configurePixWebhook: async (pixKey: string): Promise<void> => {
        await pixClient().pixConfigWebhook(
          { chave: pixKey },
          { webhookUrl: this.pixWebhookTarget() },
        );
      },
      pixWebhookUrl: async (pixKey: string): Promise<string | undefined> =>
        (await pixClient().pixDetailWebhook({ chave: pixKey })).webhookUrl,
      upsertValidationSplit: async (id: string): Promise<void> => {
        const cnpj = this.config.get<string>('EFI_PLATFORM_CNPJ');
        const conta = this.config.get<string>('EFI_PLATFORM_ACCOUNT_NUMBER');
        if (!cnpj || !conta) throw new Error('EFI_PLATFORM_ACCOUNT_INVALID');
        await pixClient().pixSplitConfigId(
          { id },
          {
            descricao: 'Validação CifraMais',
            lancamento: { imediato: true },
            split: {
              divisaoTarifa: 'assumir_total',
              minhaParte: { tipo: 'porcentagem', valor: '99.00' },
              repasses: [
                {
                  tipo: 'porcentagem',
                  valor: '1.00',
                  favorecido: { cnpj, conta },
                },
              ],
            },
          },
        );
      },
      listChargePlans: async (): Promise<void> => {
        await chargesClient().listPlans({ limit: 1 });
      },
    };
  }
  pixWebhookTarget(): string {
    return `${this.webhookBase()}/webhooks/efi/pix?ignorar=`;
  }
  async removeWebhook(account: GatewayAccount): Promise<void> {
    await this.sdk(account).pixDeleteWebhook({ chave: account.pixKey });
  }
  private sdk(account: GatewayAccount): EfiPay {
    if (
      !account.encryptedCertificate ||
      !account.encryptedClientId ||
      !account.encryptedClientSecret
    )
      throw new Error('EFI_CREDENTIALS_MISSING');
    return new EfiPay({
      sandbox: account.environment !== 'production',
      client_id: this.crypto.decrypt(account.encryptedClientId),
      client_secret: this.crypto.decrypt(account.encryptedClientSecret),
      certificate: this.crypto.decrypt(account.encryptedCertificate),
      cert_base64: true,
      cache: false,
    });
  }
  private webhookBase(): string {
    const url = new URL(this.config.get<string>('EFI_WEBHOOK_BASE_URL') ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('EFI_WEBHOOK_URL_INVALID');
    return url.origin;
  }
}
