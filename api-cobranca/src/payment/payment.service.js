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
var PaymentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
let PaymentService = PaymentService_1 = class PaymentService {
    config;
    prisma;
    logger = new common_1.Logger(PaymentService_1.name);
    asaasApiUrl;
    asaasApiKey;
    constructor(config, prisma) {
        this.config = config;
        this.prisma = prisma;
        this.asaasApiUrl = this.config.get('ASAAS_API_URL') || 'https://sandbox.asaas.com/api/v3';
        this.asaasApiKey = this.config.get('ASAAS_API_KEY');
    }
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'access_token': this.asaasApiKey || '',
        };
    }
    async getOrCreateAsaasCustomer(companyId, debtor) {
        const company = await this.prisma.company.findUnique({
            where: { id: companyId },
        });
        if (!company) {
            throw new common_1.HttpException('Empresa não encontrada', common_1.HttpStatus.NOT_FOUND);
        }
        const existingCustomerId = company.gatewayToken;
        if (existingCustomerId) {
            return existingCustomerId;
        }
        const customerData = {
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
            throw new common_1.HttpException('Falha ao criar cliente no gateway de pagamento', common_1.HttpStatus.BAD_GATEWAY);
        }
        const customer = await response.json();
        await this.prisma.company.update({
            where: { id: companyId },
            data: { gatewayToken: customer.id },
        });
        return customer.id;
    }
    async createPayment(invoiceId, companyId, billingType = 'PIX') {
        const invoice = await this.prisma.invoice.findUnique({
            where: { id: invoiceId },
            include: { debtor: true, company: true },
        });
        if (!invoice) {
            throw new common_1.HttpException('Fatura não encontrada', common_1.HttpStatus.NOT_FOUND);
        }
        if (invoice.companyId !== companyId) {
            throw new common_1.HttpException('Acesso negado', common_1.HttpStatus.FORBIDDEN);
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
        const formattedDueDate = dueDate.toISOString().split('T')[0];
        const paymentRequest = {
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
            throw new common_1.HttpException('Falha ao gerar cobrança PIX', common_1.HttpStatus.BAD_GATEWAY);
        }
        const payment = await response.json();
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
    async createPaymentBatch(invoiceIds, companyId, billingType = 'PIX') {
        const results = [];
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
            }
            catch (error) {
                this.logger.error(`Erro ao criar pagamento para fatura ${invoiceId}:`, error);
                failed++;
            }
        }
        return { success, failed, results };
    }
    async createPixPayment(invoiceId, companyId) {
        return this.createPayment(invoiceId, companyId, 'PIX');
    }
    async createBoletoPayment(invoiceId, companyId) {
        return this.createPayment(invoiceId, companyId, 'BOLETO');
    }
    async createBoletoPaymentBatch(invoiceIds, companyId) {
        return this.createPaymentBatch(invoiceIds, companyId, 'BOLETO');
    }
    async fetchAsaasPayment(paymentId) {
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
        }
        catch (error) {
            this.logger.error(`Erro ao buscar pagamento ${paymentId}:`, error);
            return null;
        }
    }
    async handleWebhook(payload) {
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
    isConfigured() {
        return !!this.asaasApiKey;
    }
};
exports.PaymentService = PaymentService;
exports.PaymentService = PaymentService = PaymentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], PaymentService);
//# sourceMappingURL=payment.service.js.map