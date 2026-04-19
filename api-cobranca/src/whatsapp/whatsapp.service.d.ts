import { ConfigService } from '@nestjs/config';
export interface CreateInstanceResponse {
    instance: {
        instanceName: string;
        instanceId: string;
        status: string;
    };
    hash: {
        apikey: string;
    };
}
export interface ConnectInstanceResponse {
    pairingCode?: string;
    code: string;
    count: number;
}
export interface ConnectionStateResponse {
    instance: {
        state: 'open' | 'close' | 'connecting';
    };
}
export interface SendTextResponse {
    key: {
        remoteJid: string;
        fromMe: boolean;
        id: string;
    };
    messageTimestamp: string;
    status: string;
}
export declare class WhatsappService {
    private configService;
    private readonly logger;
    private readonly baseUrl;
    private readonly apiKey;
    constructor(configService: ConfigService);
    private evolutionFetch;
    createInstance(instanceName: string): Promise<CreateInstanceResponse>;
    connectInstance(instanceName: string): Promise<ConnectInstanceResponse>;
    getConnectionState(instanceName: string): Promise<ConnectionStateResponse>;
    sendTextMessage(instanceName: string, phoneNumber: string, text: string): Promise<SendTextResponse>;
    logoutInstance(instanceName: string): Promise<void>;
}
