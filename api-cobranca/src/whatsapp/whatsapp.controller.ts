import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagingLimitService } from '../queue/services/messaging-limit.service';
import { ConfigureMetaWhatsappDto } from './dto/configure-meta-whatsapp.dto';
import { WhatsappService } from './whatsapp.service';

interface AuthenticatedUser {
  companyId: string;
}

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly messagingLimitService: MessagingLimitService,
  ) {}

  @Post('meta')
  async configureMeta(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: ConfigureMetaWhatsappDto,
  ): Promise<unknown> {
    try {
      return await this.whatsappService.configureMetaIntegration(
        user.companyId,
        dto,
      );
    } catch (error) {
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Erro ao configurar Meta Cloud API.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Post('instance')
  async createInstance(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: ConfigureMetaWhatsappDto,
  ): Promise<unknown> {
    return this.configureMeta(user, dto);
  }

  @Get('status')
  async getStatus(@GetUser() user: AuthenticatedUser): Promise<unknown> {
    return this.whatsappService.getStatus(user.companyId);
  }

  @Post('disconnect')
  async disconnect(
    @GetUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    await this.whatsappService.disconnect(user.companyId);
    return { success: true };
  }

  @Get('usage')
  async getUsage(@GetUser() user: AuthenticatedUser) {
    const [dailyStatus, interactions] = await Promise.all([
      this.messagingLimitService.canSend(user.companyId),
      this.messagingLimitService.getInteractionStats(user.companyId),
    ]);

    return {
      tier: dailyStatus.tier,
      dailyLimit: dailyStatus.limit,
      dailyUsage: dailyStatus.usage,
      remaining: dailyStatus.remaining,
      interactions,
    };
  }

  @Post('sync-tier')
  async syncTier(@GetUser() user: AuthenticatedUser) {
    const tier = await this.messagingLimitService.syncTierFromMeta(
      user.companyId,
    );

    if (!tier) {
      throw new HttpException(
        'Nao foi possivel sincronizar o tier com a Meta',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return { tier };
  }
}
