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
exports.PaymentController = void 0;
const common_1 = require("@nestjs/common");
const payment_service_1 = require("./payment.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const get_user_decorator_1 = require("../auth/decorators/get-user.decorator");
const prisma_service_1 = require("../prisma/prisma.service");
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
class CreatePaymentDto {
    invoiceId;
    billingType;
}
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreatePaymentDto.prototype, "invoiceId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreatePaymentDto.prototype, "billingType", void 0);
class CreateBatchPaymentDto {
    invoiceIds;
    billingType;
}
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsUUID)('4', { each: true }),
    __metadata("design:type", Array)
], CreateBatchPaymentDto.prototype, "invoiceIds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBatchPaymentDto.prototype, "billingType", void 0);
class InvoiceStatusDto {
    status;
}
__decorate([
    (0, class_validator_1.IsEnum)(client_1.InvoiceStatus),
    __metadata("design:type", String)
], InvoiceStatusDto.prototype, "status", void 0);
let PaymentController = class PaymentController {
    paymentService;
    prisma;
    constructor(paymentService, prisma) {
        this.paymentService = paymentService;
        this.prisma = prisma;
    }
    async createPayment(user, dto) {
        if (!this.paymentService.isConfigured()) {
            throw new common_1.HttpException('Gateway de pagamento não configurado. Configure ASAAS_API_KEY.', common_1.HttpStatus.SERVICE_UNAVAILABLE);
        }
        try {
            const billingType = dto.billingType || 'PIX';
            const result = await this.paymentService.createPayment(dto.invoiceId, user.companyId, billingType);
            return {
                success: true,
                invoiceId: dto.invoiceId,
                billingType,
                ...result,
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.HttpException(error instanceof Error ? error.message : 'Erro ao gerar cobrança', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async createPaymentBatch(user, dto) {
        if (!this.paymentService.isConfigured()) {
            throw new common_1.HttpException('Gateway de pagamento não configurado. Configure ASAAS_API_KEY.', common_1.HttpStatus.SERVICE_UNAVAILABLE);
        }
        try {
            const billingType = dto.billingType || 'PIX';
            const result = await this.paymentService.createPaymentBatch(dto.invoiceIds, user.companyId, billingType);
            return {
                success: true,
                summary: {
                    total: dto.invoiceIds.length,
                    created: result.success,
                    failed: result.failed,
                    billingType,
                },
                results: result.results,
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.HttpException(error instanceof Error ? error.message : 'Erro ao gerar cobranças', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async createBoleto(user, dto) {
        if (!this.paymentService.isConfigured()) {
            throw new common_1.HttpException('Gateway de pagamento não configurado. Configure ASAAS_API_KEY.', common_1.HttpStatus.SERVICE_UNAVAILABLE);
        }
        try {
            const result = await this.paymentService.createBoletoPayment(dto.invoiceId, user.companyId);
            return {
                success: true,
                invoiceId: dto.invoiceId,
                billingType: 'BOLETO',
                ...result,
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.HttpException(error instanceof Error ? error.message : 'Erro ao gerar boleto', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async createBoletoBatch(user, dto) {
        if (!this.paymentService.isConfigured()) {
            throw new common_1.HttpException('Gateway de pagamento não configurado. Configure ASAAS_API_KEY.', common_1.HttpStatus.SERVICE_UNAVAILABLE);
        }
        try {
            const result = await this.paymentService.createBoletoPaymentBatch(dto.invoiceIds, user.companyId);
            return {
                success: true,
                summary: {
                    total: dto.invoiceIds.length,
                    created: result.success,
                    failed: result.failed,
                    billingType: 'BOLETO',
                },
                results: result.results,
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.HttpException(error instanceof Error ? error.message : 'Erro ao gerar boletos', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getPaymentStatus(user, invoiceId) {
        const invoice = await this.prisma.invoice.findFirst({
            where: {
                id: invoiceId,
                companyId: user.companyId,
            },
            include: {
                debtor: true,
            },
        });
        if (!invoice) {
            throw new common_1.HttpException('Fatura não encontrada', common_1.HttpStatus.NOT_FOUND);
        }
        return {
            invoiceId: invoice.id,
            status: invoice.status,
            gatewayId: invoice.gatewayId,
            pixPayload: invoice.pixPayload,
            pixExpiresAt: invoice.pixExpiresAt,
            originalAmount: invoice.originalAmount,
            dueDate: invoice.dueDate,
        };
    }
    async updateInvoiceStatus(user, invoiceId, dto) {
        const invoice = await this.prisma.invoice.findFirst({
            where: {
                id: invoiceId,
                companyId: user.companyId,
            },
        });
        if (!invoice) {
            throw new common_1.HttpException('Fatura não encontrada', common_1.HttpStatus.NOT_FOUND);
        }
        const updated = await this.prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: dto.status },
        });
        await this.prisma.collectionLog.create({
            data: {
                companyId: user.companyId,
                invoiceId: invoice.id,
                actionType: 'STATUS_CHANGED',
                description: `Status alterado para ${dto.status}`,
                status: dto.status,
            },
        });
        return {
            success: true,
            invoiceId: updated.id,
            status: updated.status,
        };
    }
    async getPaymentGatewayStatus() {
        return {
            configured: this.paymentService.isConfigured(),
            gateway: 'asaas',
        };
    }
};
exports.PaymentController = PaymentController;
__decorate([
    (0, common_1.Post)('create'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreatePaymentDto]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "createPayment", null);
__decorate([
    (0, common_1.Post)('create-batch'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateBatchPaymentDto]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "createPaymentBatch", null);
__decorate([
    (0, common_1.Post)('boleto'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreatePaymentDto]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "createBoleto", null);
__decorate([
    (0, common_1.Post)('boleto-batch'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateBatchPaymentDto]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "createBoletoBatch", null);
__decorate([
    (0, common_1.Get)('invoice/:id'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "getPaymentStatus", null);
__decorate([
    (0, common_1.Post)('invoice/:id/status'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, InvoiceStatusDto]),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "updateInvoiceStatus", null);
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PaymentController.prototype, "getPaymentGatewayStatus", null);
exports.PaymentController = PaymentController = __decorate([
    (0, common_1.Controller)('payments'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [payment_service_1.PaymentService,
        prisma_service_1.PrismaService])
], PaymentController);
//# sourceMappingURL=payment.controller.js.map