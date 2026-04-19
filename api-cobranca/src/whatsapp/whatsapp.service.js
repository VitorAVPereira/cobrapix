"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var WhatsappService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let WhatsappService = WhatsappService_1 = class WhatsappService {
    configService;
    logger = new common_1.Logger(WhatsappService_1.name);
    baseUrl;
    apiKey;
    constructor(configService) {
        this.configService = configService;
        this.baseUrl = this.configService.get('EVOLUTION_API_URL') || 'http://localhost:8080';
        this.apiKey = this.configService.getOrThrow('EVOLUTION_API_KEY');
    }
    async evolutionFetch(path, options = {}) {
        const url = `${this.baseUrl}/api/v1${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                apikey: this.apiKey,
                ...options.headers,
            },
        });
        return res;
    }
    async createInstance(instanceName) {
        const webhookUrl = this.configService.get('EVOLUTION_WEBHOOK_URL') ||
            `${this.configService.get('FRONTEND_URL') || 'http://localhost:3000'}/webhooks/evolution`;
        const res = await this.evolutionFetch('/instance/create', {
            method: 'POST',
            body: JSON.stringify({
                instanceName,
                integration: 'WHATSAPP-BAILEYS',
                qrcode: true,
                webhook: {
                    url: webhookUrl,
                    webhook_by_events: false,
                    webhook_base64: false,
                    events: ['CONNECTION_UPDATE'],
                },
            }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Evolution API: falha ao criar instância (${res.status}): ${body}`);
        }
        return res.json();
    }
    async connectInstance(instanceName) {
        const res = await this.evolutionFetch(`/instance/connect/${instanceName}`);
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Evolution API: falha ao obter QR code (${res.status}): ${body}`);
        }
        return res.json();
    }
    async getConnectionState(instanceName) {
        const res = await this.evolutionFetch(`/instance/connectionState/${instanceName}`);
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Evolution API: falha ao consultar status (${res.status}): ${body}`);
        }
        return res.json();
    }
    async sendTextMessage(instanceName, phoneNumber, text) {
        const res = await this.evolutionFetch(`/message/sendText/${instanceName}`, {
            method: 'POST',
            body: JSON.stringify({ number: phoneNumber, text }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Evolution API: falha ao enviar mensagem (${res.status}): ${body}`);
        }
        return res.json();
    }
    async logoutInstance(instanceName) {
        const res = await this.evolutionFetch(`/instance/logout/${instanceName}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Evolution API: falha ao desconectar (${res.status}): ${body}`);
        }
    }
};
exports.WhatsappService = WhatsappService;
exports.WhatsappService = WhatsappService = WhatsappService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], WhatsappService);
//# sourceMappingURL=whatsapp.service.js.map