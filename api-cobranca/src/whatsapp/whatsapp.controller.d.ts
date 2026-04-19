import { WhatsappService } from './whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
export declare class WhatsappController {
    private readonly whatsappService;
    private readonly prisma;
    constructor(whatsappService: WhatsappService, prisma: PrismaService);
    createInstance(user: any): Promise<{
        qrCode: string;
        instanceName: string;
        pairingCode: string | undefined;
    }>;
    getStatus(user: any): Promise<{
        state: string;
        dbStatus: import("@prisma/client").$Enums.WhatsappStatus;
    }>;
    disconnect(user: any): Promise<{
        success: boolean;
    }>;
}
