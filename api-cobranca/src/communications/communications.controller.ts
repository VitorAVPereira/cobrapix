import {
  Body,
  Controller,
  Get,
  Param,
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
import { CommunicationsQueryDto } from './dto/communications-query.dto';
import { IsEnum } from 'class-validator';
import { ReplyConversationDto } from './dto/reply-conversation.dto';
class ConversationStatusDto {
  @IsEnum(ConversationStatus) status!: ConversationStatus;
}

@Controller('communications')
@UseGuards(JwtAuthGuard)
export class CommunicationsController {
  constructor(private readonly service: CommunicationsService) {}

  @Get('outbound')
  listOutbound(
    @GetUser() user: AuthenticatedUser,
    @Query() query: CommunicationsQueryDto,
  ): Promise<unknown> {
    return this.service.listOutbound(user.companyId, query);
  }

  @Get('admin/conversations')
  @UseGuards(PlatformAdminGuard)
  listAdmin(@Query() query: CommunicationsQueryDto): Promise<unknown> {
    return this.service.listAdminConversations(query);
  }

  @Get('admin/conversations/:id')
  @UseGuards(PlatformAdminGuard)
  getAdmin(@Param('id') id: string): Promise<unknown> {
    return this.service.getAdminConversation(id);
  }

  @Patch('admin/conversations/:id/status')
  @UseGuards(PlatformAdminGuard)
  updateStatus(
    @Param('id') id: string,
    @Body() body: ConversationStatusDto,
  ): Promise<unknown> {
    return this.service.updateAdminStatus(id, body.status);
  }

  @Post('admin/conversations/:id/replies')
  @UseGuards(PlatformAdminGuard)
  reply(
    @Param('id') id: string,
    @Body() body: ReplyConversationDto,
  ): Promise<unknown> {
    return this.service.replyToAdminConversation(id, body);
  }
}
