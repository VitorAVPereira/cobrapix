-- CreateEnum
CREATE TYPE "MessagingLimitTier" AS ENUM ('TIER_50', 'TIER_250', 'TIER_1K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED');

-- CreateEnum
CREATE TYPE "WhatsAppInteractionDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "messagingLimitTier" "MessagingLimitTier",
ADD COLUMN     "messagingLimitUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessagingUsage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppInteraction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "direction" "WhatsAppInteractionDirection" NOT NULL,
    "status" TEXT,
    "messageId" TEXT,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessagingUsage_companyId_sentAt_idx" ON "MessagingUsage"("companyId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingUsage_companyId_phoneNumber_key" ON "MessagingUsage"("companyId", "phoneNumber");

-- CreateIndex
CREATE INDEX "WhatsAppInteraction_companyId_receivedAt_idx" ON "WhatsAppInteraction"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "WhatsAppInteraction_companyId_phoneNumber_idx" ON "WhatsAppInteraction"("companyId", "phoneNumber");

-- AddForeignKey
ALTER TABLE "MessagingUsage" ADD CONSTRAINT "MessagingUsage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInteraction" ADD CONSTRAINT "WhatsAppInteraction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
