import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { EfiService } from './efi.service';

// A reservation or submission older than this without a confirmed result is
// shown for reconciliation; it is never resubmitted automatically.
const STALE_ISSUANCE_MS = 10 * 60_000;

@Controller('admin/payment-charges')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PaymentAdminController {
  constructor(
    private readonly efi: EfiService,
    private readonly prisma: PrismaService,
  ) {}

  // Charges of one company whose issuance needs an administrative look:
  // uncertain or stuck submissions and provider mode mismatches.
  @Get(':companyId/attention')
  attention(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.prisma.paymentCharge.findMany({
      where: {
        companyId,
        OR: [
          {
            status: { in: ['DRAFT', 'PENDING'] },
            updatedAt: { lte: new Date(Date.now() - STALE_ISSUANCE_MS) },
          },
          { gatewayStatusRaw: 'EFI_BILLING_MODE_MISMATCH' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        invoiceId: true,
        billingMethod: true,
        status: true,
        gatewayStatusRaw: true,
        grossAmountCents: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  @Post(':companyId/:chargeId/reconcile')
  reconcile(
    @GetUser() user: AuthenticatedUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
  ): Promise<{ status: string }> {
    return this.efi.reconcileCharge(companyId, chargeId, user.userId);
  }
}
