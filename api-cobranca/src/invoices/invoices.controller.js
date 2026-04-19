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
exports.InvoicesController = void 0;
const common_1 = require("@nestjs/common");
const invoices_service_1 = require("./invoices.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const get_user_decorator_1 = require("../auth/decorators/get-user.decorator");
let InvoicesController = class InvoicesController {
    invoicesService;
    constructor(invoicesService) {
        this.invoicesService = invoicesService;
    }
    async findAll(user) {
        return this.invoicesService.findAll(user.companyId);
    }
    async importCsv(user, body) {
        if (!Array.isArray(body) || body.length === 0) {
            throw new common_1.HttpException('Nenhum dado recebido.', common_1.HttpStatus.BAD_REQUEST);
        }
        if (body.length > 5000) {
            throw new common_1.HttpException('Limite máximo de 5000 linhas por importação.', common_1.HttpStatus.BAD_REQUEST);
        }
        const errors = [];
        const validRows = [];
        for (let i = 0; i < body.length; i++) {
            const row = body[i];
            const err = this.validateRow(row, i);
            if (err) {
                errors.push(err);
                if (errors.length >= 10)
                    break;
            }
            else {
                validRows.push({
                    name: row.name?.trim(),
                    phone_number: row.phone_number?.trim(),
                    email: row.email?.trim() || undefined,
                    original_amount: row.original_amount,
                    due_date: row.due_date?.trim(),
                });
            }
        }
        if (errors.length > 0) {
            throw new common_1.HttpException({ error: 'Erros de validação.', details: errors }, common_1.HttpStatus.BAD_REQUEST);
        }
        return this.invoicesService.importCsv(user.companyId, validRows);
    }
    validateRow(row, index) {
        const i = index + 1;
        if (typeof row.name !== 'string' || row.name.trim().length < 2) {
            return `Linha ${i}: Nome inválido ou ausente.`;
        }
        if (typeof row.phone_number !== 'string' || !/^\d{10,13}$/.test(row.phone_number)) {
            return `Linha ${i}: WhatsApp inválido (esperado 10-13 dígitos numéricos).`;
        }
        if (row.email != null && row.email !== '' && typeof row.email === 'string') {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
                return `Linha ${i}: E-mail inválido.`;
            }
        }
        if (typeof row.original_amount !== 'number' || row.original_amount <= 0 || row.original_amount > 999999.99) {
            return `Linha ${i}: Valor deve ser um número entre 0.01 e 999999.99.`;
        }
        if (typeof row.due_date !== 'string' || row.due_date.trim() === '') {
            return `Linha ${i}: Data de vencimento ausente.`;
        }
        return null;
    }
};
exports.InvoicesController = InvoicesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InvoicesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)('import'),
    __param(0, (0, get_user_decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Array]),
    __metadata("design:returntype", Promise)
], InvoicesController.prototype, "importCsv", null);
exports.InvoicesController = InvoicesController = __decorate([
    (0, common_1.Controller)('invoices'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [invoices_service_1.InvoicesService])
], InvoicesController);
//# sourceMappingURL=invoices.controller.js.map