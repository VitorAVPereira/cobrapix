import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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