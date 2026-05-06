import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import {
  PaymentNotificationListItem,
  PaymentNotificationListResponse,
  PaymentNotificationsService,
} from './payment-notifications.service';

interface AuthenticatedUser {
  companyId: string;
}

@Controller('payment-notifications')
@UseGuards(JwtAuthGuard, ThrottleGuard)
export class PaymentNotificationsController {
  constructor(
    private readonly paymentNotificationsService: PaymentNotificationsService,
  ) {}

  @Get()
  async list(
    @GetUser() user: AuthenticatedUser,
  ): Promise<PaymentNotificationListResponse> {
    return this.paymentNotificationsService.list(user.companyId);
  }

  @Post(':id/read')
  async markAsRead(
    @GetUser() user: AuthenticatedUser,
    @Param('id') notificationId: string,
  ): Promise<PaymentNotificationListItem> {
    if (!this.isUuid(notificationId)) {
      throw new HttpException('Notificacao invalida.', HttpStatus.BAD_REQUEST);
    }

    const notification = await this.paymentNotificationsService.markAsRead(
      user.companyId,
      notificationId,
    );

    if (!notification) {
      throw new HttpException(
        'Notificacao nao encontrada.',
        HttpStatus.NOT_FOUND,
      );
    }

    return notification;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
