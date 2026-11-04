-- Cifra+ Checkout, part 2: the CifraMais Efí account used by the checkout,
-- orders and their Pix payment attempts.
-- CreateEnum
CREATE TYPE "CheckoutOrderStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "CheckoutAttemptStatus" AS ENUM ('CREATING', 'ACTIVE', 'PAID', 'EXPIRED', 'UNCERTAIN', 'FAILED');

-- CreateTable
CREATE TABLE "CheckoutPlatformSettings" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "identityId" TEXT NOT NULL,
    "pixFeeBasisPoints" INTEGER,
    "webhookConfiguredAt" TIMESTAMP(3),
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutPlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "CheckoutOrderStatus" NOT NULL DEFAULT 'PENDING',
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerDocument" TEXT NOT NULL,
    "buyerPhone" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "couponId" TEXT,
    "couponCode" TEXT,
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "surchargeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "efiFeeBasisPoints" INTEGER NOT NULL,
    "efiFeeCents" INTEGER NOT NULL,
    "platformFeeBasisPoints" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "feePayer" "CheckoutFeePayer" NOT NULL,
    "termsId" TEXT NOT NULL,
    "platformSettingsId" TEXT NOT NULL,
    "utm" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "accessEmailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutPaymentAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "issuerIdentityId" TEXT NOT NULL,
    "efiTxid" TEXT NOT NULL,
    "status" "CheckoutAttemptStatus" NOT NULL DEFAULT 'CREATING',
    "amountCents" INTEGER NOT NULL,
    "pixCopyPaste" TEXT,
    "pixQrCodeImage" TEXT,
    "endToEndId" TEXT,
    "paidAmountCents" INTEGER,
    "providerFeeCents" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutPlatformSettings_version_key" ON "CheckoutPlatformSettings"("version");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutOrder_publicToken_key" ON "CheckoutOrder"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutOrder_idempotencyKey_key" ON "CheckoutOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CheckoutOrder_companyId_status_createdAt_idx" ON "CheckoutOrder"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CheckoutOrder_status_expiresAt_idx" ON "CheckoutOrder"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutOrder_id_companyId_key" ON "CheckoutOrder"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutPaymentAttempt_orderId_key" ON "CheckoutPaymentAttempt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutPaymentAttempt_efiTxid_key" ON "CheckoutPaymentAttempt"("efiTxid");

-- CreateIndex
CREATE INDEX "CheckoutPaymentAttempt_status_createdAt_idx" ON "CheckoutPaymentAttempt"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutPaymentAttempt_orderId_companyId_key" ON "CheckoutPaymentAttempt"("orderId", "companyId");

-- AddForeignKey
ALTER TABLE "CheckoutPlatformSettings" ADD CONSTRAINT "CheckoutPlatformSettings_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_productId_companyId_fkey" FOREIGN KEY ("productId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_couponId_companyId_fkey" FOREIGN KEY ("couponId", "companyId") REFERENCES "CheckoutCoupon"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_termsId_fkey" FOREIGN KEY ("termsId") REFERENCES "CheckoutSellerTerms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_platformSettingsId_fkey" FOREIGN KEY ("platformSettingsId") REFERENCES "CheckoutPlatformSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutPaymentAttempt" ADD CONSTRAINT "CheckoutPaymentAttempt_orderId_companyId_fkey" FOREIGN KEY ("orderId", "companyId") REFERENCES "CheckoutOrder"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutPaymentAttempt" ADD CONSTRAINT "CheckoutPaymentAttempt_issuerIdentityId_fkey" FOREIGN KEY ("issuerIdentityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

