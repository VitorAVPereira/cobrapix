import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
}

interface AsaasPaymentResponse {
  id: string;
  customer: string;
  billingType: string;
  value: number;
  dueDate: string;
  paymentLink?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  status: string;
  dateCreated: string;
}

interface AsaasCreatePaymentRequest {
  customer: string;
  billingType: string;
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly asaasApiUrl: string;
  private readonly asaasApiKey: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.asaasApiUrl = this.config.get<string>('ASAAS_API_URL') || 'https://sandbox.asaas.com/api/v3';
    this.asaasApiKey = this.config.get<string>('ASAAS_API_KEY');
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'access_token': this.asaasApiKey || '',
    };
  }

  async getOrCreateAsaasCustomer(companyId: string, debtor: {
    name: string;
    document?: string | null;
    email?: string | null;
    phoneNumber: string;
  }): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new HttpException('Empresa não encontrada', HttpStatus.NOT_FOUND);
    }

    const existingCustomerId = company.gatewayToken;
    if (existingCustomerId) {
      return existingCustomerId;
    }

    const customerData: Record<string, string> = {
      name: debtor.name,
      cpfCnpj: debtor.document || '00000000000',
      phone: debtor.phoneNumber,
    };

    if (debtor.email) {
      customerData.email = debtor.email;
    }

    const response = await fetch(`${this.asaasApiUrl}/customers`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(customerData),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Erro ao criar customer no Asaas: ${error}`);
      throw new HttpException(
        'Falha ao criar cliente no gateway de pagamento',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const customer: AsaasCustomer = await response.json();

    await this.prisma.company.update({
      where: { id: companyId },
      data: { gatewayToken: customer.id },
    });

    return customer.id;
  }

  async createPayment(
    invoiceId: string,
    companyId: string,
    billingType: 'PIX' | 'BOLETO' = 'PIX',
  ): Promise<{
    gatewayId: string;
    pixQrCode?: string;
    pixCopyPaste?: string;
    boletoCode?: string;
    expiresAt: Date;
    paymentLink: string;
  }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { debtor: true, company: true },
    });

    if (!invoice) {
      throw new HttpException('Fatura não encontrada', HttpStatus.NOT_FOUND);
    }

    if (invoice.companyId !== companyId) {
      throw new HttpException('Acesso negado', HttpStatus.FORBIDDEN);
    }

    if (invoice.gatewayId) {
      const existingPayment = await this.fetchAsaasPayment(invoice.gatewayId);
      if (existingPayment) {
        return {
          gatewayId: existingPayment.id,
          pixQrCode: existingPayment.pixQrCode,
          pixCopyPaste: existingPayment.pixCopyPaste,
          expiresAt: new Date(existingPayment.dueDate),
          paymentLink: existingPayment.paymentLink || '',
        };
      }
    }

    const customerId = await this.getOrCreateAsaasCustomer(companyId, {
      name: invoice.debtor.name,
      document: invoice.debtor.document,
      email: invoice.debtor.email,
      phoneNumber: invoice.debtor.phoneNumber,
    });

    const dueDate = new Date(invoice.dueDate);
    const formattedDueDate = dueDate.toISOString().split('T')[0] as string;

    const paymentRequest: AsaasCreatePaymentRequest = {
      customer: customerId,
      billingType,
      value: Number(invoice.originalAmount),
      dueDate: formattedDueDate,
      description: `Cobranca #${invoice.id.slice(0, 8)}`,
      externalReference: invoice.id,
    };

    const response = await fetch(`${this.asaasApiUrl}/payments`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(paymentRequest),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Erro ao criar pagamento no Asaas: ${error}`);
      throw new HttpException(
        'Falha ao gerar cobrança PIX',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const payment: AsaasPaymentResponse = await response.json();

    const expiresAt = new Date(payment.dueDate);
    expiresAt.setDate(expiresAt.getDate() + 1);

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        gatewayId: payment.id,
        pixPayload: payment.pixQrCode || payment.pixCopyPaste || '',
        pixExpiresAt: expiresAt,
      },
    });

    return {
      gatewayId: payment.id,
      pixQrCode: payment.pixQrCode,
      pixCopyPaste: payment.pixCopyPaste,
      expiresAt,
      paymentLink: payment.paymentLink || '',
    };
  }

  async createPaymentBatch(
    invoiceIds: string[],
    companyId: string,
    billingType: 'PIX' | 'BOLETO' = 'PIX',
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
        this.logger.error(`Erro ao criar pagamento para fatura ${invoiceId}:`, error);
        failed++;
      }
    }

    return { success, failed, results };
  }

  async createPixPayment(invoiceId: string, companyId: string): Promise<{
    gatewayId: string;
    pixQrCode?: string;
    pixCopyPaste?: string;
    expiresAt: Date;
    paymentLink: string;
  }> {
    return this.createPayment(invoiceId, companyId, 'PIX');
  }

  async createBoletoPayment(invoiceId: string, companyId: string): Promise<{
    gatewayId: string;
    expiresAt: Date;
    paymentLink: string;
  }> {
    return this.createPayment(invoiceId, companyId, 'BOLETO');
  }

  async createBoletoPaymentBatch(invoiceIds: string[], companyId: string): Promise<{
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

  private async fetchAsaasPayment(paymentId: string): Promise<AsaasPaymentResponse | null> {
    if (!this.asaasApiKey) {
      this.logger.warn('ASAAS_API_KEY não configurada, retornando null');
      return null;
    }

    try {
      const response = await fetch(`${this.asaasApiUrl}/payments/${paymentId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Erro ao buscar pagamento ${paymentId}:`, error);
      return null;
    }
  }

  async handleWebhook(payload: {
    payment: string;
    event: string;
    status?: string;
  }): Promise<void> {
    const { payment: gatewayId, event, status } = payload;

    if (event !== 'PAYMENT_RECEIVED' && event !== 'PAYMENT_CONFIRMED') {
      this.logger.log(`Evento de payment ignorado: ${event}`);
      return;
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { gatewayId },
    });

    if (!invoice) {
      this.logger.warn(`Fatura não encontrada para gatewayId: ${gatewayId}`);
      return;
    }

    if (status === 'CONFIRMED' || status === 'RECEIVED' || status === 'PAID') {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID' },
      });

      await this.prisma.collectionLog.create({
        data: {
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          actionType: 'PAYMENT_RECEIVED',
          description: `Pagamento confirmado via gateway (${gatewayId})`,
          status: 'CONFIRMED',
        },
      });

      this.logger.log(`Fatura ${invoice.id} marcada como PAGA`);
    }
  }

  isConfigured(): boolean {
    return !!this.asaasApiKey;
  }
}