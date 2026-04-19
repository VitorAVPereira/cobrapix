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
exports.WhatsappController = void 0;
const common_1 = require("@nestjs/common");
const whatsapp_service_1 = require("./whatsapp.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const get_user_decorator_1 = require("../auth/decorators/get-user.decorator");
const prisma_service_1 = require("../prisma/prisma.service");
let WhatsappController = class WhatsappController {
    whatsappService;
    prisma;
    constructor(whatsappService, prisma) {
        this.whatsappService = whatsappService;
        this.prisma = prisma;
    }
    async createInstance(user) {
        try {
            const instanceName = `cobrapix_${user.companyId}`;
            await this.whatsappService.createInstance(instanceName);
            await this.prisma.company.update({
                where: { id: user.companyId },
                data: {
                    whatsappInstanceId: instanceName,
                    whatsappStatus: 'PENDING',
                },
            });
            const qrResponse = await this.whatsappService.connectInstance(instanceName);
            if (!qrResponse.code) {
                throw new common_1.HttpException('QR code ainda não foi gerado. Tente novamente em instantes.', common_1.HttpStatus.ACCEPTED);
            }
            return {
                qrCode: qrResponse.code,
                instanceName,
                pairingCode: qrResponse.pairingCode,
            };
        }
        catch (error) {
            throw new common_1.HttpException(error instanceof Error
                ? error.message
                : 'Erro ao criar instância WhatsApp', common_1.HttpStatus.BAD_GATEWAY);
        }
    }
    async getStatus(user) {
        try {
            const company = await this.prisma.company.findUnique({
                where: { id: user.companyId },
                select: { whatsappInstanceId: true, whatsappStatus: true },
            });
            if (!company?.whatsappInstanceId) {
                return {
                    state: 'close',
                    dbStatus: company?.whatsappStatus || 'DISCONNECTED',
                };
            }
            const result = await this.whatsappService.getConnectionState(company.whatsappInstanceId);
            const state = result.instance.state;
            if (state === 'open' && company.whatsappStatus !== 'CONNECTED') {
                await this.prisma.company.update({
                    where: { id: user.companyId },
                    data: { whatsappStatus: 'CONNECTED' },
                });
            }
            else if (state === 'close' && company.whatsappStatus === 'CONNECTED') {
                await this.prisma.company.update({
                    where: { id: user.companyId },
                    data: { whatsappStatus: 'DISCONNECTED' },
                });
            }
            return {
                state,
                dbStatus: state === 'open' ? 'CONNECTED' : company.whatsappStatus,
            };
        }
        catch (error) {
            throw new common_1.HttpException(error instanceof Error ? error.message : 'Erro ao consultar status', common_1.HttpStatus.BAD_GATEWAY);
        }
    }
    async disconnect(user) {
        try {
            const company = await this.prisma.company.findUnique({
                where: { id: user.companyId },
                select: { whatsappInstanceId: true },
            });
            if (!company?.whatsappInstanceId) {
                throw new common_1.HttpException('Nenhuma instância WhatsApp ativa.', common_1.HttpStatus.BAD_REQUEST);
            }
            await this.whatsappService.logoutInstance(company.whatsappInstanceId);
            await this.prisma.company.update({
                where: { id: user.companyId },
                data: {
                    whatsappInstanceId: null,
                    whatsappStatus: 'DISCONNECTED',
                },
            });
            return { success: true };
        }
        catch (error) {
            throw new common_1.HttpException(error instanceof Error ? error.message : 'Erro ao desconectar WhatsApp', common_1.HttpStatus.BAD_GATEWAY);
        }
    }
};
exports.WhatsappController = WhatsappController;
__decorate([
    (0, common_1.Post)('instance'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "createInstance", null);
__decorate([
    (0, common_1.Get)('status'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Post)('disconnect'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappController.prototype, "disconnect", null);
exports.WhatsappController = WhatsappController = __decorate([
    (0, common_1.Controller)('whatsapp'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [whatsapp_service_1.WhatsappService,
        prisma_service_1.PrismaService])
], WhatsappController);
//# sourceMappingURL=whatsapp.controller.js.map