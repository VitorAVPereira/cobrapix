import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CardPaymentService } from './card-payment.service';
import {
  CardPayDto,
  CardQuoteDto,
  CardSettingsDto,
} from './dto/card-payment.dto';
import { CardCheckoutGuard } from './card-checkout.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Controller('payments/public/:token/card')
@UseGuards(CardCheckoutGuard, ThrottleGuard)
export class CardPublicPaymentController {
  constructor(private readonly cards: CardPaymentService) {}
  @Post('quote') quote(
    @Param('token') token: string,
    @Body() dto: CardQuoteDto,
  ) {
    return this.cards.quote(token, dto.brand);
  }
  @Post('pay') pay(
    @Param('token') token: string,
    @Body() dto: CardPayDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.cards.pay(token, dto, key);
  }
}
@Controller('admin/card-payments')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class CardAdminPaymentController {
  constructor(
    private readonly cards: CardPaymentService,
    private readonly prisma: PrismaService,
  ) {}
  @Get(':companyId/settings') async settings(
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        activeFinancialProfile: { select: { issuerIdentityId: true } },
      },
    });
    return {
      activeIssuerIdentityId:
        company.activeFinancialProfile?.issuerIdentityId ?? null,
      settings: await this.prisma.cardPaymentSettings.findMany({
        where: { companyId },
        orderBy: { updatedAt: 'desc' },
      }),
    };
  }
  @Post(':companyId/settings') configure(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CardSettingsDto,
  ) {
    return this.cards.configure(companyId, user.userId, dto);
  }
  @Get(':companyId/attempts') async attempts(
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    const attempts = await this.prisma.cardPaymentAttempt.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        invoiceId: true,
        paymentChargeId: true,
        status: true,
        installments: true,
        totalCents: true,
        providerStatus: true,
        createdAt: true,
      },
    });
    const anomalies = await this.prisma.paymentWebhookAnomaly.findMany({
      where: {
        companyId,
        source: 'CARD',
        externalReference: { in: attempts.map((a) => a.id) },
      },
      select: { externalReference: true },
    });
    return attempts.map((attempt) => ({
      ...attempt,
      reviewRequired: anomalies.some((a) => a.externalReference === attempt.id),
    }));
  }
  @Post(':companyId/attempts/:attemptId/reconcile') reconcile(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ) {
    return this.cards.reconcileAttempt(attemptId, companyId);
  }
}
