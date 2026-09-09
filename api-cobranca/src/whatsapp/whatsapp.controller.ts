import {
  Body,
  Controller,
  Get,
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
import { WhatsAppConversationService } from './conversation.service';
import { ConfigureMetaWhatsappDto } from './dto/configure-meta-whatsapp.dto';
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
  async getUnreadCount(@GetUser() user: AuthenticatedUser) {
    const count = await this.conversationService.getUnreadCount(user.companyId);
    return { count };
  }

  @Get('conversations')
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
  async getMessages(
    @GetUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.conversationService.getMessages(user.companyId, id);
  }

  @Post('conversations/:id/reply')
  async reply(
    @GetUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    if (!body.content?.trim()) {
      throw new HttpException('Mensagem vazia.', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.conversationService.sendReply(
        user.companyId,
        id,
        body.content.trim(),
        user.userId ?? user.companyId,
      );
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Falha ao enviar resposta.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Put('conversations/:id/status')
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
