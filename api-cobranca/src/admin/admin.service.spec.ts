import { PaymentFeeService } from '../payment-fees/payment-fee.service';
import { HttpStatus } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { EfiService } from '../payment/efi.service';
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
  resendWebhookSecretEncrypted: 'encrypted-resend-webhook',
  resendFromEmail: 'cobranca@empresa.com',
  erpApiKeyHash: 'hashed-erp',
  erpWebhookUrl: 'https://erp.original/webhook',
  erpEnabledEvents: ['invoice.created'],
  status: 'ACTIVE',
  enabledBillingMethods: ['PIX'],
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

describe('AdminService financial onboarding', () => {
  function fixture(existingUser = false) {
    const prisma = {
      company: {
        create: jest.fn().mockResolvedValue(baseCompanyRecord),
        findUnique: jest.fn().mockResolvedValue(baseCompanyRecord),
        update: jest.fn(),
      },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue(existingUser ? { id: 'user-1' } : null),
      },
      gatewayAccount: { update: jest.fn() },
      efiAccountIdentity: { count: jest.fn().mockResolvedValue(0) },
    };
    const fees = {
      resolveActiveVersion: jest.fn().mockResolvedValue({ id: 'fee-1' }),
    };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      {} as EfiService,
      {} as PaymentCryptoService,
      fees as unknown as PaymentFeeService,
    );
    return { service, prisma, fees };
  }
  const input = {
    company: {
      corporateName: 'Cliente Teste',
      document: '11.222.333/0001-81',
      email: 'financeiro@cliente.com',
      phoneNumber: '11999999999',
    },
    firstUser: { name: 'Admin', email: '  ADMIN@CLIENTE.COM ' },
    billing: {
      enabledBillingMethods: ['PIX' as const],
      preferredBillingMethod: 'PIX' as const,
    },
  };
  it('creates a company with temporary password and validates the tariff before enabling a method', async () => {
    const { service, prisma, fees } = fixture();
    const result = await service.createClient(input);
    expect(fees.resolveActiveVersion).toHaveBeenCalledWith('', 'PIX');
    expect(prisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          document: '11222333000181',
          users: {
            create: expect.objectContaining({
              email: 'admin@cliente.com',
              mustChangePassword: true,
            }) as unknown,
          },
        }) as unknown,
      }),
    );
    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(JSON.stringify(result.client)).not.toContain(
      'encrypted-client-secret',
    );
  });
  it('rejects a case-insensitive duplicate login', async () => {
    const { service, prisma } = fixture(true);
    await expect(service.createClient(input)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(prisma.company.create).not.toHaveBeenCalled();
  });
  it('rejects enabling methods without current fees', async () => {
    const { service, prisma, fees } = fixture();
    fees.resolveActiveVersion.mockRejectedValueOnce(
      new Error('FEE_CONFIGURATION_MISSING'),
    );
    await expect(service.createClient(input)).rejects.toThrow(
      'FEE_CONFIGURATION_MISSING',
    );
    expect(prisma.company.create).not.toHaveBeenCalled();
  });
  it.each([
    { efi: { status: 'ACTIVE' } },
    { company: { gatewayStatus: 'ACTIVE' } },
    { whatsapp: { metaAccessToken: 'secret' } },
    { integrations: { resendApiKey: 'secret' } },
  ])(
    'rejects obsolete gateway/secret/tariff updates before writing',
    async (dto) => {
      const { service, prisma } = fixture();
      await expect(
        service.updateClient('company-1', dto),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.company.update).not.toHaveBeenCalled();
      expect(prisma.gatewayAccount.update).not.toHaveBeenCalled();
    },
  );
  it('updates business settings without touching financial credentials', async () => {
    const { service, prisma } = fixture();
    const result = await service.updateClient('company-1', {
      company: { corporateName: 'Empresa Atualizada' },
    });
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { corporateName: 'Empresa Atualizada' },
    });
    expect(prisma.gatewayAccount.update).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('encrypted-client-secret');
  });
  it.each([
    [
      'an active financial profile',
      { activeFinancialProfileId: 'profile-1' },
      0,
    ],
    ['registered Efí credentials', { activeFinancialProfileId: null }, 1],
  ])(
    'locks the company document with %s',
    async (_label, company, identities) => {
      const { service, prisma } = fixture();
      prisma.company.findUnique
        .mockResolvedValueOnce(baseCompanyRecord)
        .mockResolvedValueOnce(company);
      prisma.efiAccountIdentity.count.mockResolvedValue(identities);
      await expect(
        service.updateClient('company-1', {
          company: { document: '98.765.432/0001-00' },
        }),
      ).rejects.toMatchObject({
        response: { code: 'COMPANY_DOCUMENT_LOCKED' },
      });
      expect(prisma.company.update).not.toHaveBeenCalled();
    },
  );
});

describe('Admin password reset', () => {
  it('reset administrativo gera senha temporária e revoga sessões anteriores', async () => {
    const userFindFirst = jest.fn().mockResolvedValue({ id: 'user-1' });
    const userUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const passwordResetDeleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const transactionClient = {
      user: { updateMany: userUpdateMany },
      passwordResetToken: { deleteMany: passwordResetDeleteMany },
    };
    const prisma = {
      user: {
        findFirst: userFindFirst,
      },
      $transaction: jest.fn(
        async (callback: (client: typeof transactionClient) => Promise<void>) =>
          callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      { upsertManualGatewayAccount: jest.fn() } as unknown as EfiService,
      {
        encrypt: jest.fn(),
        decrypt: jest.fn(),
      } as unknown as PaymentCryptoService,
    );

    const result = await service.resetPassword('company-1');

    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', companyId: 'company-1' },
      data: {
        password: expect.stringMatching(/^\$2/) as string,
        mustChangePassword: true,
        tokenVersion: { increment: 1 },
      },
    });
    expect(passwordResetDeleteMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', userId: 'user-1' },
    });
  });
});
