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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoicesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let InvoicesService = class InvoicesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(companyId) {
        const invoices = await this.prisma.invoice.findMany({
            where: { companyId },
            include: { debtor: true },
            orderBy: { createdAt: 'desc' },
        });
        return invoices.map((inv) => ({
            id: inv.id,
            name: inv.debtor.name,
            phone_number: inv.debtor.phoneNumber,
            email: inv.debtor.email || undefined,
            original_amount: Number(inv.originalAmount),
            due_date: inv.dueDate.toISOString().split('T')[0],
            status: inv.status,
            debtorId: inv.debtor.id,
            gatewayId: inv.gatewayId,
            pixPayload: inv.pixPayload,
            createdAt: inv.createdAt.toISOString(),
        }));
    }
    async importCsv(companyId, rows) {
        const result = await this.prisma.$transaction(async (tx) => {
            let created = 0;
            for (const row of rows) {
                const debtor = await tx.debtor.upsert({
                    where: {
                        companyId_phoneNumber: {
                            companyId,
                            phoneNumber: row.phone_number,
                        },
                    },
                    update: {
                        name: row.name,
                        email: row.email || null,
                    },
                    create: {
                        companyId,
                        name: row.name,
                        phoneNumber: row.phone_number,
                        email: row.email || null,
                    },
                });
                const dueDate = this.parseDueDate(row.due_date);
                if (!dueDate)
                    continue;
                await tx.invoice.create({
                    data: {
                        companyId,
                        debtorId: debtor.id,
                        originalAmount: row.original_amount,
                        dueDate,
                    },
                });
                created++;
            }
            return created;
        });
        return { success: true, count: result };
    }
    parseDueDate(raw) {
        const trimmed = raw.trim();
        const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
            const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00Z`);
            return isNaN(d.getTime()) ? null : d;
        }
        const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (brMatch) {
            const d = new Date(`${brMatch[3]}-${brMatch[2]}-${brMatch[1]}T12:00:00Z`);
            return isNaN(d.getTime()) ? null : d;
        }
        return null;
    }
};
exports.InvoicesService = InvoicesService;
exports.InvoicesService = InvoicesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], InvoicesService);
//# sourceMappingURL=invoices.service.js.map