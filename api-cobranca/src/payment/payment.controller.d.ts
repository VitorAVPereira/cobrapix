import { PaymentService } from './payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';
declare class CreatePaymentDto {
    invoiceId: string;
    billingType?: 'PIX' | 'BOLETO';
}
declare class CreateBatchPaymentDto {
    invoiceIds: string[];
    billingType?: 'PIX' | 'BOLETO';
}
declare class InvoiceStatusDto {
    status: InvoiceStatus;
}
export declare class PaymentController {
    private readonly paymentService;
    private readonly prisma;
    constructor(paymentService: PaymentService, prisma: PrismaService);
    createPayment(user: any, dto: CreatePaymentDto): Promise<{
        gatewayId: string;
        pixQrCode?: string;
        pixCopyPaste?: string;
        boletoCode?: string;
        expiresAt: Date;
        paymentLink: string;
        success: boolean;
        invoiceId: string;
        billingType: "PIX" | "BOLETO";
    }>;
    createPaymentBatch(user: any, dto: CreateBatchPaymentDto): Promise<{
        success: boolean;
        summary: {
            total: number;
            created: number;
            failed: number;
            billingType: "PIX" | "BOLETO";
        };
        results: {
            invoiceId: string;
            gatewayId: string;
            paymentLink: string;
        }[];
    }>;
    createBoleto(user: any, dto: CreatePaymentDto): Promise<{
        gatewayId: string;
        expiresAt: Date;
        paymentLink: string;
        success: boolean;
        invoiceId: string;
        billingType: string;
    }>;
    createBoletoBatch(user: any, dto: CreateBatchPaymentDto): Promise<{
        success: boolean;
        summary: {
            total: number;
            created: number;
            failed: number;
            billingType: string;
        };
        results: {
            invoiceId: string;
            gatewayId: string;
            paymentLink: string;
        }[];
    }>;
    getPaymentStatus(user: any, invoiceId: string): Promise<{
        invoiceId: string;
        status: import("@prisma/client").$Enums.InvoiceStatus;
        gatewayId: string | null;
        pixPayload: string | null;
        pixExpiresAt: Date | null;
        originalAmount: import("@prisma/client-runtime-utils").Decimal;
        dueDate: Date;
    }>;
    updateInvoiceStatus(user: any, invoiceId: string, dto: InvoiceStatusDto): Promise<{
        success: boolean;
        invoiceId: string;
        status: import("@prisma/client").$Enums.InvoiceStatus;
    }>;
    getPaymentGatewayStatus(): Promise<{
        configured: boolean;
        gateway: string;
    }>;
}
export {};
