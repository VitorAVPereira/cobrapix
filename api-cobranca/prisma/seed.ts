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
  const existingCompany = await prisma.company.findUnique({
    where: { document: '12345678901' },
  });

  const company =
    existingCompany ??
    (await prisma.company.create({
      data: {
        corporateName: 'Empresa Teste MVP',
        document: '12345678901',
        email: 'admin@cobrapix.com',
        phoneNumber: '5511999999999',
      },
    }));

  const existingUser = await prisma.user.findUnique({
    where: { email: 'admin@cobrapix.com' },
  });

  if (!existingUser) {
    await prisma.user.create({
      data: {
        email: 'admin@cobrapix.com',
        password:
          '$2b$10$jrar49jzvbZv7zhMKxkH7eE0zDR8OiMa0vDCwm3bWXrydoKMhTr9e',
        name: 'Admin',
        companyId: company.id,
      },
    });
  }

  const existingPlan = await prisma.plan.findFirst({
    where: { name: 'Plano Teste' },
  });

  const plan =
    existingPlan ??
    (await prisma.plan.create({
      data: {
        name: 'Plano Teste',
        price: 97.0,
        invoiceLimit: 100,
      },
    }));

  const existingSub = await prisma.subscription.findUnique({
    where: { companyId: company.id },
  });

  if (!existingSub) {
    await prisma.subscription.create({
      data: {
        companyId: company.id,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  await migrateCollectionProfiles();

  console.log('Seed completed successfully');
}

async function migrateCollectionProfiles() {
  const companies = await prisma.company.findMany({
    select: { id: true, collectionReminderDays: true },
  });

  for (const company of companies) {
    let profile = await prisma.collectionProfile.findFirst({
      where: { companyId: company.id, isDefault: true },
    });

    if (!profile) {
      profile = await prisma.collectionProfile.create({
        data: {
          companyId: company.id,
          name: 'Padrao',
          profileType: 'NEW',
          isDefault: true,
          isActive: true,
        },
      });
    }

    const existingSteps = await prisma.collectionRuleStep.count({
      where: { profileId: profile.id },
    });
    const sortedDays = Array.from(
      new Set(
        company.collectionReminderDays.length > 0
          ? company.collectionReminderDays
          : [0],
      ),
    ).sort(
      (a, b) => a - b,
    );

    if (existingSteps === 0) {
      for (let i = 0; i < sortedDays.length; i++) {
        const reminderDay = sortedDays[i] ?? 0;
        const previousReminderDay = i === 0 ? 0 : (sortedDays[i - 1] ?? 0);

        await prisma.collectionRuleStep.create({
          data: {
            profileId: profile.id,
            stepOrder: i,
            channel: 'WHATSAPP',
            delayDays: i === 0 ? reminderDay : reminderDay - previousReminderDay,
            isActive: true,
          },
        });
      }
    }

    await prisma.debtor.updateMany({
      where: { companyId: company.id, collectionProfileId: null },
      data: { collectionProfileId: profile.id },
    });

    console.log(
      `Migrated company ${company.id}: profile "${profile.name}" with ${sortedDays.length} steps, debtors updated`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
