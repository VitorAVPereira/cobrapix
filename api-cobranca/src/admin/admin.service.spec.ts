import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { EfiService } from '../payment/efi.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';

const baseCompanyRecord = {
  id: 'company-1',
  corporateName: 'Empresa Certificada',
  document: '12345678000190',
  email: 'financeiro@empresa.com',
  phoneNumber: '11999999999',
  gatewayProvider: 'EFI',
  gatewayStatus: 'PENDING',
  legalRepresentative: 'Responsavel Legal',
  legalRepresentativeCpf: '12345678900',
  legalRepresentativeBirthDate: new Date('1990-01-01T00:00:00.000Z'),
  addressPostalCode: '01001000',
  addressStreet: 'Rua Original',
  addressNumber: '123',
  addressDistrict: 'Centro',
  addressCity: 'Sao Paulo',
  addressState: 'SP',
  bankName: 'Banco Original',
  bankAgency: '0001',
  bankAccount: '12345',
  maxDiscountsPerDebtor: 1,
  discountTriggerDay: 15,
  collectionReminderDays: [0],
  autoGenerateFirstCharge: true,
  autoDiscountEnabled: false,
  autoDiscountDaysAfterDue: null,
  autoDiscountPercentage: null,
  preferredBillingMethod: 'PIX',
  businessSegment: 'GENERAL',
  paymentNotificationEnabled: true,
  paymentNotificationEmails: [],
  whatsappProvider: 'META_CLOUD',
  whatsappInstanceId: 'phone-original',
  whatsappStatus: 'PENDING',
  metaPhoneNumberId: 'phone-original',
  metaBusinessAccountId: 'business-original',
  metaBusinessPhoneNumber: '5511999999999',
  metaAccessTokenEncrypted: 'encrypted-meta',
  metaDefaultLanguage: 'pt_BR',
  messagingLimitTier: 'TIER_50',
  messagingLimitUpdatedAt: new Date('2026-05-01T12:00:00.000Z'),
  resendApiKeyEncrypted: 'encrypted-resend',
  resendFromEmail: 'cobranca@empresa.com',
  erpApiKeyHash: 'hashed-erp',
  erpWebhookUrl: 'https://erp.original/webhook',
  erpEnabledEvents: ['invoice.created'],
  status: 'ACTIVE',
  enabledBillingMethods: ['PIX'],
  onTimeSplitPercentageBps: 350,
  overdueSplitPercentageBps: 1200,
  createdAt: new Date('2026-05-01T12:00:00.000Z'),
  updatedAt: new Date('2026-05-01T12:00:00.000Z'),
  users: [
    {
      id: 'user-1',
      email: 'admin@empresa.com',
      name: 'Admin Empresa',
      role: UserRole.COMPANY_ADMIN,
    },
  ],
  paymentGateway: {
    id: 'gateway-1',
    provider: 'EFI',
    environment: 'homologation',
    status: 'PENDING',
    payeeCode: 'payee-original',
    efiAccountNumber: '12345',
    efiAccountDigit: '6',
    pixKey: 'pix@empresa.com',
    certificatePath: null,
    encryptedClientId: 'encrypted-client-id',
    encryptedClientSecret: 'encrypted-client-secret',
    encryptedCertificate: 'encrypted-certificate',
    encryptedCertificatePassword: 'encrypted-certificate-password',
    lastError: null,
  },
};

describe('AdminService', () => {
  it('cria cliente com primeiro usuario, metodos, taxas e credenciais sem retornar segredos', async () => {
    const companyCreate = jest.fn().mockResolvedValue({
      id: 'company-1',
      corporateName: 'Cliente Teste',
      document: '11222333000181',
      email: 'financeiro@cliente.com',
      phoneNumber: '11999999999',
      status: 'ACTIVE',
      enabledBillingMethods: ['PIX', 'BOLETO'],
      onTimeSplitPercentageBps: 350,
      overdueSplitPercentageBps: 1200,
      gatewayStatus: 'ACTIVE',
      whatsappStatus: 'CONNECTED',
      createdAt: new Date('2026-05-01T12:00:00.000Z'),
      updatedAt: new Date('2026-05-01T12:00:00.000Z'),
      users: [
        {
          id: 'user-1',
          email: 'admin@cliente.com',
          name: 'Admin Cliente',
          role: UserRole.COMPANY_ADMIN,
        },
      ],
      paymentGateway: {
        id: 'gateway-1',
        status: 'ACTIVE',
        environment: 'homologation',
      },
    });
    const prisma = {
      company: {
        create: companyCreate,
      },
    } as unknown as PrismaService;
    const configureMetaIntegration = jest.fn().mockResolvedValue(undefined);
    const upsertManualGatewayAccount = jest.fn().mockResolvedValue(undefined);
    const service = new AdminService(
      prisma,
      { configureMetaIntegration } as unknown as WhatsappService,
      { upsertManualGatewayAccount } as unknown as EfiService,
      { encrypt: jest.fn(), decrypt: jest.fn() } as unknown as PaymentCryptoService,
    );

    const result = await service.createClient({
      company: {
        corporateName: 'Cliente Teste',
        document: '11.222.333/0001-81',
        email: 'financeiro@cliente.com',
        phoneNumber: '(11) 99999-9999',
        status: 'ACTIVE',
      },
      firstUser: {
        name: 'Admin Cliente',
        email: 'admin@cliente.com',
        password: 'senha-temporaria',
      },
      billing: {
        enabledBillingMethods: ['PIX', 'BOLETO'],
        preferredBillingMethod: 'PIX',
        onTimeSplitPercentageBps: 350,
        overdueSplitPercentageBps: 1200,
      },
      meta: {
        phoneNumberId: '123',
        businessAccountId: '456',
        accessToken: 'meta-secret',
        defaultLanguage: 'pt_BR',
      },
      efi: {
        corporateName: 'Cliente Teste',
        cnpj: '11222333000181',
        email: 'financeiro@cliente.com',
        phoneNumber: '11999999999',
        legalRepresentative: 'Pessoa Responsavel',
        legalRepresentativeCpf: '12345678901',
        legalRepresentativeBirthDate: '1990-01-01',
        postalCode: '01001000',
        street: 'Rua Teste',
        number: '100',
        district: 'Centro',
        city: 'Sao Paulo',
        state: 'SP',
        bankName: 'Banco Teste',
        bankAgency: '0001',
        bankAccount: '12345',
        environment: 'homologation',
        efiClientId: 'efi-client',
        efiClientSecret: 'efi-secret',
        efiPayeeCode: 'payee-1',
        efiAccountNumber: '12345',
        efiPixKey: 'pix-key',
      },
    });

    expect(companyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          document: '11222333000181',
          enabledBillingMethods: ['PIX', 'BOLETO'],
          onTimeSplitPercentageBps: 350,
          overdueSplitPercentageBps: 1200,
          users: {
            create: expect.objectContaining({
              password: expect.stringMatching(/^\$2/) as string,
              role: UserRole.COMPANY_ADMIN,
            }) as unknown,
          },
        }) as unknown,
      }),
    );
    expect(configureMetaIntegration).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ accessToken: 'meta-secret' }),
    );
    expect(upsertManualGatewayAccount).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ efiClientSecret: 'efi-secret' }),
    );
    expect(JSON.stringify(result)).not.toContain('meta-secret');
    expect(JSON.stringify(result)).not.toContain('efi-secret');
  });

  it('edita configuracoes completas do cliente e nao retorna segredos novos', async () => {
    const companyFindUnique = jest
      .fn()
      .mockResolvedValueOnce(baseCompanyRecord)
      .mockResolvedValueOnce({
        ...baseCompanyRecord,
        corporateName: 'Empresa Editada',
        gatewayStatus: 'ACTIVE',
        paymentNotificationEmails: ['financeiro@editada.com'],
        resendFromEmail: 'cobranca@editada.com',
      });
    const companyUpdate = jest.fn().mockResolvedValue(undefined);
    const gatewayAccountUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      company: {
        findUnique: companyFindUnique,
        update: companyUpdate,
      },
      gatewayAccount: {
        update: gatewayAccountUpdate,
      },
    } as unknown as PrismaService;
    const encrypt = jest
      .fn()
      .mockImplementation((value: string) => `encrypted:${value}`);
    const service = new AdminService(
      prisma,
      { configureMetaIntegration: jest.fn() } as unknown as WhatsappService,
      { upsertManualGatewayAccount: jest.fn() } as unknown as EfiService,
      { encrypt, decrypt: jest.fn() } as unknown as PaymentCryptoService,
    );

    const result = await service.updateClient('company-1', {
      company: {
        corporateName: 'Empresa Editada',
        document: '12.345.678/0001-90',
        email: 'financeiro@editada.com',
        phoneNumber: '(11) 98888-7777',
        gatewayStatus: 'ACTIVE',
        legalRepresentative: 'Nova Pessoa',
        legalRepresentativeCpf: '123.456.789-00',
        legalRepresentativeBirthDate: '1991-02-03',
        addressPostalCode: '01002-000',
        addressStreet: 'Rua Editada',
        addressNumber: '456',
        addressDistrict: 'Bairro Editado',
        addressCity: 'Campinas',
        addressState: 'SP',
        bankName: 'Banco Editado',
        bankAgency: '0002',
        bankAccount: '98765',
        status: 'ACTIVE',
      },
      billing: {
        enabledBillingMethods: ['PIX', 'BOLETO'],
        preferredBillingMethod: 'BOLETO',
        onTimeSplitPercentageBps: 250,
        overdueSplitPercentageBps: 900,
        maxDiscountsPerDebtor: 2,
        discountTriggerDay: 10,
        collectionReminderDays: [0, 3, 7],
        autoGenerateFirstCharge: false,
        autoDiscountEnabled: true,
        autoDiscountDaysAfterDue: 5,
        autoDiscountPercentage: 7.5,
      },
      notifications: {
        businessSegment: 'EDUCATION',
        paymentNotificationEnabled: true,
        paymentNotificationEmails: ['financeiro@editada.com'],
      },
      whatsapp: {
        whatsappStatus: 'CONNECTED',
        metaPhoneNumberId: 'phone-edited',
        metaBusinessAccountId: 'business-edited',
        metaBusinessPhoneNumber: '551188887777',
        metaDefaultLanguage: 'pt_BR',
        messagingLimitTier: 'TIER_250',
        metaAccessToken: 'new-meta-secret-token-with-more-than-forty-chars',
      },
      integrations: {
        resendFromEmail: 'cobranca@editada.com',
        resendApiKey: 'new-resend-secret',
        erpWebhookUrl: 'https://erp.editada/webhook',
        erpEnabledEvents: ['invoice.paid'],
        erpApiKey: 'new-erp-secret',
      },
      efi: {
        environment: 'production',
        status: 'ACTIVE',
        efiPayeeCode: 'payee-editado',
        efiAccountNumber: '98765',
        efiAccountDigit: '0',
        efiPixKey: 'pix-editado@empresa.com',
        efiClientId: 'new-efi-client',
        efiClientSecret: 'new-efi-secret',
        efiCertificateBase64: 'bmV3LWNlcnQ=',
        efiCertificatePassword: 'new-cert-password',
      },
    });

    expect(companyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-1' },
        data: expect.objectContaining({
          corporateName: 'Empresa Editada',
          document: '12345678000190',
          gatewayStatus: 'ACTIVE',
          legalRepresentativeCpf: '12345678900',
          addressPostalCode: '01002000',
          paymentNotificationEmails: ['financeiro@editada.com'],
          resendFromEmail: 'cobranca@editada.com',
          resendApiKeyEncrypted: 'encrypted:new-resend-secret',
          erpApiKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
        }) as unknown,
      }),
    );
    expect(gatewayAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1' },
        data: expect.objectContaining({
          environment: 'production',
          status: 'ACTIVE',
          payeeCode: 'payee-editado',
          encryptedClientSecret: 'encrypted:new-efi-secret',
          encryptedCertificate: 'encrypted:bmV3LWNlcnQ=',
          encryptedCertificatePassword: 'encrypted:new-cert-password',
        }) as unknown,
      }),
    );
    expect(result.hasMetaAccessToken).toBe(true);
    expect(result.hasResendApiKey).toBe(true);
    expect(result.hasErpApiKey).toBe(true);
    expect(result.hasEfiClientSecret).toBe(true);
    expect(JSON.stringify(result)).not.toContain('new-efi-secret');
    expect(JSON.stringify(result)).not.toContain('new-meta-secret-token');
    expect(JSON.stringify(result)).not.toContain('new-resend-secret');
  });

  it('mantem segredos existentes quando a edicao nao envia novos valores sensiveis', async () => {
    const companyFindUnique = jest
      .fn()
      .mockResolvedValueOnce(baseCompanyRecord)
      .mockResolvedValueOnce(baseCompanyRecord);
    const companyUpdate = jest.fn().mockResolvedValue(undefined);
    const gatewayAccountUpdate = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      company: {
        findUnique: companyFindUnique,
        update: companyUpdate,
      },
      gatewayAccount: {
        update: gatewayAccountUpdate,
      },
    } as unknown as PrismaService;
    const encrypt = jest.fn();
    const service = new AdminService(
      prisma,
      { configureMetaIntegration: jest.fn() } as unknown as WhatsappService,
      { upsertManualGatewayAccount: jest.fn() } as unknown as EfiService,
      { encrypt, decrypt: jest.fn() } as unknown as PaymentCryptoService,
    );

    const result = await service.updateClient('company-1', {
      efi: {
        status: 'ACTIVE',
        efiPayeeCode: 'payee-sem-segredo',
      },
    });

    expect(gatewayAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          encryptedClientId: expect.any(String) as string,
          encryptedClientSecret: expect.any(String) as string,
          encryptedCertificate: expect.any(String) as string,
          encryptedCertificatePassword: expect.any(String) as string,
        }) as unknown,
      }),
    );
    expect(encrypt).not.toHaveBeenCalled();
    expect(result.hasEfiClientId).toBe(true);
    expect(result.hasEfiClientSecret).toBe(true);
    expect(result.hasEfiCertificate).toBe(true);
  });
});
