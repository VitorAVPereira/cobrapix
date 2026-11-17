import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { EfiGatewayClient } from '../payment/efi-gateway.client';
import { EfiAccountRegistryService } from '../financial-activation/efi-account-registry.service';
import { inspectEfiCertificate } from '../payment/efi-certificate';
import {
  accountOwner,
  CheckoutPlatformService,
} from './checkout-platform.service';

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
    efiAccountIdentity: { findFirst: jest.fn(), findUnique: jest.fn() },
    company: { findFirst: jest.fn() },
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
  const registry = {
    registerPlatformCredential: jest.fn(),
    registerCompanyCredential: jest.fn(),
  };
  // A checkout client that sells through its own account, with the signed term.
  const seller = (terms: object | null = {}) => ({
    checkoutSellerTerms: terms
      ? [
          {
            accountMode: 'SELLER_ACCOUNT',
            authorizationReference: 'Termo de 16/11',
            ...terms,
          },
        ]
      : [],
  });
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
  const sellerUpload = () => ({
    ...upload,
    holderDocument: '45723174000110',
    efiAccountNumber: '777',
  });
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
    registry.registerCompanyCredential.mockResolvedValue({
      identity: { id: 'identity-seller' },
      credential: { id: 'credential-1', version: 1 },
    });
    prisma.company.findFirst.mockResolvedValue(seller());
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

  it('conta do vendedor: grava a credencial na empresa dele, com auditoria e sem segredo', async () => {
    // The holder's CNPJ is not compared with the client's registration.
    const result = await service.uploadCredentials(
      'admin',
      'company-a',
      { ...sellerUpload(), holderDocument: '11222333000181' },
      file(),
      'company-a',
    );

    expect(result).toEqual({ credentialId: 'credential-1', version: 1 });
    expect(registry.registerCompanyCredential).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        companyId: 'company-a',
        efiAccountNumber: '777',
        holderDocument: '11222333000181',
      }),
    );
    expect(registry.registerPlatformCredential).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        action: 'CHECKOUT_SELLER_CREDENTIAL_UPLOADED',
      }) as unknown,
    });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(
      'secret',
    );
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-a', product: 'CHECKOUT' },
      }),
    );
  });

  it('conta do vendedor: só para cliente de checkout, na conta própria e com o termo assinado', async () => {
    const send = (dto = sellerUpload()) =>
      service.uploadCredentials('admin', 'company-a', dto, file(), 'company-a');

    prisma.company.findFirst.mockResolvedValue(null);
    await expect(send()).rejects.toMatchObject({ status: 404 });

    prisma.company.findFirst.mockResolvedValue(
      seller({ accountMode: 'PLATFORM_ACCOUNT' }),
    );
    await expect(send()).rejects.toMatchObject({
      response: { code: 'CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED' },
    });

    prisma.company.findFirst.mockResolvedValue(
      seller({ authorizationReference: null }),
    );
    await expect(send()).rejects.toMatchObject({
      response: { code: 'CHECKOUT_AUTHORIZATION_REQUIRED' },
    });

    expect(registry.registerCompanyCredential).not.toHaveBeenCalled();

    // The same guard stands before the Efí is called or a tariff is saved.
    prisma.company.findFirst.mockResolvedValue(
      seller({ authorizationReference: null }),
    );
    await expect(
      service.validate('admin', 'company-a', {}, 'company-a'),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_AUTHORIZATION_REQUIRED' },
    });
    await expect(
      service.setPixFee(
        'admin',
        'company-a',
        { expectedVersion: 1, pixFeeBasisPoints: 119 },
        'company-a',
      ),
    ).rejects.toMatchObject({
      response: { code: 'CHECKOUT_AUTHORIZATION_REQUIRED' },
    });
    expect(gateway.operations).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('conta do vendedor: a validação grava a configuração dele, com versão própria', async () => {
    operations.pixWebhookUrl.mockResolvedValue(TARGET);
    tx.checkoutPlatformSettings.findFirst.mockResolvedValue(null);

    await service.validate('admin', 'company-a', {}, 'company-a');

    expect(prisma.efiAccountIdentity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownership: 'COMPANY', companyId: 'company-a' },
      }),
    );
    expect(tx.checkoutPlatformSettings.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'company-a' },
      orderBy: { version: 'desc' },
    });
    expect(tx.checkoutPlatformSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        version: 1,
        identityId: 'identity-1',
        cardEnabled: false,
      }) as unknown,
    });
  });

  it('trocar de conta desliga o cartão: a liberação da Efí é por conta', async () => {
    operations.pixWebhookUrl.mockResolvedValue(TARGET);
    const rates = {
      receipt: 'ANTICIPATED',
      cashBasisPoints: 349,
      anticipationBasisPoints: 159,
    };
    const previous = {
      version: 3,
      pixFeeBasisPoints: 119,
      cardEnabled: true,
      cardRates: rates,
      cardCreditDays: 30,
    };
    tx.checkoutPlatformSettings.findFirst.mockResolvedValue({
      ...previous,
      identityId: 'identity-homologacao',
    });
    await service.validate('admin', 'company-a', {}, 'company-a');
    expect(tx.checkoutPlatformSettings.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        version: 4,
        cardEnabled: false,
        cardRates: rates,
        cardCreditDays: 30,
      }) as unknown,
    });

    // Same account (a credential rotation): the card stays as it was.
    tx.checkoutPlatformSettings.findFirst.mockResolvedValue({
      ...previous,
      identityId: 'identity-1',
    });
    await service.validate('admin', 'company-a', {}, 'company-a');
    expect(tx.checkoutPlatformSettings.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ cardEnabled: true }) as unknown,
    });
  });

  it('conta do vendedor: tarifa do Pix na versão dele', async () => {
    tx.checkoutPlatformSettings.findFirst.mockResolvedValue({
      version: 1,
      identityId: 'identity-1',
      pixFeeBasisPoints: null,
      webhookConfiguredAt: new Date(),
    });
    await service.setPixFee(
      'admin',
      'company-a',
      { expectedVersion: 1, pixFeeBasisPoints: 119 },
      'company-a',
    );
    expect(tx.checkoutPlatformSettings.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'company-a' },
      orderBy: { version: 'desc' },
    });
    expect(tx.checkoutPlatformSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        version: 2,
        pixFeeBasisPoints: 119,
      }) as unknown,
    });
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

  it('conta Cifra+ e conta do vendedor não se misturam', async () => {
    prisma.checkoutPlatformSettings.findFirst.mockResolvedValue({
      identityId: 'identity-1',
      pixFeeBasisPoints: 119,
      webhookConfiguredAt: new Date(),
    });
    prisma.efiAccountIdentity.findFirst.mockResolvedValue({
      ...identity,
      credentialVersions: [{ id: 'credential-1', status: 'ACTIVE' }],
    });

    await service.ready();
    expect(prisma.checkoutPlatformSettings.findFirst).toHaveBeenLastCalledWith({
      where: { companyId: null },
      orderBy: { version: 'desc' },
    });
    expect(prisma.efiAccountIdentity.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'identity-1', ownership: 'PLATFORM' },
      }),
    );

    await service.ready('company-a');
    expect(prisma.checkoutPlatformSettings.findFirst).toHaveBeenLastCalledWith({
      where: { companyId: 'company-a' },
      orderBy: { version: 'desc' },
    });
    // The settings of a seller only work with an account of that seller.
    expect(prisma.efiAccountIdentity.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: 'identity-1',
          ownership: 'COMPANY',
          companyId: 'company-a',
        },
      }),
    );
  });

  it('o modo dos termos diz de quem é a conta', () => {
    expect(accountOwner(null)).toBeNull();
    expect(
      accountOwner({ accountMode: 'PLATFORM_ACCOUNT', companyId: 'company-a' }),
    ).toBeNull();
    expect(
      accountOwner({ accountMode: 'SELLER_ACCOUNT', companyId: 'company-a' }),
    ).toBe('company-a');
  });

  it('a conta emissora de uma cobrança precisa de credencial ativa', async () => {
    prisma.efiAccountIdentity.findUnique.mockResolvedValue({
      id: 'identity-9',
      credentialVersions: [{ id: 'credential-9' }],
    });
    await expect(service.accountOf('identity-9')).resolves.toMatchObject({
      identity: { id: 'identity-9' },
      credential: { id: 'credential-9' },
    });
    prisma.efiAccountIdentity.findUnique.mockResolvedValue({
      id: 'identity-9',
      credentialVersions: [],
    });
    await expect(service.accountOf('identity-9')).resolves.toBeNull();
  });

  it('cartão: nova versão com tarifa e prazo, mantendo a tarifa do Pix', async () => {
    tx.checkoutPlatformSettings.findFirst.mockResolvedValue({
      version: 3,
      identityId: 'identity-1',
      pixFeeBasisPoints: 119,
      webhookConfiguredAt: new Date(),
    });
    prisma.checkoutPlatformSettings.findMany.mockResolvedValue([]);
    await service.setCard('admin', 'platform', {
      expectedVersion: 3,
      cardEnabled: false,
      cashBasisPoints: 349,
      anticipationBasisPoints: 159,
      cardCreditDays: 30,
    });
    expect(tx.checkoutPlatformSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 4,
        pixFeeBasisPoints: 119,
        cardEnabled: false,
        cardCreditDays: 30,
        cardRates: {
          receipt: 'ANTICIPATED',
          cashBasisPoints: 349,
          anticipationBasisPoints: 159,
        },
      }) as unknown,
    });
  });

  it('ligar o cartão sem a conta pronta ou com tarifa de 100% é recusado', async () => {
    prisma.checkoutPlatformSettings.findFirst.mockResolvedValue(null);
    await expect(
      service.setCard('admin', 'platform', {
        expectedVersion: 3,
        cardEnabled: true,
        cashBasisPoints: 349,
        anticipationBasisPoints: 159,
        cardCreditDays: 30,
      }),
    ).rejects.toMatchObject({ response: { code: 'CARD_ACCOUNT_NOT_READY' } });
    await expect(
      service.setCard('admin', 'platform', {
        expectedVersion: 3,
        cardEnabled: false,
        cashBasisPoints: 2000,
        anticipationBasisPoints: 1000,
        cardCreditDays: 30,
      }),
    ).rejects.toMatchObject({ response: { code: 'CHECKOUT_INVALID' } });
    expect(tx.checkoutPlatformSettings.create).not.toHaveBeenCalled();
  });
});
