CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'COMPANY_ADMIN');

CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

CREATE TYPE "SplitAppliedCategory" AS ENUM ('ON_TIME', 'OVERDUE');

ALTER TABLE "Company"
ADD COLUMN "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "enabledBillingMethods" "BillingMethod"[] NOT NULL DEFAULT ARRAY['PIX', 'BOLETO', 'BOLIX']::"BillingMethod"[],
ADD COLUMN "onTimeSplitPercentageBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "overdueSplitPercentageBps" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User"
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'COMPANY_ADMIN';

ALTER TABLE "Invoice"
ADD COLUMN "splitAppliedPercentageBps" INTEGER,
ADD COLUMN "splitAppliedCategory" "SplitAppliedCategory";
