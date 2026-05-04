import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CollectionChannel, CollectionProfileType } from '@prisma/client';
import { BillingService } from './billing.service';
import { CollectionProfileService } from './collection-profile.service';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedUser {
  companyId: string;
}

const COLLECTION_PROFILE_TYPES: CollectionProfileType[] = [
  'NEW',
  'GOOD',
  'DOUBTFUL',
  'BAD',
];
const COLLECTION_CHANNELS: CollectionChannel[] = ['EMAIL', 'WHATSAPP'];

class RunSelectedBillingDto {
  @IsArray()
  @IsUUID('4', { each: true })
  invoiceIds!: string[];
}

class CreateRuleDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsIn(COLLECTION_PROFILE_TYPES)
  profileType!: CollectionProfileType;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(-30)
  @Max(365)
  daysOverdueMin?: number;

  @IsOptional()
  @IsInt()
  @Min(-30)
  @Max(365)
  daysOverdueMax?: number;
}

class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsIn(COLLECTION_PROFILE_TYPES)
  profileType?: CollectionProfileType;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(-30)
  @Max(365)
  daysOverdueMin?: number;

  @IsOptional()
  @IsInt()
  @Min(-30)
  @Max(365)
  daysOverdueMax?: number;
}

class RuleStepDto {
  @IsInt()
  @Min(0)
  @Max(50)
  stepOrder!: number;

  @IsIn(COLLECTION_CHANNELS)
  channel!: CollectionChannel;

  @IsOptional()
  @IsUUID('4')
  templateId?: string;

  @IsInt()
  @Min(-30)
  @Max(365)
  delayDays!: number;

  @IsOptional()
  @IsString()
  sendTimeStart?: string;

  @IsOptional()
  @IsString()
  sendTimeEnd?: string;
}

class SetRuleStepsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RuleStepDto)
  steps!: RuleStepDto[];
}

@Controller('billing')
@UseGuards(JwtAuthGuard, ThrottleGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly collectionProfileService: CollectionProfileService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run')
  async runBilling(@GetUser() user: AuthenticatedUser) {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: user.companyId },
      });

      if (!company) {
        throw new HttpException('Nao autorizado.', HttpStatus.UNAUTHORIZED);
      }

      const result = await this.billingService.executeBilling(user.companyId);

      return {
        success: true,
        summary: {
          total: result.queued + result.skipped,
          queued: result.queued,
          skipped: result.skipped,
        },
        message: `Cobranca executada: ${result.queued} mensagens enfileiradas, ${result.skipped} puladas.`,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Falha interna ao executar cobranca.',
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

  @Get('rules')
  async getRules(@GetUser() user: AuthenticatedUser) {
    return this.collectionProfileService.listProfiles(user.companyId);
  }

  @Post('rules')
  async createRule(
    @GetUser() user: AuthenticatedUser,
    @Body() body: CreateRuleDto,
  ) {
    return this.collectionProfileService.createProfile(user.companyId, body);
  }

  @Put('rules/:profileId')
  async updateRule(
    @GetUser() user: AuthenticatedUser,
    @Param('profileId') profileId: string,
    @Body() body: UpdateRuleDto,
  ) {
    return this.collectionProfileService.updateProfile(
      user.companyId,
      profileId,
      body,
    );
  }

  @Delete('rules/:profileId')
  async deleteRule(
    @GetUser() user: AuthenticatedUser,
    @Param('profileId') profileId: string,
  ) {
    return this.collectionProfileService.deleteProfile(
      user.companyId,
      profileId,
    );
  }

  @Put('rules/:profileId/steps')
  async setSteps(
    @GetUser() user: AuthenticatedUser,
    @Param('profileId') profileId: string,
    @Body() body: SetRuleStepsDto,
  ) {
    return this.collectionProfileService.setSteps(
      user.companyId,
      profileId,
      body.steps,
    );
  }

  @Post('classify-debtors')
  async classifyDebtors(@GetUser() user: AuthenticatedUser) {
    await this.collectionProfileService.classifyDebtors(user.companyId);
    return { success: true };
  }
}
