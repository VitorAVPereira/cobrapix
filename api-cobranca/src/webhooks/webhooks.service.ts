import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutCardService } from '../checkout/checkout-card.service';
import { EfiService } from '../payment/efi.service';
import {
  CheckoutPaymentsService,
  splitCheckoutPixEvents,
} from '../checkout/checkout-payments.service';

/** Efí payment webhooks. WhatsApp events arrive only through /webhooks/datafy. */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly efiService: EfiService,
    private readonly checkout: CheckoutPaymentsService,
    private readonly checkoutCard: CheckoutCardService,
    private readonly prisma: PrismaService,
  ) {}

  async handleEfiPixWebhook(payload: unknown): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: string;
  }> {
    // Checkout Pix (txid "ckt…", CifraMais account) never reach billing charges.
    const { checkout, rest } = splitCheckoutPixEvents(payload);
    let processed = false;
    for (const event of checkout)
      processed = (await this.checkout.handlePixEvent(event)) || processed;
    if (rest === null) return { processed };
    const billing = await this.efiService.handlePixWebhook(rest);
    return { ...billing, processed: billing.processed || processed };
  }

  async handleEfiChargesWebhook(
    payload: unknown,
    companyId?: string,
    accountId?: string,
  ): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: string;
  }> {
    // Card notices of the CifraMais account belong to the checkout.
    if (accountId) {
      const identity = await this.prisma.efiAccountIdentity.findUnique({
        where: { id: accountId },
        select: { ownership: true },
      });
      const token =
        typeof payload === 'object' && payload !== null
          ? ((payload as Record<string, unknown>).notification ??
            (payload as Record<string, unknown>).token)
          : undefined;
      if (identity?.ownership === 'PLATFORM')
        return {
          processed:
            typeof token === 'string' && token.length > 0 && token.length <= 200
              ? await this.checkoutCard.handleNotification(accountId, token)
              : false,
        };
    }
    return this.efiService.handleChargesWebhook(payload, companyId, accountId);
  }
}
