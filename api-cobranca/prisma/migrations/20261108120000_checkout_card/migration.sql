-- CreateEnum
CREATE TYPE "CheckoutPaymentMethod" AS ENUM ('PIX', 'CARD');

-- CreateEnum
CREATE TYPE "CheckoutCardAttemptStatus" AS ENUM ('SUBMITTING', 'APPROVED', 'PAID', 'DECLINED', 'CANCELED', 'UNCERTAIN');

-- AlterEnum
ALTER TYPE "CheckoutOrderStatus" ADD VALUE 'DECLINED';

-- AlterTable
ALTER TABLE "CheckoutOrder" ADD COLUMN     "installments" INTEGER,
ADD COLUMN     "paymentMethod" "CheckoutPaymentMethod" NOT NULL DEFAULT 'PIX';

-- AlterTable
ALTER TABLE "CheckoutPlatformSettings" ADD COLUMN     "cardCreditDays" INTEGER,
ADD COLUMN     "cardEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cardRates" JSONB;

-- AlterTable
ALTER TABLE "CheckoutSettings" ADD COLUMN     "cardPausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CheckoutCardQuote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "platformSettingsId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutCardQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutCardAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "issuerIdentityId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "installments" INTEGER NOT NULL,
    "submissionCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "efiFeeCents" INTEGER NOT NULL,
    "status" "CheckoutCardAttemptStatus" NOT NULL DEFAULT 'SUBMITTING',
    "efiChargeId" TEXT,
    "providerStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutCardAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutCardQuote_createdAt_idx" ON "CheckoutCardQuote"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutCardAttempt_efiChargeId_key" ON "CheckoutCardAttempt"("efiChargeId");

-- CreateIndex
CREATE INDEX "CheckoutCardAttempt_orderId_createdAt_idx" ON "CheckoutCardAttempt"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckoutCardAttempt_status_updatedAt_idx" ON "CheckoutCardAttempt"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutCardAttempt_orderId_idempotencyKey_key" ON "CheckoutCardAttempt"("orderId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CheckoutCardQuote" ADD CONSTRAINT "CheckoutCardQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutCardQuote" ADD CONSTRAINT "CheckoutCardQuote_productId_companyId_fkey" FOREIGN KEY ("productId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutCardQuote" ADD CONSTRAINT "CheckoutCardQuote_platformSettingsId_fkey" FOREIGN KEY ("platformSettingsId") REFERENCES "CheckoutPlatformSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutCardAttempt" ADD CONSTRAINT "CheckoutCardAttempt_orderId_companyId_fkey" FOREIGN KEY ("orderId", "companyId") REFERENCES "CheckoutOrder"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutCardAttempt" ADD CONSTRAINT "CheckoutCardAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutCardAttempt" ADD CONSTRAINT "CheckoutCardAttempt_issuerIdentityId_fkey" FOREIGN KEY ("issuerIdentityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutCardAttempt" ADD CONSTRAINT "CheckoutCardAttempt_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CheckoutCardQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

