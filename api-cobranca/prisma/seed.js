"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = __importDefault(require("pg"));
const pool = new pg_1.default.Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const company = await prisma.company.create({
        data: {
            corporateName: 'Empresa Teste MVP',
            document: '12345678901',
            email: 'admin@cobrapix.com',
            phoneNumber: '5511999999999',
        },
    });
    await prisma.user.create({
        data: {
            email: 'admin@cobrapix.com',
            password: '$2b$10$jrar49jzvbZv7zhMKxkH7eE0zDR8OiMa0vDCwm3bWXrydoKMhTr9e',
            name: 'Admin',
            companyId: company.id,
        },
    });
    const plan = await prisma.plan.create({
        data: {
            name: 'Plano Teste',
            price: 97.0,
            invoiceLimit: 100,
        },
    });
    await prisma.subscription.create({
        data: {
            companyId: company.id,
            planId: plan.id,
            status: 'ACTIVE',
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
    });
    console.log('Seed completed successfully');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map