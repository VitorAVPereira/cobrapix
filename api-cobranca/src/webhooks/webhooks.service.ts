import { Injectable } from '@nestjs/common';
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
    return this.efiService.handleChargesWebhook(payload, companyId, accountId);
  }
}
