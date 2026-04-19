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
var WebhooksService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
let WebhooksService = WebhooksService_1 = class WebhooksService {
    configService;
    prisma;
    logger = new common_1.Logger(WebhooksService_1.name);
    constructor(configService, prisma) {
        this.configService = configService;
        this.prisma = prisma;
    }
    async handleEvolutionWebhook(payload) {
        if (payload.event !== 'connection.update') {
            return { ignored: true, updated: false };
        }
        const instanceName = payload.instance;
        const state = payload.data?.state;
        if (!instanceName || !state) {
            this.logger.warn('Payload inválido: instance ou state ausente');
            throw new Error('Payload inválido: instance ou state ausente');
        }
        const expectedKey = this.configService.get('EVOLUTION_API_KEY');
        if (expectedKey && payload.apikey !== expectedKey) {
            this.logger.warn(`Webhook Evolution: apikey inválida para instância ${instanceName}`);
            throw new Error('Não autorizado');
        }
        const company = await this.prisma.company.findFirst({
            where: { whatsappInstanceId: instanceName },
        });
        if (!company) {
            this.logger.warn(`Webhook Evolution: instância ${instanceName} não pertence a nenhuma empresa`);
            return { ignored: true, updated: false };
        }
        const newStatus = state === 'open'
            ? 'CONNECTED'
            : state === 'close' || state === 'refused'
                ? 'DISCONNECTED'
                : null;
        if (!newStatus || company.whatsappStatus === newStatus) {
            return { ignored: true, updated: false };
        }
        await this.prisma.company.update({
            where: { id: company.id },
            data: { whatsappStatus: newStatus },
        });
        this.logger.log(`Webhook Evolution: ${instanceName} → ${state} → status atualizado para ${newStatus}`);
        return { updated: true, status: newStatus };
    }
    async handleAsaasWebhook(payload) {
        const { event, payment, status } = payload;
        if (!payment) {
            this.logger.warn('Webhook Asaas: payment não presente no payload');
            return { processed: false };
        }
        if (!event || !event.startsWith('PAYMENT_')) {
            this.logger.log(`Webhook Asaas: evento ignorado - ${event}`);
            return { processed: false };
        }
        const invoice = await this.prisma.invoice.findFirst({
            where: { gatewayId: payment },
        });
        if (!invoice) {
            this.logger.warn(`Webhook Asaas: fatura não encontrada para gatewayId ${payment}`);
            return { processed: false };
        }
        let newStatus = null;
        if (status === 'CONFIRMED' || status === 'RECEIVED' || status === 'PAID') {
            newStatus = 'PAID';
        }
        else if (status === 'CANCELED' || status === 'EXPIRED' || status === 'REJECTED') {
            newStatus = 'CANCELED';
        }
        if (!newStatus) {
            this.logger.log(`Webhook Asaas: status ${status} não requer atualização`);
            return { processed: false };
        }
        if (invoice.status === newStatus) {
            this.logger.log(`Webhook Asaas: fatura ${invoice.id} já está com status ${newStatus}`);
            return { processed: true, invoiceId: invoice.id, status: newStatus };
        }
        await this.prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: newStatus },
        });
        await this.prisma.collectionLog.create({
            data: {
                companyId: invoice.companyId,
                invoiceId: invoice.id,
                actionType: 'PAYMENT_WEBHOOK',
                description: `Pagamento atualizado via webhook: ${event} - ${status}`,
                status: newStatus,
            },
        });
        this.logger.log(`Webhook Asaas: fatura ${invoice.id} atualizada para ${newStatus} (evento: ${event})`);
        return { processed: true, invoiceId: invoice.id, status: newStatus };
    }
};
exports.WebhooksService = WebhooksService;
exports.WebhooksService = WebhooksService = WebhooksService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], WebhooksService);
//# sourceMappingURL=webhooks.service.js.map