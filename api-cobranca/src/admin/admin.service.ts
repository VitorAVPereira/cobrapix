import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  BillingMethod,
  BusinessSegment,
  CompanyStatus,
  MessagingLimitTier,
  Prisma,
  UserRole,
  WhatsappProvider,
  WhatsappStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { EfiService } from '../payment/efi.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  AdminEfiUpdateDto,
  CreateAdminClientDto,
  ResetClientPasswordDto,
  UpdateAdminClientDto,
} from './dto/admin-client.dto';

const adminClientInclude = {
  users: {
    where: { role: UserRole.COMPANY_ADMIN },
    take: 1,
    select: { id: true, email: true, name: true, role: true },
  },
  paymentGateway: {
    select: {
      id: true,
      provider: true,
      environment: true,
      status: true,
      payeeCode: true,
      efiAccountNumber: true,
      efiAccountDigit: true,
      pixKey: true,
      encryptedClientId: true,
      encryptedClientSecret: true,
      encryptedCertificate: true,
      encryptedCertificatePassword: true,
      certificatePath: true,
      lastError: true,
    },
  },
} satisfies Prisma.CompanyInclude;

type AdminClientRecord = Prisma.CompanyGetPayload<{
  include: typeof adminClientInclude;
}>;

export interface AdminClientResponse {
  id: string;
  corporateName: string;
  document: string;
  email: string;
  phoneNumber: string;
  status: string;
  gatewayProvider: string;
  enabledBillingMethods: BillingMethod[];
  preferredBillingMethod: BillingMethod;
  maxDiscountsPerDebtor: number;
  discountTriggerDay: number;
  collectionReminderDays: number[];
  autoGenerateFirstCharge: boolean;
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: number | null;
  autoDiscountPercentage: number | null;
  onTimeSplitPercentageBps: number;
  overdueSplitPercentageBps: number;
  businessSegment: BusinessSegment;
  paymentNotificationEnabled: boolean;
  paymentNotificationEmails: string[];
  gatewayStatus: string;
  legalRepresentative: string | null;
  legalRepresentativeCpf: string | null;
  legalRepresentativeBirthDate: Date | null;
  addressPostalCode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressState: string | null;
  bankName: string | null;
  bankAgency: string | null;
  bankAccount: string | null;
  whatsappProvider: WhatsappProvider;
  whatsappInstanceId: string | null;
  whatsappStatus: string;
  metaPhoneNumberId: string | null;
  metaBusinessAccountId: string | null;
  metaBusinessPhoneNumber: string | null;
  metaDefaultLanguage: string;
  messagingLimitTier: MessagingLimitTier | null;
  messagingLimitUpdatedAt: Date | null;
  resendFromEmail: string | null;
  erpWebhookUrl: string | null;
  erpEnabledEvents: string[];
  hasMetaAccessToken: boolean;
  hasResendApiKey: boolean;
  hasErpApiKey: boolean;
  hasEfiClientId: boolean;
  hasEfiClientSecret: boolean;
  hasEfiCertificate: boolean;
  hasEfiCertificatePassword: boolean;
  firstUser: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
  } | null;
  efi: {
    configured: boolean;
    provider: string | null;
    status: string | null;
    environment: string | null;
    payeeCode: string | null;
    accountNumber: string | null;
    accountDigit: string | null;
    pixKey: string | null;
    certificatePath: string | null;
    lastError: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly efiService: EfiService,
    private readonly crypto: PaymentCryptoService,
  ) {}

  async listClients(): Promise<AdminClientResponse[]> {
    const companies = await this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: adminClientInclude,
    });

    return companies.map((company) => this.toClientResponse(company));
  }

  async getClient(id: string): Promise<AdminClientResponse> {
    const company = await this.findClientOrThrow(id);
    return this.toClientResponse(company);
  }

  async createClient(dto: CreateAdminClientDto): Promise<AdminClientResponse> {
    const passwordHash = await bcrypt.hash(dto.firstUser.password, 10);

    const company = await this.prisma.company.create({
      data: {
        corporateName: dto.company.corporateName,
        document: this.onlyDigits(dto.company.document),
        email: dto.company.email,
        phoneNumber: this.onlyDigits(dto.company.phoneNumber),
        status: dto.company.status ?? 'ACTIVE',
        enabledBillingMethods: dto.billing.enabledBillingMethods,
        preferredBillingMethod: dto.billing.preferredBillingMethod,
        onTimeSplitPercentageBps: dto.billing.onTimeSplitPercentageBps,
        overdueSplitPercentageBps: dto.billing.overdueSplitPercentageBps,
        users: {
          create: {
            email: dto.firstUser.email,
            name: dto.firstUser.name,
            password: passwordHash,
            role: UserRole.COMPANY_ADMIN,
          },
        },
      },
      include: adminClientInclude,
    });

    if (dto.meta) {
      await this.whatsappService.configureMetaIntegration(company.id, dto.meta);
    }

    if (dto.efi) {
      await this.efiService.upsertManualGatewayAccount(company.id, dto.efi);
    }

    return this.toClientResponse(company);
  }

  async updateClient(
    id: string,
    dto: UpdateAdminClientDto,
  ): Promise<AdminClientResponse> {
    const company = await this.findClientOrThrow(id);
    const companyData = this.buildCompanyUpdateData(dto);

    if (Object.keys(companyData).length > 0) {
      await this.prisma.company.update({
        where: { id },
        data: companyData,
      });
    }

    if (dto.meta) {
      await this.whatsappService.configureMetaIntegration(id, dto.meta);
    }

    if (dto.efi) {
      await this.updateEfiGateway(company, dto.efi);
    }

    return this.getClient(id);
  }

  async resetPassword(
    companyId: string,
    dto: ResetClientPasswordDto,
  ): Promise<{ userId: string; temporaryPassword: string }> {
    const user = await this.prisma.user.findFirst({
      where: { companyId, role: UserRole.COMPANY_ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!user) {
      throw new HttpException(
        'Usuario administrador do cliente nao encontrado.',
        HttpStatus.NOT_FOUND,
      );
    }

    const temporaryPassword = dto.password ?? this.generateTemporaryPassword();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(temporaryPassword, 10),
      },
    });

    return { userId: user.id, temporaryPassword };
  }

  private async findClientOrThrow(id: string): Promise<AdminClientRecord> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: adminClientInclude,
    });

    if (!company) {
      throw new HttpException('Cliente nao encontrado.', HttpStatus.NOT_FOUND);
    }

    return company;
  }

  private toClientResponse(company: AdminClientRecord): AdminClientResponse {
    const firstUser = company.users?.[0] ?? null;

    return {
      id: company.id,
      corporateName: company.corporateName,
      document: company.document,
      email: company.email,
      phoneNumber: company.phoneNumber,
      status: company.status,
      gatewayProvider: company.gatewayProvider,
      enabledBillingMethods: company.enabledBillingMethods,
      preferredBillingMethod: company.preferredBillingMethod,
      maxDiscountsPerDebtor: company.maxDiscountsPerDebtor,
      discountTriggerDay: company.discountTriggerDay,
      collectionReminderDays: company.collectionReminderDays,
      autoGenerateFirstCharge: company.autoGenerateFirstCharge,
      autoDiscountEnabled: company.autoDiscountEnabled,
      autoDiscountDaysAfterDue: company.autoDiscountDaysAfterDue,
      autoDiscountPercentage: this.decimalToNumber(
        company.autoDiscountPercentage,
      ),
      onTimeSplitPercentageBps: company.onTimeSplitPercentageBps,
      overdueSplitPercentageBps: company.overdueSplitPercentageBps,
      businessSegment: company.businessSegment,
      paymentNotificationEnabled: company.paymentNotificationEnabled,
      paymentNotificationEmails: company.paymentNotificationEmails,
      gatewayStatus: company.gatewayStatus,
      legalRepresentative: company.legalRepresentative,
      legalRepresentativeCpf: company.legalRepresentativeCpf,
      legalRepresentativeBirthDate: company.legalRepresentativeBirthDate,
      addressPostalCode: company.addressPostalCode,
      addressStreet: company.addressStreet,
      addressNumber: company.addressNumber,
      addressDistrict: company.addressDistrict,
      addressCity: company.addressCity,
      addressState: company.addressState,
      bankName: company.bankName,
      bankAgency: company.bankAgency,
      bankAccount: company.bankAccount,
      whatsappProvider: company.whatsappProvider,
      whatsappInstanceId: company.whatsappInstanceId,
      whatsappStatus: company.whatsappStatus,
      metaPhoneNumberId: company.metaPhoneNumberId,
      metaBusinessAccountId: company.metaBusinessAccountId,
      metaBusinessPhoneNumber: company.metaBusinessPhoneNumber,
      metaDefaultLanguage: company.metaDefaultLanguage,
      messagingLimitTier: company.messagingLimitTier,
      messagingLimitUpdatedAt: company.messagingLimitUpdatedAt,
      resendFromEmail: company.resendFromEmail,
      erpWebhookUrl: company.erpWebhookUrl,
      erpEnabledEvents: company.erpEnabledEvents,
      hasMetaAccessToken: Boolean(company.metaAccessTokenEncrypted),
      hasResendApiKey: Boolean(company.resendApiKeyEncrypted),
      hasErpApiKey: Boolean(company.erpApiKeyHash),
      hasEfiClientId: Boolean(company.paymentGateway?.encryptedClientId),
      hasEfiClientSecret: Boolean(
        company.paymentGateway?.encryptedClientSecret,
      ),
      hasEfiCertificate: Boolean(
        company.paymentGateway?.encryptedCertificate ||
        company.paymentGateway?.certificatePath,
      ),
      hasEfiCertificatePassword: Boolean(
        company.paymentGateway?.encryptedCertificatePassword,
      ),
      firstUser,
      efi: {
        configured: Boolean(company.paymentGateway),
        provider: company.paymentGateway?.provider ?? null,
        status: company.paymentGateway?.status ?? null,
        environment: company.paymentGateway?.environment ?? null,
        payeeCode: company.paymentGateway?.payeeCode ?? null,
        accountNumber: company.paymentGateway?.efiAccountNumber ?? null,
        accountDigit: company.paymentGateway?.efiAccountDigit ?? null,
        pixKey: company.paymentGateway?.pixKey ?? null,
        certificatePath: company.paymentGateway?.certificatePath ?? null,
        lastError: company.paymentGateway?.lastError ?? null,
      },
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }

  private buildCompanyUpdateData(
    dto: UpdateAdminClientDto,
  ): Prisma.CompanyUpdateInput {
    const data: Prisma.CompanyUpdateInput = {};

    if (dto.company) {
      const company = dto.company;
      if (company.corporateName !== undefined) {
        data.corporateName = company.corporateName;
      }
      if (company.document !== undefined) {
        data.document = this.onlyDigits(company.document);
      }
      if (company.email !== undefined) {
        data.email = company.email;
      }
      if (company.phoneNumber !== undefined) {
        data.phoneNumber = this.onlyDigits(company.phoneNumber);
      }
      if (company.status !== undefined) {
        data.status = company.status;
      }
      if (company.gatewayProvider !== undefined) {
        data.gatewayProvider = company.gatewayProvider;
      }
      if (company.gatewayStatus !== undefined) {
        data.gatewayStatus = company.gatewayStatus;
      }
      if (company.legalRepresentative !== undefined) {
        data.legalRepresentative = this.nullableString(
          company.legalRepresentative,
        );
      }
      if (company.legalRepresentativeCpf !== undefined) {
        data.legalRepresentativeCpf = this.nullableDigits(
          company.legalRepresentativeCpf,
        );
      }
      if (company.legalRepresentativeBirthDate !== undefined) {
        data.legalRepresentativeBirthDate = this.nullableDate(
          company.legalRepresentativeBirthDate,
        );
      }
      if (company.addressPostalCode !== undefined) {
        data.addressPostalCode = this.nullableDigits(company.addressPostalCode);
      }
      if (company.addressStreet !== undefined) {
        data.addressStreet = this.nullableString(company.addressStreet);
      }
      if (company.addressNumber !== undefined) {
        data.addressNumber = this.nullableString(company.addressNumber);
      }
      if (company.addressDistrict !== undefined) {
        data.addressDistrict = this.nullableString(company.addressDistrict);
      }
      if (company.addressCity !== undefined) {
        data.addressCity = this.nullableString(company.addressCity);
      }
      if (company.addressState !== undefined) {
        data.addressState = this.nullableUppercase(company.addressState);
      }
      if (company.bankName !== undefined) {
        data.bankName = this.nullableString(company.bankName);
      }
      if (company.bankAgency !== undefined) {
        data.bankAgency = this.nullableString(company.bankAgency);
      }
      if (company.bankAccount !== undefined) {
        data.bankAccount = this.nullableString(company.bankAccount);
      }
    }

    if (dto.billing) {
      const billing = dto.billing;
      if (billing.enabledBillingMethods !== undefined) {
        data.enabledBillingMethods = billing.enabledBillingMethods;
      }
      if (billing.preferredBillingMethod !== undefined) {
        data.preferredBillingMethod = billing.preferredBillingMethod;
      }
      if (billing.onTimeSplitPercentageBps !== undefined) {
        data.onTimeSplitPercentageBps = billing.onTimeSplitPercentageBps;
      }
      if (billing.overdueSplitPercentageBps !== undefined) {
        data.overdueSplitPercentageBps = billing.overdueSplitPercentageBps;
      }
      if (billing.maxDiscountsPerDebtor !== undefined) {
        data.maxDiscountsPerDebtor = billing.maxDiscountsPerDebtor;
      }
      if (billing.discountTriggerDay !== undefined) {
        data.discountTriggerDay = billing.discountTriggerDay;
      }
      if (billing.collectionReminderDays !== undefined) {
        data.collectionReminderDays = billing.collectionReminderDays;
      }
      if (billing.autoGenerateFirstCharge !== undefined) {
        data.autoGenerateFirstCharge = billing.autoGenerateFirstCharge;
      }
      if (billing.autoDiscountEnabled !== undefined) {
        data.autoDiscountEnabled = billing.autoDiscountEnabled;
      }
      if (billing.autoDiscountDaysAfterDue !== undefined) {
        data.autoDiscountDaysAfterDue = billing.autoDiscountDaysAfterDue;
      }
      if (billing.autoDiscountPercentage !== undefined) {
        data.autoDiscountPercentage = billing.autoDiscountPercentage;
      }
    }

    if (dto.notifications) {
      const notifications = dto.notifications;
      if (notifications.businessSegment !== undefined) {
        data.businessSegment = notifications.businessSegment;
      }
      if (notifications.paymentNotificationEnabled !== undefined) {
        data.paymentNotificationEnabled =
          notifications.paymentNotificationEnabled;
      }
      if (notifications.paymentNotificationEmails !== undefined) {
        data.paymentNotificationEmails =
          notifications.paymentNotificationEmails;
      }
    }

    if (dto.whatsapp) {
      const whatsapp = dto.whatsapp;
      if (whatsapp.whatsappProvider !== undefined) {
        data.whatsappProvider = whatsapp.whatsappProvider;
      }
      if (whatsapp.whatsappInstanceId !== undefined) {
        data.whatsappInstanceId = this.nullableString(
          whatsapp.whatsappInstanceId,
        );
      }
      if (whatsapp.whatsappStatus !== undefined) {
        data.whatsappStatus = whatsapp.whatsappStatus;
      }
      if (whatsapp.metaPhoneNumberId !== undefined) {
        data.metaPhoneNumberId = this.nullableString(
          whatsapp.metaPhoneNumberId,
        );
      }
      if (whatsapp.metaBusinessAccountId !== undefined) {
        data.metaBusinessAccountId = this.nullableString(
          whatsapp.metaBusinessAccountId,
        );
      }
      if (whatsapp.metaBusinessPhoneNumber !== undefined) {
        data.metaBusinessPhoneNumber = this.nullableString(
          whatsapp.metaBusinessPhoneNumber,
        );
      }
      if (whatsapp.metaDefaultLanguage !== undefined) {
        data.metaDefaultLanguage = whatsapp.metaDefaultLanguage;
      }
      if (whatsapp.messagingLimitTier !== undefined) {
        data.messagingLimitTier = whatsapp.messagingLimitTier;
      }
      const metaAccessToken = this.secretString(whatsapp.metaAccessToken);
      if (metaAccessToken) {
        data.metaAccessTokenEncrypted = this.crypto.encrypt(metaAccessToken);
      }
    }

    if (dto.integrations) {
      const integrations = dto.integrations;
      const resendApiKey = this.secretString(integrations.resendApiKey);
      if (resendApiKey) {
        data.resendApiKeyEncrypted = this.crypto.encrypt(resendApiKey);
      }
      if (integrations.resendFromEmail !== undefined) {
        data.resendFromEmail = this.nullableString(
          integrations.resendFromEmail,
        );
      }
      const erpApiKey = this.secretString(integrations.erpApiKey);
      if (erpApiKey) {
        data.erpApiKeyHash = this.hashSecret(erpApiKey);
      }
      if (integrations.erpWebhookUrl !== undefined) {
        data.erpWebhookUrl = this.nullableString(integrations.erpWebhookUrl);
      }
      if (integrations.erpEnabledEvents !== undefined) {
        data.erpEnabledEvents = integrations.erpEnabledEvents;
      }
    }

    return data;
  }

  private async updateEfiGateway(
    company: AdminClientRecord,
    dto: AdminEfiUpdateDto,
  ): Promise<void> {
    const data = this.buildEfiUpdateData(dto);
    if (Object.keys(data).length === 0) {
      return;
    }

    if (company.paymentGateway) {
      await this.prisma.gatewayAccount.update({
        where: { companyId: company.id },
        data,
      });
      return;
    }

    const createData = this.buildEfiCreateData(company.id, dto);
    await this.prisma.gatewayAccount.create({ data: createData });
  }

  private buildEfiUpdateData(
    dto: AdminEfiUpdateDto,
  ): Prisma.GatewayAccountUpdateInput {
    const data: Prisma.GatewayAccountUpdateInput = {};

    if (dto.environment !== undefined) {
      data.environment = dto.environment;
    }
    const status = dto.status ?? dto.gatewayStatus;
    if (status !== undefined) {
      data.status = status;
    }
    if (dto.efiPayeeCode !== undefined) {
      data.payeeCode = dto.efiPayeeCode;
    }
    if (dto.efiAccountNumber !== undefined) {
      data.efiAccountNumber = dto.efiAccountNumber;
    }
    if (dto.efiAccountDigit !== undefined) {
      data.efiAccountDigit = this.nullableString(dto.efiAccountDigit);
    }
    if (dto.efiPixKey !== undefined) {
      data.pixKey = dto.efiPixKey;
    }

    const efiClientId = this.secretString(dto.efiClientId);
    if (efiClientId) {
      data.encryptedClientId = this.crypto.encrypt(efiClientId);
    }
    const efiClientSecret = this.secretString(dto.efiClientSecret);
    if (efiClientSecret) {
      data.encryptedClientSecret = this.crypto.encrypt(efiClientSecret);
    }
    const certificateBase64 = this.secretString(dto.efiCertificateBase64);
    if (certificateBase64) {
      data.encryptedCertificate = this.crypto.encrypt(certificateBase64);
      data.certificatePath = null;
    } else if (dto.efiCertificatePath !== undefined) {
      data.certificatePath = this.nullableString(dto.efiCertificatePath);
      data.encryptedCertificate = null;
    }
    const certificatePassword = this.secretString(dto.efiCertificatePassword);
    if (certificatePassword) {
      data.encryptedCertificatePassword =
        this.crypto.encrypt(certificatePassword);
    }

    return data;
  }

  private buildEfiCreateData(
    companyId: string,
    dto: AdminEfiUpdateDto,
  ): Prisma.GatewayAccountUncheckedCreateInput {
    const efiClientId = this.secretString(dto.efiClientId);
    const efiClientSecret = this.secretString(dto.efiClientSecret);
    const efiPayeeCode = this.secretString(dto.efiPayeeCode);
    const efiAccountNumber = this.secretString(dto.efiAccountNumber);
    const efiPixKey = this.secretString(dto.efiPixKey);

    if (
      !efiClientId ||
      !efiClientSecret ||
      !efiPayeeCode ||
      !efiAccountNumber ||
      !efiPixKey
    ) {
      throw new HttpException(
        'Informe as credenciais Efi obrigatorias para criar a conta do gateway.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const certificateBase64 = this.secretString(dto.efiCertificateBase64);
    const certificatePath = this.nullableString(dto.efiCertificatePath);
    const certificatePassword = this.secretString(dto.efiCertificatePassword);

    return {
      companyId,
      provider: 'EFI',
      environment: dto.environment ?? 'homologation',
      status: dto.status ?? dto.gatewayStatus ?? 'ACTIVE',
      payeeCode: efiPayeeCode,
      efiAccountNumber,
      efiAccountDigit: this.nullableString(dto.efiAccountDigit),
      pixKey: efiPixKey,
      encryptedClientId: this.crypto.encrypt(efiClientId),
      encryptedClientSecret: this.crypto.encrypt(efiClientSecret),
      encryptedCertificate: certificateBase64
        ? this.crypto.encrypt(certificateBase64)
        : null,
      encryptedCertificatePassword: certificatePassword
        ? this.crypto.encrypt(certificatePassword)
        : null,
      certificatePath: certificateBase64 ? null : certificatePath,
    };
  }

  private decimalToNumber(value: Prisma.Decimal | null): number | null {
    return value ? value.toNumber() : null;
  }

  private nullableString(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private nullableUppercase(value: string | null | undefined): string | null {
    const normalized = this.nullableString(value);
    return normalized ? normalized.toUpperCase() : null;
  }

  private nullableDigits(value: string | null | undefined): string | null {
    const normalized = this.nullableString(value);
    if (!normalized) {
      return null;
    }

    const digits = this.onlyDigits(normalized);
    return digits ? digits : null;
  }

  private nullableDate(value: string | null | undefined): Date | null {
    const normalized = this.nullableString(value);
    return normalized ? new Date(normalized) : null;
  }

  private secretString(value: string | null | undefined): string | null {
    const normalized = this.nullableString(value);
    return normalized ? normalized : null;
  }

  private hashSecret(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private generateTemporaryPassword(): string {
    return randomBytes(9).toString('base64url');
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }
}
