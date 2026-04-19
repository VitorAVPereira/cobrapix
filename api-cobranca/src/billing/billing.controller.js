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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingController = void 0;
const common_1 = require("@nestjs/common");
const billing_service_1 = require("./billing.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const get_user_decorator_1 = require("../auth/decorators/get-user.decorator");
const prisma_service_1 = require("../prisma/prisma.service");
let BillingController = class BillingController {
    billingService;
    prisma;
    constructor(billingService, prisma) {
        this.billingService = billingService;
        this.prisma = prisma;
    }
    async runBilling(user) {
        try {
            const company = await this.prisma.company.findUnique({
                where: { id: user.companyId },
            });
            if (!company) {
                throw new common_1.HttpException('Não autorizado.', common_1.HttpStatus.UNAUTHORIZED);
            }
            if (company.whatsappStatus !== 'CONNECTED') {
                throw new common_1.HttpException('WhatsApp não está conectado. Conecte antes de executar cobranças.', common_1.HttpStatus.BAD_REQUEST);
            }
            if (!company.whatsappInstanceId) {
                throw new common_1.HttpException('Nenhuma instância WhatsApp configurada.', common_1.HttpStatus.BAD_REQUEST);
            }
            const result = await this.billingService.executeBilling(user.companyId);
            return {
                success: true,
                summary: {
                    total: result.queued + result.skipped,
                    queued: result.queued,
                    skipped: result.skipped,
                },
                message: `Cobrança executada: ${result.queued} mensagens enfileiradas, ${result.skipped} já cobradas hoje.`,
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.HttpException(error instanceof Error ? error.message : 'Falha interna ao executar cobrança.', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.BillingController = BillingController;
__decorate([
    (0, common_1.Post)('run'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "runBilling", null);
exports.BillingController = BillingController = __decorate([
    (0, common_1.Controller)('billing'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [billing_service_1.BillingService,
        prisma_service_1.PrismaService])
], BillingController);
//# sourceMappingURL=billing.controller.js.map