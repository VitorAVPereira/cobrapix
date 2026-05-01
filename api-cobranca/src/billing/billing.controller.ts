import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedUser {
  companyId: string;
}

@Controller('billing')
@UseGuards(JwtAuthGuard)
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
