-- Checkout sold through the seller's own Efí account, and recurring subscriptions.
CREATE TYPE "CheckoutAccountMode" AS ENUM ('PLATFORM_ACCOUNT', 'SELLER_ACCOUNT');

CREATE TYPE "CheckoutSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

CREATE TYPE "CheckoutSubscriptionCancelReason" AS ENUM ('BUYER', 'SELLER', 'ADMIN', 'PAYMENT_FAILED', 'REFUND', 'CHARGEBACK');

ALTER TYPE "CheckoutLedgerKind" ADD VALUE 'DIRECT_SETTLEMENT';
ALTER TYPE "CheckoutLedgerKind" ADD VALUE 'FEE_PAYMENT';

-- Existing terms were sold through the CifraMais account.
ALTER TABLE "CheckoutSellerTerms" ADD COLUMN "accountMode" "CheckoutAccountMode" NOT NULL DEFAULT 'PLATFORM_ACCOUNT',
ADD COLUMN "authorizationReference" TEXT;

-- Issuing account per seller: rows without a company stay the CifraMais account.
ALTER TABLE "CheckoutPlatformSettings" ADD COLUMN "companyId" TEXT;

DROP INDEX "CheckoutPlatformSettings_version_key";

CREATE UNIQUE INDEX "CheckoutPlatformSettings_companyId_version_key" ON "CheckoutPlatformSettings"("companyId", "version");

-- NULLs are distinct in the index above, so the CifraMais rows keep their own.
CREATE UNIQUE INDEX "CheckoutPlatformSettings_platform_version_key" ON "CheckoutPlatformSettings"("version") WHERE "companyId" IS NULL;

ALTER TABLE "CheckoutPlatformSettings" ADD CONSTRAINT "CheckoutPlatformSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A seller's settings can only point to an account of that same seller.
ALTER TABLE "CheckoutPlatformSettings" ADD CONSTRAINT "CheckoutPlatformSettings_identityId_companyId_fkey" FOREIGN KEY ("identityId", "companyId") REFERENCES "EfiAccountIdentity"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "CheckoutSubscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerDocument" TEXT NOT NULL,
    "buyerPhone" TEXT NOT NULL,
    "paymentMethod" "CheckoutPaymentMethod" NOT NULL,
    "status" "CheckoutSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "intervalMonths" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "cycleCents" INTEGER NOT NULL,
    "efiFeeBasisPoints" INTEGER NOT NULL,
    "platformFeeBasisPoints" INTEGER NOT NULL,
    "feePayer" "CheckoutFeePayer" NOT NULL,
    "termsId" TEXT NOT NULL,
    "issuerIdentityId" TEXT NOT NULL,
    "efiSubscriptionId" TEXT,
    "itemsAdjustedAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "renewalNoticeCycle" INTEGER,
    "pastDueSince" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" "CheckoutSubscriptionCancelReason",
    "accessEndsAt" TIMESTAMP(3),
    "accessEndedNotifiedAt" TIMESTAMP(3),
    "tokenHash" TEXT NOT NULL,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutSubscription_tokenHash_key" ON "CheckoutSubscription"("tokenHash");

CREATE UNIQUE INDEX "CheckoutSubscription_id_companyId_key" ON "CheckoutSubscription"("id", "companyId");

CREATE UNIQUE INDEX "CheckoutSubscription_issuerIdentityId_efiSubscriptionId_key" ON "CheckoutSubscription"("issuerIdentityId", "efiSubscriptionId");

CREATE INDEX "CheckoutSubscription_companyId_status_createdAt_idx" ON "CheckoutSubscription"("companyId", "status", "createdAt");

CREATE INDEX "CheckoutSubscription_status_currentPeriodEnd_idx" ON "CheckoutSubscription"("status", "currentPeriodEnd");

CREATE INDEX "CheckoutSubscription_accessEndsAt_accessEndedNotifiedAt_idx" ON "CheckoutSubscription"("accessEndsAt", "accessEndedNotifiedAt");

ALTER TABLE "CheckoutSubscription" ADD CONSTRAINT "CheckoutSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CheckoutSubscription" ADD CONSTRAINT "CheckoutSubscription_productId_companyId_fkey" FOREIGN KEY ("productId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CheckoutSubscription" ADD CONSTRAINT "CheckoutSubscription_planId_companyId_fkey" FOREIGN KEY ("planId", "companyId") REFERENCES "CheckoutPlan"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CheckoutSubscription" ADD CONSTRAINT "CheckoutSubscription_termsId_fkey" FOREIGN KEY ("termsId") REFERENCES "CheckoutSellerTerms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CheckoutSubscription" ADD CONSTRAINT "CheckoutSubscription_issuerIdentityId_fkey" FOREIGN KEY ("issuerIdentityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CheckoutEfiPlan" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "intervalMonths" INTEGER NOT NULL,
    "efiPlanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutEfiPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutEfiPlan_identityId_intervalMonths_key" ON "CheckoutEfiPlan"("identityId", "intervalMonths");

ALTER TABLE "CheckoutEfiPlan" ADD CONSTRAINT "CheckoutEfiPlan_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each charged cycle of a subscription is an order.
ALTER TABLE "CheckoutOrder" ADD COLUMN "subscriptionId" TEXT,
ADD COLUMN "subscriptionCycle" INTEGER;

CREATE UNIQUE INDEX "CheckoutOrder_subscriptionId_subscriptionCycle_key" ON "CheckoutOrder"("subscriptionId", "subscriptionCycle");

ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_subscriptionId_companyId_fkey" FOREIGN KEY ("subscriptionId", "companyId") REFERENCES "CheckoutSubscription"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Subscription cycles are charged in full, with no installment quote.
ALTER TABLE "CheckoutCardAttempt" ALTER COLUMN "quoteId" DROP NOT NULL;
