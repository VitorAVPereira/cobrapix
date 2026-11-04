import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiGatewayClient } from '../payment/efi-gateway.client';
import { EfiAccountRegistryService } from '../financial-activation/efi-account-registry.service';
import { inspectEfiCertificate } from '../payment/efi-certificate';
import { CheckoutPlatformService } from './checkout-platform.service';

jest.mock('../payment/efi-certificate', () => ({
  inspectEfiCertificate: jest.fn(),
}));

const TARGET = 'https://api.test/webhooks/efi/pix?ignorar=';

describe('CheckoutPlatformService', () => {
  const tx = {
    efiCredentialVersion: { updateMany: jest.fn(), update: jest.fn() },
    efiAccountIdentity: { update: jest.fn() },
    checkoutPlatformSettings: { findFirst: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    checkoutPlatformSettings: { findFirst: jest.fn(), findMany: jest.fn() },
    efiAccountIdentity: { findFirst: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const operations = {
    listRecentDueCharges: jest.fn(),
    pixWebhookUrl: jest.fn(),
    configurePixWebhook: jest.fn(),
  };
  const gateway = {
    operations: jest.fn(() => operations),
    pixWebhookTarget: () => TARGET,
  };
  const registry = { registerPlatformCredential: jest.fn() };
  const env: Record<string, string> = {
    EFI_PLATFORM_ACCOUNT_NUMBER: '123456',
    EFI_PLATFORM_CNPJ: '11.222.333/0001-81',
  };
  const service = new CheckoutPlatformService(
    prisma as unknown as PrismaService,
    { get: (key: string) => env[key] } as unknown as ConfigService,
    {
      decrypt: (value: string) => `plain-${value}`,
    } as unknown as PaymentCryptoService,
    gateway as unknown as EfiGatewayClient,
    registry as unknown as EfiAccountRegistryService,
  );
  const upload = {
    environment: 'PRODUCTION' as const,
    clientId: 'client',
    clientSecret: 'secret',
    holderDocument: '11222333000181',
    efiAccountNumber: '123456',
    payeeCode: 'abc123',
    pixKey: 'pix@ciframais.test',
  };
  const file = () => ({ buffer: Buffer.from('p12'), size: 3 });
  const identity = {
    id: 'identity-1',
    environment: 'PRODUCTION',
    pixKey: 'pix@ciframais.test',
    credentialVersions: [
      {
        id: 'credential-2',
        version: 2,
        status: 'CANDIDATE',
        encryptedClientId: 'id',
        encryptedClientSecret: 'secret',
        encryptedCertificate: 'cert',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (inspectEfiCertificate as jest.Mock).mockReturnValue({
      base64: 'cDEy',
      fingerprint: 'fp',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    registry.registerPlatformCredential.mockResolvedValue({
      identity: { id: 'identity-1' },
      credential: { id: 'credential-2', version: 2 },
    });
    prisma.efiAccountIdentity.findFirst.mockResolvedValue(identity);
    prisma.checkoutPlatformSettings.findMany.mockResolvedValue([]);
    prisma.checkoutPlatformSettings.findFirst.mockResolvedValue(null);
    tx.checkoutPlatformSettings.findFirst.mockResolvedValue({
      version: 3,
      identityId: 'identity-1',
      pixFeeBasisPoints: 119,
      webhookConfiguredAt: new Date(),
    });
  });

  it('grava a credencial da conta Cifra+ sem devolver segredo', async () => {
    const result = await service.uploadCredentials(
      'admin',
      'platform',
      upload,
      file(),
    );

    expect(result).toEqual({ credentialId: 'credential-2', version: 2 });
    expect(registry.registerPlatformCredential).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        efiAccountNumber: '123456',
        pixKey: 'pix@ciframais.test',
      }),
    );
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(
      'secret',
    );
  });

  it('em produção recusa conta ou CNPJ diferentes dos da Cifra+', async () => {
    await expect(
      service.uploadCredentials(
        'admin',
        'platform',
        { ...upload, efiAccountNumber: '999' },
        file(),
      ),
    ).rejects.toMatchObject({
      response: { code: 'PLATFORM_ACCOUNT_MISMATCH' },
    });
    expect(registry.registerPlatformCredential).not.toHaveBeenCalled();
  });

  it('certificado inválido responde 422 e apaga o arquivo da memória', async () => {
    (inspectEfiCertificate as jest.Mock).mockImplementation(() => {
      throw new Error('bad');
    });
    const sent = file();
    await expect(
      service.uploadCredentials('admin', 'platform', upload, sent),
    ).rejects.toMatchObject({ response: { code: 'CERTIFICATE_INVALID' } });
    expect(sent.buffer.every((byte) => byte === 0)).toBe(true);
  });

  it('não troca o webhook de outro endereço sem confirmação', async () => {
    operations.pixWebhookUrl.mockResolvedValue('https://outro.test/pix');

    await expect(
      service.validate('admin', 'platform', {}),
    ).rejects.toMatchObject({
      response: {
        code: 'PIX_WEBHOOK_IN_USE',
        currentUrl: 'https://outro.test/pix',
      },
    });
    expect(operations.configurePixWebhook).not.toHaveBeenCalled();
    expect(tx.efiCredentialVersion.update).not.toHaveBeenCalled();
  });

  it('com confirmação liga o webhook, ativa a credencial e mantém a tarifa', async () => {
    operations.pixWebhookUrl
      .mockResolvedValueOnce('https://outro.test/pix')
      .mockResolvedValueOnce(TARGET);

    await service.validate('admin', 'platform', { confirmOverwrite: true });

    expect(operations.configurePixWebhook).toHaveBeenCalledWith(
      'pix@ciframais.test',
    );
    expect(tx.efiCredentialVersion.updateMany).toHaveBeenCalledWith({
      where: {
        identityId: 'identity-1',
        status: 'ACTIVE',
        id: { not: 'credential-2' },
      },
      data: { status: 'RETIRED', retiredAt: expect.any(Date) as Date },
    });
    expect(tx.efiCredentialVersion.update).toHaveBeenCalledWith({
      where: { id: 'credential-2' },
      data: { status: 'ACTIVE', activatedAt: expect.any(Date) as Date },
    });
    expect(tx.checkoutPlatformSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 4,
        pixFeeBasisPoints: 119,
      }) as unknown,
    });
  });

  it('webhook já apontando para a Cifra+ não é reconfigurado', async () => {
    operations.pixWebhookUrl.mockResolvedValue(TARGET);
    await service.validate('admin', 'platform', {});
    expect(operations.configurePixWebhook).not.toHaveBeenCalled();
  });

  it('Efí recusando a autenticação não ativa nada', async () => {
    operations.listRecentDueCharges.mockRejectedValueOnce({
      nome: 'invalid_client',
      status: 401,
    });
    await expect(
      service.validate('admin', 'platform', {}),
    ).rejects.toMatchObject({
      response: { code: 'EFI_REJECTED_INVALID_CLIENT' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('tarifa com versão antiga responde VERSION_CHANGED', async () => {
    await expect(
      service.setPixFee('admin', 'platform', {
        expectedVersion: 2,
        pixFeeBasisPoints: 119,
      }),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });
    expect(tx.checkoutPlatformSettings.create).not.toHaveBeenCalled();
  });

  it('sem tarifa a conta não está pronta para vender', async () => {
    prisma.checkoutPlatformSettings.findFirst.mockResolvedValue({
      identityId: 'identity-1',
      pixFeeBasisPoints: null,
      webhookConfiguredAt: new Date(),
    });
    await expect(service.ready()).resolves.toBeNull();
  });
});
