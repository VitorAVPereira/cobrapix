import { InvoicesService } from './invoices.service';
export declare class InvoicesController {
    private readonly invoicesService;
    constructor(invoicesService: InvoicesService);
    findAll(user: any): Promise<{
        id: string;
        name: string;
        phone_number: string;
        email: string | undefined;
        original_amount: number;
        due_date: string | undefined;
        status: import("@prisma/client").$Enums.InvoiceStatus;
        debtorId: string;
        gatewayId: string | null;
        pixPayload: string | null;
        createdAt: string;
    }[]>;
    importCsv(user: any, body: any[]): Promise<{
        success: boolean;
        count: number;
    }>;
    private validateRow;
}
