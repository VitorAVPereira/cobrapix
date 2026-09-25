import { Injectable } from '@nestjs/common';
import { EfiService } from '../payment/efi.service';

/** Efí payment webhooks. WhatsApp events arrive only through /webhooks/datafy. */
@Injectable()
export class WebhooksService {
  constructor(private readonly efiService: EfiService) {}

  async handleEfiPixWebhook(payload: unknown): Promise<{
    processed: boolean;
    invoiceId?: string;
    status?: string;
  }> {
    return this.efiService.handlePixWebhook(payload);
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
