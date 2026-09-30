import {
  Body,
  Controller,
  Get,
  GoneException,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { MessagingLimitService } from '../queue/services/messaging-limit.service';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { WhatsAppConversationService } from './conversation.service';
import { WhatsappService } from './whatsapp.service';

interface AuthenticatedUser {
  companyId: string;
  userId?: string;
}

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, ThrottleGuard)
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly messagingLimitService: MessagingLimitService,
    private readonly conversationService: WhatsAppConversationService,
  ) {}

  @Get('unread-count')
  @UseGuards(PlatformAdminGuard)
  async getUnreadCount(@GetUser() user: AuthenticatedUser) {
    const count = await this.conversationService.getUnreadCount(user.companyId);
    return { count };
  }

  @Get('conversations')
  @UseGuards(PlatformAdminGuard)
  async listConversations(
    @GetUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const validStatuses = ['NEW', 'IN_PROGRESS', 'CLOSED'];
    const normalizedStatus = validStatuses.includes(status ?? '')
      ? (status as 'NEW' | 'IN_PROGRESS' | 'CLOSED')
      : undefined;

    return this.conversationService.listConversations(user.companyId, {
      status: normalizedStatus,
      search: search?.trim() || undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('conversations/:id')
  @UseGuards(PlatformAdminGuard)
  async getConversation(
    @GetUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const conv = await this.conversationService.getConversation(
      user.companyId,
      id,
    );
    if (!conv) {
      throw new HttpException('Conversa nao encontrada.', HttpStatus.NOT_FOUND);
    }
    return conv;
  }

  @Get('conversations/:id/messages')
  @UseGuards(PlatformAdminGuard)
  async getMessages(
    @GetUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.conversationService.getMessages(user.companyId, id);
  }

  /** Legacy inbox sends bypassed intent idempotency; replies go through the communications center. */
  @Post('conversations/:id/reply')
  @UseGuards(PlatformAdminGuard)
  reply(): never {
    throw new GoneException(
      'Envio pela caixa antiga desativado. Responda pela central de comunicacoes.',
    );
  }

  @Put('conversations/:id/status')
  @UseGuards(PlatformAdminGuard)
  async updateStatus(
    @GetUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const validStatuses = ['NEW', 'IN_PROGRESS', 'CLOSED'];
    if (!validStatuses.includes(body.status)) {
      throw new HttpException('Status invalido.', HttpStatus.BAD_REQUEST);
    }

    await this.conversationService.updateStatus(
      user.companyId,
      id,
      body.status as 'NEW' | 'IN_PROGRESS' | 'CLOSED',
    );
    return { success: true };
  }

  @Put('conversations/:id/assignee')
  @UseGuards(PlatformAdminGuard)
  async updateAssignee(
    @GetUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { assigneeId: string | null },
  ) {
    await this.conversationService.updateAssignee(
      user.companyId,
      id,
      body.assigneeId,
    );
    return { success: true };
  }

  @Post('admin/test-integration')
  @UseGuards(PlatformAdminGuard)
  async testIntegration(): Promise<
    Awaited<ReturnType<WhatsappService['testIntegration']>>
  > {
    return this.whatsappService.testIntegration();
  }

  // Results of the signed-in company only (the company comes from the session,
  // never from the request); no channel capacity, tier or quality.
  @Get('stats')
  async getStats(@GetUser() user: AuthenticatedUser) {
    return {
      period: 'rolling_24h' as const,
      interactions: await this.messagingLimitService.getInteractionStats(
        user.companyId,
      ),
    };
  }

  /**
   * @deprecated Kept for frontends published before GET /whatsapp/stats; the
   * tier fields no longer limit sends and are removed in a coordinated step.
   */
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

  // Central channel operation: platform administrators only.
  @Get('admin/channel-capacity')
  @UseGuards(PlatformAdminGuard)
  async getChannelCapacity() {
    return this.messagingLimitService.getChannelCapacity();
  }

  // Reads the central channel tier through Datafy; no company is changed.
  @Post('sync-tier')
  @UseGuards(PlatformAdminGuard)
  async syncTier() {
    const { tier, capacity } =
      await this.messagingLimitService.syncChannelTier();

    if (!tier) {
      throw new HttpException(
        'Nao foi possivel confirmar o tier do canal pelo Datafy.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return { tier, capacity };
  }
}
