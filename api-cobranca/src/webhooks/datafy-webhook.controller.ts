import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DatafyWebhookService } from './datafy-webhook.service';
import { DatafyDeliveryQueryDto } from './datafy-delivery-query.dto';

@Controller('webhooks')
export class DatafyWebhookController {
  constructor(private readonly service: DatafyWebhookService) {}

  @Post('datafy')
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-datafy-delivery-id') deliveryId: string | undefined,
    @Headers('x-datafy-timestamp') timestamp: string | undefined,
    @Headers('x-datafy-signature-256') signature: string | undefined,
  ): Promise<{ received: true }> {
    return this.service.receive(request.rawBody, {
      deliveryId,
      timestamp,
      signature,
    });
  }

  @Get('admin/datafy/deliveries')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  list(
    @GetUser() user: AuthenticatedUser,
    @Query() query: DatafyDeliveryQueryDto,
  ): Promise<unknown> {
    return this.service.listForAdmin(user.userId, query);
  }

  @Post('admin/datafy/deliveries/:id/replay')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @HttpCode(200)
  replay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetUser() user: AuthenticatedUser,
  ): Promise<{ queued: true }> {
    return this.service.replayForAdmin(id, user.userId);
  }
}
