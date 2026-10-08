-- CreateEnum
CREATE TYPE "CardAttemptStatus" AS ENUM ('SUBMITTING', 'UNCERTAIN', 'DECLINED', 'APPROVED', 'PAID', 'CANCELED');

-- AlterEnum
ALTER TYPE "BillingMethod" ADD VALUE 'CREDIT_CARD';

-- AlterTable
ALTER TABLE "PaymentCharge" ADD COLUMN     "platformFeeBaseCents" INTEGER;

-- CreateTable
CREATE TABLE "CardPaymentSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "issuerIdentityId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "onTimeBasisPoints" INTEGER NOT NULL,
    "overdueBasisPoints" INTEGER NOT NULL,
    "processingRates" JSONB NOT NULL,
    "validationReference" TEXT NOT NULL,
    "validatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardPaymentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardPaymentQuote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentChargeId" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "settingsVersion" INTEGER NOT NULL,
    "brand" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "amounts" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardPaymentQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardPaymentAttempt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentChargeId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "CardAttemptStatus" NOT NULL DEFAULT 'SUBMITTING',
    "installments" INTEGER NOT NULL,
    "submissionCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "efiFeeCents" INTEGER NOT NULL,
    "platformFeeBaseCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "platformFeeBasisPoints" INTEGER NOT NULL,
    "efiChargeId" TEXT,
    "providerStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardPaymentSettings_issuerIdentityId_key" ON "CardPaymentSettings"("issuerIdentityId");

-- CreateIndex
CREATE INDEX "CardPaymentSettings_companyId_idx" ON "CardPaymentSettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CardPaymentSettings_issuerIdentityId_companyId_key" ON "CardPaymentSettings"("issuerIdentityId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CardPaymentSettings_id_companyId_key" ON "CardPaymentSettings"("id", "companyId");

-- CreateIndex
CREATE INDEX "CardPaymentQuote_paymentChargeId_validUntil_idx" ON "CardPaymentQuote"("paymentChargeId", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CardPaymentQuote_id_companyId_invoiceId_key" ON "CardPaymentQuote"("id", "companyId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CardPaymentAttempt_efiChargeId_key" ON "CardPaymentAttempt"("efiChargeId");

-- CreateIndex
CREATE INDEX "CardPaymentAttempt_paymentChargeId_status_idx" ON "CardPaymentAttempt"("paymentChargeId", "status");

-- CreateIndex
CREATE INDEX "CardPaymentAttempt_companyId_status_idx" ON "CardPaymentAttempt"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CardPaymentAttempt_paymentChargeId_idempotencyKey_key" ON "CardPaymentAttempt"("paymentChargeId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CardPaymentSettings" ADD CONSTRAINT "CardPaymentSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPaymentSettings" ADD CONSTRAINT "CardPaymentSettings_issuerIdentityId_companyId_fkey" FOREIGN KEY ("issuerIdentityId", "companyId") REFERENCES "EfiAccountIdentity"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPaymentQuote" ADD CONSTRAINT "CardPaymentQuote_paymentChargeId_companyId_invoiceId_fkey" FOREIGN KEY ("paymentChargeId", "companyId", "invoiceId") REFERENCES "PaymentCharge"("id", "companyId", "invoiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPaymentQuote" ADD CONSTRAINT "CardPaymentQuote_settingsId_companyId_fkey" FOREIGN KEY ("settingsId", "companyId") REFERENCES "CardPaymentSettings"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPaymentAttempt" ADD CONSTRAINT "CardPaymentAttempt_paymentChargeId_companyId_invoiceId_fkey" FOREIGN KEY ("paymentChargeId", "companyId", "invoiceId") REFERENCES "PaymentCharge"("id", "companyId", "invoiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardPaymentAttempt" ADD CONSTRAINT "CardPaymentAttempt_quoteId_companyId_invoiceId_fkey" FOREIGN KEY ("quoteId", "companyId", "invoiceId") REFERENCES "CardPaymentQuote"("id", "companyId", "invoiceId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A second tab/process cannot reserve another live attempt for the same debt.
CREATE UNIQUE INDEX "CardPaymentAttempt_one_live_attempt" ON "CardPaymentAttempt" ("paymentChargeId") WHERE "status" IN ('SUBMITTING', 'UNCERTAIN', 'APPROVED', 'PAID');
ALTER TABLE "CardPaymentSettings" ADD CONSTRAINT "CardPaymentSettings_valid_rates" CHECK ("version" > 0 AND "onTimeBasisPoints" BETWEEN 0 AND 10000 AND "overdueBasisPoints" BETWEEN 0 AND 10000 AND jsonb_typeof("processingRates") = 'array');
ALTER TABLE "CardPaymentAttempt" ADD CONSTRAINT "CardPaymentAttempt_valid_amounts" CHECK ("installments" BETWEEN 1 AND 6 AND "submissionCents" > 0 AND "totalCents" >= "submissionCents" AND "efiFeeCents" >= 0 AND "platformFeeBaseCents" >= 0 AND "platformFeeCents" >= 0 AND "platformFeeBasisPoints" BETWEEN 0 AND 10000);

-- Published profiles are replaced by a successor when the account's card
-- validation is enabled. Preserve the existing financial context trigger.
-- Text comparison avoids using a newly added enum literal in the same transaction.
ALTER TABLE "FinancialProfileVersion" DROP CONSTRAINT "FinancialProfileVersion_methods_check";
ALTER TABLE "FinancialProfileVersion" ADD CONSTRAINT "FinancialProfileVersion_methods_check" CHECK (
  cardinality("enabledMethods") > 0 AND
  "enabledMethods"::text[] <@ ARRAY['PIX', 'BOLIX', 'CREDIT_CARD']::text[]
);

ALTER TABLE "CollectionRuleStep" ADD COLUMN "cardTemplateId" TEXT;
CREATE INDEX "CollectionRuleStep_cardTemplateId_idx" ON "CollectionRuleStep"("cardTemplateId");
ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_cardTemplateId_fkey" FOREIGN KEY ("cardTemplateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentWebhookAnomaly" DROP CONSTRAINT "PaymentWebhookAnomaly_source_check";
ALTER TABLE "PaymentWebhookAnomaly" ADD CONSTRAINT "PaymentWebhookAnomaly_source_check" CHECK ("source" IN ('PIX', 'CHARGES', 'CARD'));
