-- Cifra+ Checkout, part 5: leads (left before the Pix), recovery marks and
-- anonymization dates of unpaid orders.
-- AlterTable
ALTER TABLE "CheckoutOrder" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "recoveredByOrderId" TEXT;

-- CreateTable
CREATE TABLE "CheckoutLead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "document" TEXT,
    "phone" TEXT,
    "utm" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedOrderId" TEXT,
    "abandonedNotifiedAt" TIMESTAMP(3),
    "recoveredByOrderId" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutLead_companyId_lastSeenAt_idx" ON "CheckoutLead"("companyId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutLead_productId_sessionKey_key" ON "CheckoutLead"("productId", "sessionKey");

-- AddForeignKey
ALTER TABLE "CheckoutLead" ADD CONSTRAINT "CheckoutLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLead" ADD CONSTRAINT "CheckoutLead_productId_companyId_fkey" FOREIGN KEY ("productId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

