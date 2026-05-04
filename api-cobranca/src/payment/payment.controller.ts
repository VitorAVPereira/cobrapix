import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateGatewayAccountDto,
  GatewayAccountStatusResponse,
} from './dto/gateway-account.dto';
import { EfiService } from './efi.service';
import { PaymentService } from './payment.service';

interface AuthenticatedUser {
  userId: string;
  email: string;
  name?: string;
  companyId: string;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

class CreatePaymentDto {
  @IsUUID()
  invoiceId!: string;

  @IsOptional()
  @IsString()
  billingType?: 'PIX' | 'BOLETO' | 'BOLIX';
}

class CreateBatchPaymentDto {
  @IsArray()
  @IsUUID('4', { each: true })
  invoiceIds!: string[];

  @IsOptional()
  @IsString()
  billingType?: 'PIX' | 'BOLETO' | 'BOLIX';
}

class InvoiceStatusDto {
  @IsEnum(InvoiceStatus)
  status!: InvoiceStatus;
}

@Controller('payments')
@UseGuards(JwtAuthGuard, ThrottleGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly efiService: EfiService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('gateway-account')
  async getGatewayAccount(
    @GetUser() user: AuthenticatedUser,
  ): Promise<GatewayAccountStatusResponse> {
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      include: {
        paymentGateway: true,
        originalBankAccount: true,
      },
    });

    if (!company) {
      throw new HttpException('Empresa nao encontrada', HttpStatus.NOT_FOUND);
    }

    const gatewayAccount = company.paymentGateway;
    const originalBankAccount = company.originalBankAccount;

    return {
      provider: gatewayAccount?.provider ?? company.gatewayProvider,
      accountId: gatewayAccount?.id ?? company.gatewayAccountId,
      environment: gatewayAccount?.environment ?? null,
      status: gatewayAccount?.status ?? company.gatewayStatus,
      hasApiKey: Boolean(gatewayAccount?.encryptedClientId),
      company: {
        corporateName: company.corporateName,
        cnpj: company.document,
        email: company.email,
        phoneNumber: company.phoneNumber,
      },
      legalRepresentative: {
        name: company.legalRepresentative,
        cpf: company.legalRepresentativeCpf,
        birthDate:
          company.legalRepresentativeBirthDate?.toISOString().split('T')[0] ??
          null,
      },
      address: {
        postalCode: company.addressPostalCode,
        street: company.addressStreet,
        number: company.addressNumber,
        district: company.addressDistrict,
        city: company.addressCity,
        state: company.addressState,
      },
      bank: {
        name: originalBankAccount?.bankName ?? company.bankName,
        agency: originalBankAccount?.agency ?? company.bankAgency,
        account: originalBankAccount?.account ?? company.bankAccount,
        accountDigit: originalBankAccount?.accountDigit ?? null,
        accountType: originalBankAccount?.accountType ?? null,
        holderName: originalBankAccount?.holderName ?? null,
        holderDocument: originalBankAccount?.holderDocument ?? null,
      },
      efi: {
        payeeCode: gatewayAccount?.payeeCode ?? null,
        accountNumber: gatewayAccount?.efiAccountNumber ?? null,
        accountDigit: gatewayAccount?.efiAccountDigit ?? null,
        pixKey: gatewayAccount?.pixKey ?? null,
        hasCertificate: Boolean(
          gatewayAccount?.certificatePath ??
          gatewayAccount?.encryptedCertificate,
        ),
      },
    };
  }

  @Post('gateway-account')
  async createGatewayAccount(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateGatewayAccountDto,
  ): Promise<GatewayAccountStatusResponse> {
    this.ensureConfigured();

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
    });

    if (!company) {
      throw new HttpException('Empresa nao encontrada', HttpStatus.NOT_FOUND);
    }

    await this.prisma.company.update({
      where: { id: user.companyId },
      data: {
        corporateName: dto.corporateName,
        document: onlyDigits(dto.cnpj),
        email: dto.email,
        phoneNumber: onlyDigits(dto.phoneNumber),
        gatewayProvider: 'EFI',
        gatewayAccountId: dto.efiPayeeCode,
        gatewayApiKey: null,
        gatewayStatus: dto.gatewayStatus ?? 'ACTIVE',
        legalRepresentative: dto.legalRepresentative,
        legalRepresentativeCpf: onlyDigits(dto.legalRepresentativeCpf),
        legalRepresentativeBirthDate: new Date(
          dto.legalRepresentativeBirthDate,
        ),
        addressPostalCode: onlyDigits(dto.postalCode),
        addressStreet: dto.street,
        addressNumber: dto.number,
        addressDistrict: dto.district,
        addressCity: dto.city,
        addressState: dto.state.toUpperCase(),
        bankName: dto.bankName,
        bankAgency: dto.bankAgency,
        bankAccount: dto.bankAccount,
      },
    });

    await this.prisma.originalBankAccount.upsert({
      where: { companyId: user.companyId },
      create: {
        companyId: user.companyId,
        holderName: dto.legalRepresentative,
        holderDocument: onlyDigits(dto.legalRepresentativeCpf),
        bankName: dto.bankName,
        agency: dto.bankAgency,
        account: dto.bankAccount,
        accountDigit: dto.bankAccountDigit,
        accountType: dto.bankAccountType ?? 'CHECKING',
      },
      update: {
        holderName: dto.legalRepresentative,
        holderDocument: onlyDigits(dto.legalRepresentativeCpf),
        bankName: dto.bankName,
        agency: dto.bankAgency,
        account: dto.bankAccount,
        accountDigit: dto.bankAccountDigit,
        accountType: dto.bankAccountType ?? 'CHECKING',
      },
    });

    await this.efiService.upsertManualGatewayAccount(user.companyId, dto);

    return this.getGatewayAccount(user);
  }

  @Post('create')
  async createPayment(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    this.ensureConfigured();

    try {
      const billingType = dto.billingType || 'PIX';
      const result = await this.paymentService.createPayment(
        dto.invoiceId,
        user.companyId,
        billingType,
      );

      return {
        success: true,
        invoiceId: dto.invoiceId,
        billingType,
        gateway: 'efi',
        ...result,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Erro ao gerar cobranca',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('create-batch')
  async createPaymentBatch(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateBatchPaymentDto,
  ) {
    this.ensureConfigured();

    try {
      const billingType = dto.billingType || 'PIX';
      const result = await this.paymentService.createPaymentBatch(
        dto.invoiceIds,
        user.companyId,
        billingType,
      );

      return {
        success: true,
        summary: {
          total: dto.invoiceIds.length,
          created: result.success,
          failed: result.failed,
          billingType,
        },
        results: result.results,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Erro ao gerar cobrancas',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('boleto')
  async createBoleto(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    this.ensureConfigured();

    try {
      const result = await this.paymentService.createBoletoPayment(
        dto.invoiceId,
        user.companyId,
      );

      return {
        success: true,
        invoiceId: dto.invoiceId,
        billingType: 'BOLETO',
        gateway: 'efi',
        ...result,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Erro ao gerar boleto',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('boleto-batch')
  async createBoletoBatch(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateBatchPaymentDto,
  ) {
    this.ensureConfigured();

    try {
      const result = await this.paymentService.createBoletoPaymentBatch(
        dto.invoiceIds,
        user.companyId,
      );

      return {
        success: true,
        summary: {
          total: dto.invoiceIds.length,
          created: result.success,
          failed: result.failed,
          billingType: 'BOLETO',
        },
        results: result.results,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Erro ao gerar boletos',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('invoice/:id')
  async getPaymentStatus(
    @GetUser() user: AuthenticatedUser,
    @Param('id') invoiceId: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        companyId: user.companyId,
      },
      include: {
        debtor: true,
      },
    });

    if (!invoice) {
      throw new HttpException('Fatura nao encontrada', HttpStatus.NOT_FOUND);
    }

    return {
      invoiceId: invoice.id,
      status: invoice.status,
      gateway: 'efi',
      gatewayId: invoice.gatewayId,
      txid: invoice.efiTxid,
      chargeId: invoice.efiChargeId,
      pixPayload: invoice.pixPayload,
      pixCopyPaste: invoice.efiPixCopiaECola,
      pixExpiresAt: invoice.pixExpiresAt,
      boletoCode: invoice.boletoLinhaDigitavel,
      boletoLink: invoice.boletoLink,
      boletoPdf: invoice.boletoPdf,
      gatewayStatusRaw: invoice.gatewayStatusRaw,
      originalAmount: invoice.originalAmount,
      dueDate: invoice.dueDate,
    };
  }

  @Post('invoice/:id/status')
  async updateInvoiceStatus(
    @GetUser() user: AuthenticatedUser,
    @Param('id') invoiceId: string,
    @Body() dto: InvoiceStatusDto,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        companyId: user.companyId,
      },
    });

    if (!invoice) {
      throw new HttpException('Fatura nao encontrada', HttpStatus.NOT_FOUND);
    }

    await this.prisma.invoice.updateMany({
      where: { id: invoiceId, companyId: user.companyId },
      data: { status: dto.status },
    });

    await this.prisma.collectionLog.create({
      data: {
        companyId: user.companyId,
        invoiceId: invoice.id,
        actionType: 'STATUS_CHANGED',
        description: `Status alterado para ${dto.status}`,
        status: dto.status,
      },
    });

    return {
      success: true,
      invoiceId: invoice.id,
      status: dto.status,
    };
  }

  @Get('status')
  async getPaymentGatewayStatus(@GetUser() user: AuthenticatedUser) {
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      include: { paymentGateway: true },
    });

    return {
      configured: this.paymentService.isConfigured(),
      gateway: 'efi',
      environment:
        company?.paymentGateway?.environment ??
        this.efiService.getEnvironment(undefined),
      accountStatus:
        company?.paymentGateway?.status ?? company?.gatewayStatus ?? 'PENDING',
      hasSubAccount: Boolean(
        company?.paymentGateway ?? company?.gatewayAccountId,
      ),
    };
  }

  private ensureConfigured(): void {
    if (!this.paymentService.isConfigured()) {
      throw new HttpException(
        'Gateway de pagamento nao configurado. Configure EFI_* e PAYMENT_SECRET_KEY.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
