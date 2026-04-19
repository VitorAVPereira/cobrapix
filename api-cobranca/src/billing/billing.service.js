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
var BillingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../prisma/prisma.service");
const message_queue_1 = require("../queue/message.queue");
const spintax_service_1 = require("../queue/services/spintax.service");
let BillingService = BillingService_1 = class BillingService {
    prisma;
    messageQueue;
    spintaxService;
    logger = new common_1.Logger(BillingService_1.name);
    isRunning = false;
    constructor(prisma, messageQueue, spintaxService) {
        this.prisma = prisma;
        this.messageQueue = messageQueue;
        this.spintaxService = spintaxService;
    }
    async runScheduledBilling() {
        if (this.isRunning) {
            this.logger.log('Cobrança automática já está em execução. Pulando...');
            return;
        }
        this.isRunning = true;
        this.logger.log('Iniciando execução de cobranças automáticas...');
        try {
            const lockResult = await this.prisma.$queryRaw `
        SELECT pg_try_advisory_lock(1) as locked
      `;
            if (!lockResult[0]?.locked) {
                this.logger.log('Outra instância está executando cobranças. Pulando...');
                return;
            }
            try {
                const companies = await this.prisma.company.findMany({
                    where: {
                        whatsappStatus: 'CONNECTED',
                        whatsappInstanceId: { not: null },
                    },
                });
                this.logger.log(`Encontradas ${companies.length} empresas com WhatsApp conectado`);
                let totalQueued = 0;
                let totalSkipped = 0;
                for (const company of companies) {
                    const result = await this.queueBillingForCompany(company.id);
                    totalQueued += result.queued;
                    totalSkipped += result.skipped;
                }
                this.logger.log(`Resumo geral: ${totalQueued} mensagens enfileiradas, ${totalSkipped} puladas`);
            }
            finally {
                await this.prisma.$queryRaw `SELECT pg_advisory_unlock(1)`;
            }
        }
        catch (error) {
            this.logger.error('Erro ao executar cobranças automáticas:', error);
        }
        finally {
            this.isRunning = false;
        }
    }
    async executeBilling(companyId) {
        return this.queueBillingForCompany(companyId);
    }
    async queueBillingForCompany(companyId) {
        try {
            const company = await this.prisma.company.findUnique({
                where: { id: companyId },
            });
            if (!company || company.whatsappStatus !== 'CONNECTED' || !company.whatsappInstanceId) {
                this.logger.log(`Empresa ${companyId} não está pronta para cobranças`);
                return { queued: 0, skipped: 0 };
            }
            const endOfToday = new Date();
            endOfToday.setHours(23, 59, 59, 999);
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const overdueInvoices = await this.prisma.invoice.findMany({
                where: {
                    companyId: company.id,
                    status: 'PENDING',
                    dueDate: { lte: endOfToday },
                },
                include: {
                    debtor: true,
                    collectionLogs: {
                        where: {
                            createdAt: { gte: startOfToday },
                            actionType: 'WHATSAPP_SENT',
                        },
                    },
                },
            });
            const jobs = [];
            let skippedCount = 0;
            for (const invoice of overdueInvoices) {
                if (invoice.collectionLogs.length > 0) {
                    skippedCount++;
                    continue;
                }
                let phone = invoice.debtor.phoneNumber;
                if (!phone.startsWith('55')) {
                    phone = `55${phone}`;
                }
                const message = this.spintaxService.buildCollectionMessage({
                    debtorName: invoice.debtor.name,
                    originalAmount: Number(invoice.originalAmount),
                    dueDate: invoice.dueDate,
                    companyName: company.corporateName,
                });
                jobs.push({
                    invoiceId: invoice.id,
                    companyId: company.id,
                    phoneNumber: phone,
                    instanceName: company.whatsappInstanceId,
                    message,
                    debtorName: invoice.debtor.name,
                });
            }
            if (jobs.length > 0) {
                await this.messageQueue.addBulkSendMessageJobs(jobs);
                this.logger.log(`Empresa ${company.corporateName}: ${jobs.length} mensagens enfileiradas, ${skippedCount} puladas`);
            }
            else {
                this.logger.log(`Empresa ${company.corporateName}: nenhuma mensagem para enviar, ${skippedCount} puladas`);
            }
            return { queued: jobs.length, skipped: skippedCount };
        }
        catch (error) {
            this.logger.error(`Erro ao executar cobranças para empresa ${companyId}:`, error);
            return { queued: 0, skipped: 0 };
        }
    }
};
exports.BillingService = BillingService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_9AM),
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_5PM),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BillingService.prototype, "runScheduledBilling", null);
exports.BillingService = BillingService = BillingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        message_queue_1.MessageQueueService,
        spintax_service_1.SpintaxService])
], BillingService);
//# sourceMappingURL=billing.service.js.map