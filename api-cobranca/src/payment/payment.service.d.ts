import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export declare class PaymentService {
    private readonly config;
    private readonly prisma;
    private readonly logger;
    private readonly asaasApiUrl;
    private readonly asaasApiKey;
    constructor(config: ConfigService, prisma: PrismaService);
    private getHeaders;
    getOrCreateAsaasCustomer(companyId: string, debtor: {
        name: string;
        document?: string | null;
        email?: string | null;
        phoneNumber: string;
    }): Promise<string>;
    createPayment(invoiceId: string, companyId: string, billingType?: 'PIX' | 'BOLETO'): Promise<{
        gatewayId: string;
        pixQrCode?: string;
        pixCopyPaste?: string;
        boletoCode?: string;
        expiresAt: Date;
        paymentLink: string;
    }>;
    createPaymentBatch(invoiceIds: string[], companyId: string, billingType?: 'PIX' | 'BOLETO'): Promise<{
        success: number;
        failed: number;
        results: Array<{
            invoiceId: string;
            gatewayId: string;
            paymentLink: string;
        }>;
    }>;
    createPixPayment(invoiceId: string, companyId: string): Promise<{
        gatewayId: string;
        pixQrCode?: string;
        pixCopyPaste?: string;
        expiresAt: Date;
        paymentLink: string;
    }>;
    createBoletoPayment(invoiceId: string, companyId: string): Promise<{
        gatewayId: string;
        expiresAt: Date;
        paymentLink: string;
    }>;
    createBoletoPaymentBatch(invoiceIds: string[], companyId: string): Promise<{
        success: number;
        failed: number;
        results: Array<{
            invoiceId: string;
            gatewayId: string;
            paymentLink: string;
        }>;
    }>;
    private fetchAsaasPayment;
    handleWebhook(payload: {
        payment: string;
        event: string;
        status?: string;
    }): Promise<void>;
    isConfigured(): boolean;
}
