import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsUUID } from 'class-validator';
import { BillingService } from './billing.service';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedUser {
  companyId: string;
}

class RunSelectedBillingDto {
  @IsArray()
  @IsUUID('4', { each: true })
  invoiceIds!: string[];
}

@Controller('billing')
@UseGuards(JwtAuthGuard, ThrottleGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run')
  async runBilling(@GetUser() user: AuthenticatedUser) {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: user.companyId },
      });

      if (!company) {
        throw new HttpException('Não autorizado.', HttpStatus.UNAUTHORIZED);
      }

      if (company.whatsappStatus !== 'CONNECTED') {
        throw new HttpException(
          'WhatsApp não está conectado. Conecte antes de executar cobranças.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!company.whatsappInstanceId) {
        throw new HttpException(
          'Nenhuma instância WhatsApp configurada.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.billingService.executeBilling(user.companyId);

      return {
        success: true,
        summary: {
          total: result.queued + result.skipped,
          queued: result.queued,
          skipped: result.skipped,
        },
        message: `Cobrança executada: ${result.queued} mensagens enfileiradas, ${result.skipped} puladas.`,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Falha interna ao executar cobrança.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('settings')
  async getSettings(@GetUser() user: AuthenticatedUser) {
    return this.billingService.getSettings(user.companyId);
  }

  @Get('metrics')
  async getMetrics(
    @GetUser() user: AuthenticatedUser,
    @Query('period') period?: string,
  ) {
    return this.billingService.getMetrics(user.companyId, period);
  }

  @Post('invoices/run')
  async runSelectedBilling(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: RunSelectedBillingDto,
  ) {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: user.companyId },
      });

      if (!company) {
        throw new HttpException('Não autorizado.', HttpStatus.UNAUTHORIZED);
      }

      if (company.whatsappStatus !== 'CONNECTED') {
        throw new HttpException(
          'WhatsApp não está conectado. Conecte antes de executar cobranças.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!company.whatsappInstanceId) {
        throw new HttpException(
          'Nenhuma instância WhatsApp configurada.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.billingService.enqueueSelectedInvoices(
        user.companyId,
        dto.invoiceIds,
      );

      return {
        success: true,
        summary: {
          total: result.requested,
          queued: result.queued,
          skipped: result.skipped,
        },
        message: `Fluxo automático iniciado: ${result.queued} faturas enfileiradas, ${result.skipped} ignoradas.`,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Falha interna ao iniciar cobrança.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('settings')
  async updateSettings(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: UpdateBillingSettingsDto,
  ) {
    return this.billingService.updateSettings(user.companyId, {
      preferredBillingMethod: dto.preferredBillingMethod,
      collectionReminderDays: dto.collectionReminderDays,
      autoGenerateFirstCharge: dto.autoGenerateFirstCharge,
      autoDiscountEnabled: dto.autoDiscountEnabled,
      autoDiscountDaysAfterDue: dto.autoDiscountDaysAfterDue,
      autoDiscountPercentage: dto.autoDiscountPercentage,
    });
  }
}
