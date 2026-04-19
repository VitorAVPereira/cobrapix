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
var MessageWorkerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageWorkerService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("bullmq");
const prisma_service_1 = require("../../prisma/prisma.service");
const rate_limit_service_1 = require("../services/rate-limit.service");
let MessageWorkerService = MessageWorkerService_1 = class MessageWorkerService {
    configService;
    prisma;
    rateLimitService;
    logger = new common_1.Logger(MessageWorkerService_1.name);
    worker;
    baseUrl;
    apiKey;
    constructor(configService, prisma, rateLimitService) {
        this.configService = configService;
        this.prisma = prisma;
        this.rateLimitService = rateLimitService;
        this.baseUrl = this.configService.get('EVOLUTION_API_URL') || 'http://localhost:8080';
        this.apiKey = this.configService.getOrThrow('EVOLUTION_API_KEY');
    }
    onModuleInit() {
        const redisHost = this.configService.get('REDIS_HOST') || 'localhost';
        const redisPort = this.configService.get('REDIS_PORT') || 6379;
        const redisPassword = this.configService.get('REDIS_PASSWORD');
        this.worker = new bullmq_1.Worker('whatsapp-messages', async (job) => {
            await this.processJob(job);
        }, {
            connection: {
                host: redisHost,
                port: redisPort,
                password: redisPassword,
            },
            concurrency: 5,
            limiter: {
                max: 10,
                duration: 1000,
            },
        });
        this.worker.on('completed', (job) => {
            this.logger.log(`Job ${job.id} completado com sucesso`);
        });
        this.worker.on('failed', (job, err) => {
            this.logger.error(`Job ${job?.id} falhou: ${err.message}`);
        });
        this.worker.on('error', (err) => {
            this.logger.error('Worker error:', err);
        });
        this.logger.log('WhatsApp message worker iniciado');
    }
    async onModuleDestroy() {
        if (this.worker) {
            await this.worker.close();
            this.logger.log('WhatsApp message worker parado');
        }
    }
    async processJob(job) {
        const data = job.data;
        const { invoiceId, companyId, phoneNumber, instanceName, message, debtorName } = data;
        this.logger.log(`Processando mensagem para ${debtorName} (${phoneNumber})`);
        const rateLimitResult = await this.rateLimitService.checkRateLimit(phoneNumber);
        if (!rateLimitResult.allowed) {
            this.logger.warn(`Rate limit atingido para ${phoneNumber}. Agendando retry em ${rateLimitResult.resetAt - Date.now()}ms`);
            const delay = Math.max(rateLimitResult.resetAt - Date.now(), 0);
            throw new Error(`Rate limit: retry after ${delay}ms`);
        }
        try {
            const response = await this.sendMessageViaEvolution(instanceName, phoneNumber, message);
            await this.prisma.collectionLog.create({
                data: {
                    companyId,
                    invoiceId,
                    actionType: 'WHATSAPP_SENT',
                    description: `Mensagem de cobrança enviada para ${debtorName} (${phoneNumber}) - ID: ${response.key.id}`,
                    status: 'SENT',
                },
            });
            this.logger.log(`Mensagem enviada com sucesso para ${phoneNumber}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            await this.prisma.collectionLog.create({
                data: {
                    companyId,
                    invoiceId,
                    actionType: 'WHATSAPP_SENT',
                    description: `Falha ao enviar para ${debtorName}: ${errorMessage}`,
                    status: 'FAILED',
                },
            });
            this.logger.error(`Erro ao enviar mensagem para ${phoneNumber}:`, errorMessage);
            throw error;
        }
    }
    async sendMessageViaEvolution(instanceName, phoneNumber, text) {
        const url = `${this.baseUrl}/api/v1/message/sendText/${instanceName}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: this.apiKey,
            },
            body: JSON.stringify({ number: phoneNumber, text }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Evolution API: falha ao enviar mensagem (${res.status}): ${body}`);
        }
        return res.json();
    }
};
exports.MessageWorkerService = MessageWorkerService;
exports.MessageWorkerService = MessageWorkerService = MessageWorkerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService,
        rate_limit_service_1.RateLimitService])
], MessageWorkerService);
//# sourceMappingURL=message.worker.js.map