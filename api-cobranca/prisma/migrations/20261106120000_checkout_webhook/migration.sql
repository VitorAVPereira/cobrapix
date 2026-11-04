-- Cifra+ Checkout, part 4: the seller webhook (URL, secret, failure state)
-- and the deliveries kept for retries and history.
-- CreateEnum
CREATE TYPE "CheckoutWebhookStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "CheckoutSettings" ADD COLUMN     "webhookDisabledAt" TIMESTAMP(3),
ADD COLUMN     "webhookFailingSince" TIMESTAMP(3),
ADD COLUMN     "webhookSecretEncrypted" TEXT,
ADD COLUMN     "webhookUrl" TEXT;

-- CreateTable
CREATE TABLE "CheckoutWebhookDelivery" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "CheckoutWebhookStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "retryUntil" TIMESTAMP(3) NOT NULL,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutWebhookDelivery_eventId_key" ON "CheckoutWebhookDelivery"("eventId");

-- CreateIndex
CREATE INDEX "CheckoutWebhookDelivery_status_nextAttemptAt_idx" ON "CheckoutWebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CheckoutWebhookDelivery_companyId_createdAt_idx" ON "CheckoutWebhookDelivery"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckoutWebhookDelivery_orderId_idx" ON "CheckoutWebhookDelivery"("orderId");

-- AddForeignKey
ALTER TABLE "CheckoutWebhookDelivery" ADD CONSTRAINT "CheckoutWebhookDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

