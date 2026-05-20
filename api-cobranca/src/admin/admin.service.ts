import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  BillingMethod,
  CompanyStatus,
  UserRole,
  WhatsappStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { EfiService } from '../payment/efi.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  CreateAdminClientDto,
  ResetClientPasswordDto,
  UpdateAdminClientDto,
} from './dto/admin-client.dto';

interface AdminClientRecord {
  id: string;
  corporateName: string;
  document: string;
  email: string;
  phoneNumber: string;
  status: CompanyStatus;
  enabledBillingMethods: BillingMethod[];
  preferredBillingMethod: BillingMethod;
  onTimeSplitPercentageBps: number;
  overdueSplitPercentageBps: number;
  gatewayStatus: string;
  whatsappStatus: WhatsappStatus;
  createdAt: Date;
  updatedAt: Date;
  users?: Array<{
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
  }>;
  paymentGateway?: {
    id: string;
    status: string;
    environment: string;
  } | null;
}

export interface AdminClientResponse {
  id: string;
  corporateName: string;
  document: string;
  email: string;
  phoneNumber: string;
  status: string;
  enabledBillingMethods: BillingMethod[];
  preferredBillingMethod: BillingMethod;
  onTimeSplitPercentageBps: number;
  overdueSplitPercentageBps: number;
  gatewayStatus: string;
  whatsappStatus: string;
  firstUser: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
  } | null;
  efi: {
    configured: boolean;
    status: string | null;
    environment: string | null;
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
  ) {}

  async listClients(): Promise<AdminClientResponse[]> {
    const companies = await this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          where: { role: UserRole.COMPANY_ADMIN },
          take: 1,
          select: { id: true, email: true, name: true, role: true },
        },
        paymentGateway: {
          select: { id: true, status: true, environment: true },
        },
      },
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
      include: {
        users: {
          where: { role: UserRole.COMPANY_ADMIN },
          take: 1,
          select: { id: true, email: true, name: true, role: true },
        },
        paymentGateway: {
          select: { id: true, status: true, environment: true },
        },
      },
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
    await this.findClientOrThrow(id);

    if (dto.company || dto.billing) {
      await this.prisma.company.update({
        where: { id },
        data: {
          ...(dto.company
            ? {
                corporateName: dto.company.corporateName,
                document: this.onlyDigits(dto.company.document),
                email: dto.company.email,
                phoneNumber: this.onlyDigits(dto.company.phoneNumber),
                status: dto.company.status ?? 'ACTIVE',
              }
            : {}),
          ...(dto.billing
            ? {
                enabledBillingMethods: dto.billing.enabledBillingMethods,
                preferredBillingMethod: dto.billing.preferredBillingMethod,
                onTimeSplitPercentageBps: dto.billing.onTimeSplitPercentageBps,
                overdueSplitPercentageBps:
                  dto.billing.overdueSplitPercentageBps,
              }
            : {}),
        },
      });
    }

    if (dto.meta) {
      await this.whatsappService.configureMetaIntegration(id, dto.meta);
    }

    if (dto.efi) {
      await this.efiService.upsertManualGatewayAccount(id, dto.efi);
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
      include: {
        users: {
          where: { role: UserRole.COMPANY_ADMIN },
          take: 1,
          select: { id: true, email: true, name: true, role: true },
        },
        paymentGateway: {
          select: { id: true, status: true, environment: true },
        },
      },
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
      enabledBillingMethods: company.enabledBillingMethods,
      preferredBillingMethod: company.preferredBillingMethod,
      onTimeSplitPercentageBps: company.onTimeSplitPercentageBps,
      overdueSplitPercentageBps: company.overdueSplitPercentageBps,
      gatewayStatus: company.gatewayStatus,
      whatsappStatus: company.whatsappStatus,
      firstUser,
      efi: {
        configured: Boolean(company.paymentGateway),
        status: company.paymentGateway?.status ?? null,
        environment: company.paymentGateway?.environment ?? null,
      },
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }

  private generateTemporaryPassword(): string {
    return randomBytes(9).toString('base64url');
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }
}
