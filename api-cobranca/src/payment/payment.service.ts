import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EfiPaymentResult, EfiService } from './efi.service';

type BillingType = 'PIX' | 'BOLETO' | 'BOLIX';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly efiService: EfiService) {}

  async createPayment(
    invoiceId: string,
    companyId: string,
    billingType: BillingType = 'PIX',
  ): Promise<EfiPaymentResult> {
    if (
      billingType !== 'PIX' &&
      billingType !== 'BOLETO' &&
      billingType !== 'BOLIX'
    ) {
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

    const CHUNK_SIZE = 10;
    for (let i = 0; i < invoiceIds.length; i += CHUNK_SIZE) {
      const chunk = invoiceIds.slice(i, i + CHUNK_SIZE);
      const settled = await Promise.allSettled(
        chunk.map((invoiceId) =>
          this.createPayment(invoiceId, companyId, billingType).then(
            (result) => ({
              invoiceId,
              gatewayId: result.gatewayId,
              paymentLink: result.paymentLink,
            }),
          ),
        ),
      );

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
          success++;
        } else {
          this.logger.error(
            `Erro ao criar cobranca Efi em lote: ${
              outcome.reason instanceof Error
                ? outcome.reason.message
                : 'erro desconhecido'
            }`,
          );
          failed++;
        }
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

  async createBolixPayment(
    invoiceId: string,
    companyId: string,
  ): Promise<EfiPaymentResult> {
    return this.createPayment(invoiceId, companyId, 'BOLIX');
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
