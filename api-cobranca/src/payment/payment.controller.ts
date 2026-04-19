import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { IsString, IsArray, IsUUID, IsOptional, IsEnum } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';

class CreatePaymentDto {
  @IsUUID()
  invoiceId!: string;

  @IsOptional()
  @IsString()
  billingType?: 'PIX' | 'BOLETO';
}

class CreateBatchPaymentDto {
  @IsArray()
  @IsUUID('4', { each: true })
  invoiceIds!: string[];

  @IsOptional()
  @IsString()
  billingType?: 'PIX' | 'BOLETO';
}

class InvoiceStatusDto {
  @IsEnum(InvoiceStatus)
  status!: InvoiceStatus;
}

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('create')
  async createPayment(
    @GetUser() user: any,
    @Body() dto: CreatePaymentDto,
  ) {
    if (!this.paymentService.isConfigured()) {
      throw new HttpException(
        'Gateway de pagamento não configurado. Configure ASAAS_API_KEY.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

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
        ...result,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Erro ao gerar cobrança',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('create-batch')
  async createPaymentBatch(
    @GetUser() user: any,
    @Body() dto: CreateBatchPaymentDto,
  ) {
    if (!this.paymentService.isConfigured()) {
      throw new HttpException(
        'Gateway de pagamento não configurado. Configure ASAAS_API_KEY.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

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
        error instanceof Error ? error.message : 'Erro ao gerar cobranças',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('boleto')
  async createBoleto(
    @GetUser() user: any,
    @Body() dto: CreatePaymentDto,
  ) {
    if (!this.paymentService.isConfigured()) {
      throw new HttpException(
        'Gateway de pagamento não configurado. Configure ASAAS_API_KEY.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const result = await this.paymentService.createBoletoPayment(
        dto.invoiceId,
        user.companyId,
      );

      return {
        success: true,
        invoiceId: dto.invoiceId,
        billingType: 'BOLETO',
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
    @GetUser() user: any,
    @Body() dto: CreateBatchPaymentDto,
  ) {
    if (!this.paymentService.isConfigured()) {
      throw new HttpException(
        'Gateway de pagamento não configurado. Configure ASAAS_API_KEY.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

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
    @GetUser() user: any,
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
      throw new HttpException('Fatura não encontrada', HttpStatus.NOT_FOUND);
    }

    return {
      invoiceId: invoice.id,
      status: invoice.status,
      gatewayId: invoice.gatewayId,
      pixPayload: invoice.pixPayload,
      pixExpiresAt: invoice.pixExpiresAt,
      originalAmount: invoice.originalAmount,
      dueDate: invoice.dueDate,
    };
  }

  @Post('invoice/:id/status')
  async updateInvoiceStatus(
    @GetUser() user: any,
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
      throw new HttpException('Fatura não encontrada', HttpStatus.NOT_FOUND);
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
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
      invoiceId: updated.id,
      status: updated.status,
    };
  }

  @Get('status')
  async getPaymentGatewayStatus() {
    return {
      configured: this.paymentService.isConfigured(),
      gateway: 'asaas',
    };
  }
}