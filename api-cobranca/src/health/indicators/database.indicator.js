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
exports.DatabaseHealthIndicator = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let DatabaseHealthIndicator = class DatabaseHealthIndicator {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async check() {
        const startTime = Date.now();
        try {
            await this.prisma.$queryRaw `SELECT 1`;
            return {
                service: 'Database',
                status: 'healthy',
                message: 'Banco de dados está respondendo',
                latency: Date.now() - startTime,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            return {
                service: 'Database',
                status: 'unhealthy',
                message: `Falha ao conectar com banco de dados: ${errorMessage}`,
                latency: Date.now() - startTime,
                details: { error: errorMessage },
            };
        }
    }
};
exports.DatabaseHealthIndicator = DatabaseHealthIndicator;
exports.DatabaseHealthIndicator = DatabaseHealthIndicator = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DatabaseHealthIndicator);
//# sourceMappingURL=database.indicator.js.map