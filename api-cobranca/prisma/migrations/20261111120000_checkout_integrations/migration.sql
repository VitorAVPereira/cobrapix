-- DropIndex
DROP INDEX "CheckoutWebhookDelivery_eventId_key";

-- AlterTable
ALTER TABLE "CheckoutWebhookDelivery" ADD COLUMN     "ruleId" TEXT;

-- CreateTable
CREATE TABLE "CheckoutWebhookRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretEncrypted" TEXT NOT NULL,
    "failingSince" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutWebhookRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutApiKey" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutWebhookRule_companyId_deletedAt_idx" ON "CheckoutWebhookRule"("companyId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutApiKey_keyHash_key" ON "CheckoutApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "CheckoutApiKey_companyId_revokedAt_idx" ON "CheckoutApiKey"("companyId", "revokedAt");

-- CreateIndex
CREATE INDEX "CheckoutWebhookDelivery_ruleId_createdAt_idx" ON "CheckoutWebhookDelivery"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutWebhookDelivery_eventId_ruleId_key" ON "CheckoutWebhookDelivery"("eventId", "ruleId");

-- AddForeignKey
ALTER TABLE "CheckoutWebhookDelivery" ADD CONSTRAINT "CheckoutWebhookDelivery_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CheckoutWebhookRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutWebhookRule" ADD CONSTRAINT "CheckoutWebhookRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutApiKey" ADD CONSTRAINT "CheckoutApiKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The single webhook of Part 4 becomes the first rule, with the same secret,
-- failure state and history, so the seller reconfigures nothing.
INSERT INTO "CheckoutWebhookRule" ("id", "companyId", "name", "url", "secretEncrypted", "failingSince", "disabledAt", "updatedAt")
SELECT gen_random_uuid()::text, "companyId", 'Webhook principal', "webhookUrl", "webhookSecretEncrypted", "webhookFailingSince", "webhookDisabledAt", CURRENT_TIMESTAMP
FROM "CheckoutSettings"
WHERE "webhookUrl" IS NOT NULL AND "webhookSecretEncrypted" IS NOT NULL;

UPDATE "CheckoutWebhookDelivery" AS d
SET "ruleId" = r."id"
FROM "CheckoutWebhookRule" AS r
WHERE r."companyId" = d."companyId" AND d."ruleId" IS NULL;
