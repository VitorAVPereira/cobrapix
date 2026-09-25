import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConversationStatus } from '@prisma/client';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommunicationsService } from './communications.service';
import { CommunicationsTenantService } from './communications-tenant.service';
import { CommunicationsQueryDto } from './dto/communications-query.dto';
import { IsEnum } from 'class-validator';
import { ReplyConversationDto } from './dto/reply-conversation.dto';
import { AttributeMessageDto } from './dto/attribute-message.dto';
import { TemplateReplyDto } from './dto/template-reply.dto';
import {
  AdminConversationMessagesQueryDto,
  AdminConversationsQueryDto,
  CompanyConversationsQueryDto,
  ConversationMessagesQueryDto,
} from './dto/conversation-query.dto';
class ConversationStatusDto {
  @IsEnum(ConversationStatus) status!: ConversationStatus;
}

/**
 * Company routes read only the session company's projection. Every mutation and the
 * global view are PLATFORM_ADMIN only; knowing an ID never grants access.
 */
@Controller('communications')
@UseGuards(JwtAuthGuard)
export class CommunicationsController {
  constructor(
    private readonly service: CommunicationsService,
    private readonly tenant: CommunicationsTenantService,
  ) {}

  @Get('outbound')
  listOutbound(
    @GetUser() user: AuthenticatedUser,
    @Query() query: CommunicationsQueryDto,
  ): Promise<unknown> {
    return this.service.listOutbound(user.companyId, query);
  }

  @Get('conversations')
  listConversations(
    @GetUser() user: AuthenticatedUser,
    @Query() query: CompanyConversationsQueryDto,
  ): Promise<unknown> {
    return this.tenant.listConversations(
      { userId: user.userId, companyId: user.companyId },
      query,
    );
  }

  @Get('conversations/:id/messages')
  listConversationMessages(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ConversationMessagesQueryDto,
  ): Promise<unknown> {
    return this.tenant.listMessages(
      { userId: user.userId, companyId: user.companyId },
      id,
      query,
    );
  }

  @Get('admin/conversations')
  @UseGuards(PlatformAdminGuard)
  listAdmin(@Query() query: AdminConversationsQueryDto): Promise<unknown> {
    return this.service.listAdminConversations(query);
  }

  @Get('admin/conversations/:id')
  @UseGuards(PlatformAdminGuard)
  getAdmin(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AdminConversationMessagesQueryDto,
  ): Promise<unknown> {
    return this.service.getAdminConversation(id, user.userId, query);
  }

  @Get('admin/conversations/:id/context-options')
  @UseGuards(PlatformAdminGuard)
  listContextOptions(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.service.listContextOptions(id);
  }

  @Patch('admin/conversations/:id/status')
  @UseGuards(PlatformAdminGuard)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConversationStatusDto,
  ): Promise<unknown> {
    return this.service.updateAdminStatus(id, body.status);
  }

  @Patch('admin/messages/:id/attribution')
  @UseGuards(PlatformAdminGuard)
  attribute(
    @GetUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AttributeMessageDto,
  ): Promise<unknown> {
    return this.service.attributeMessage(id, user.userId, body);
  }

  @Post('admin/conversations/:id/replies')
  @UseGuards(PlatformAdminGuard)
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplyConversationDto,
  ): Promise<unknown> {
    return this.service.replyToAdminConversation(id, body);
  }

  @Post('admin/conversations/:id/template-replies')
  @UseGuards(PlatformAdminGuard)
  templateReply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TemplateReplyDto,
  ): Promise<unknown> {
    return this.service.replyWithTemplate(id, body);
  }
}
