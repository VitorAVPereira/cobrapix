import { PrismaService } from '../prisma/prisma.service';
interface ImportRow {
    name: string;
    phone_number: string;
    email?: string;
    original_amount: number;
    due_date: string;
}
export declare class InvoicesService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(companyId: string): Promise<{
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
    importCsv(companyId: string, rows: ImportRow[]): Promise<{
        success: boolean;
        count: number;
    }>;
    private parseDueDate;
}
export {};
