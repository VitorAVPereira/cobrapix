import { PrismaClient } from "@prisma/client";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import bcrypt from "bcryptjs";
import "dotenv/config";

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const company = await prisma.company.upsert({
    where: { document: "00000000000100" },
    update: {},
    create: {
      corporateName: "Empresa Teste MVP",
      document: "00000000000100",
      email: "empresa@mvp.com",
      phoneNumber: "11999999999",
    },
  });

  const hashedPassword = await bcrypt.hash("senha123", 10);

  await prisma.user.upsert({
    where: { email: "admin@cobrapix.com" },
    update: { password: hashedPassword },
    create: {
      email: "admin@cobrapix.com",
      password: hashedPassword,
      name: "Admin MVP",
      companyId: company.id,
    },
  });

  console.log("Seed concluido: admin@cobrapix.com / senha123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
