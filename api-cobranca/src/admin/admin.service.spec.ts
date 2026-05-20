import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { EfiService } from '../payment/efi.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

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
});
