import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EfiPaymentResult, EfiService } from './efi.service';

type BillingType = 'PIX' | 'BOLETO';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly efiService: EfiService) {}

  async createPayment(
    invoiceId: string,
    companyId: string,
    billingType: BillingType = 'PIX',
  ): Promise<EfiPaymentResult> {
    if (billingType !== 'PIX' && billingType !== 'BOLETO') {
      throw new HttpException(
        'Tipo de cobranca invalido.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.efiService.createPayment(invoiceId, companyId, billingType);
  }

  async createPaymentBatch(
    invoiceIds: string[],
    companyId: string,
    billingType: BillingType = 'PIX',
  ): Promise<{
    success: number;
    failed: number;
    results: Array<{
      invoiceId: string;
      gatewayId: string;
      paymentLink: string;
    }>;
  }> {
    const results: Array<{
      invoiceId: string;
      gatewayId: string;
      paymentLink: string;
    }> = [];
    let success = 0;
    let failed = 0;

    for (const invoiceId of invoiceIds) {
      try {
        const result = await this.createPayment(invoiceId, companyId, billingType);
        results.push({
          invoiceId,
          gatewayId: result.gatewayId,
          paymentLink: result.paymentLink,
        });
        success++;
      } catch (error) {
        this.logger.error(
          `Erro ao criar cobranca Efi para fatura ${invoiceId}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
        failed++;
      }
    }

    return { success, failed, results };
  }

  async createPixPayment(
    invoiceId: string,
    companyId: string,
  ): Promise<EfiPaymentResult> {
    return this.createPayment(invoiceId, companyId, 'PIX');
  }

  async createBoletoPayment(
    invoiceId: string,
    companyId: string,
  ): Promise<EfiPaymentResult> {
    return this.createPayment(invoiceId, companyId, 'BOLETO');
  }

  async createBoletoPaymentBatch(
    invoiceIds: string[],
    companyId: string,
  ): Promise<{
    success: number;
    failed: number;
    results: Array<{
      invoiceId: string;
      gatewayId: string;
      paymentLink: string;
    }>;
  }> {
    return this.createPaymentBatch(invoiceIds, companyId, 'BOLETO');
  }

  isConfigured(): boolean {
    return this.efiService.isConfigured();
  }
}
