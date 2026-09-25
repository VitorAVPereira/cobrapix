-- Charges record the amount actually paid (fees on the paid amount) and
-- webhook events that cannot be applied safely are kept for diagnosis.

-- AlterTable
ALTER TABLE "PaymentCharge" ADD COLUMN     "paidAmountCents" INTEGER;

-- CreateTable
CREATE TABLE "PaymentWebhookAnomaly" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "companyId" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentWebhookAnomaly_lastSeenAt_idx" ON "PaymentWebhookAnomaly"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookAnomaly_source_externalReference_reasonCode_key" ON "PaymentWebhookAnomaly"("source", "externalReference", "reasonCode");


ALTER TABLE "PaymentCharge"
ADD CONSTRAINT "PaymentCharge_paidAmount_check" CHECK (
    "paidAmountCents" IS NULL OR "paidAmountCents" > 0
);

ALTER TABLE "PaymentWebhookAnomaly"
ADD CONSTRAINT "PaymentWebhookAnomaly_source_check" CHECK ("source" IN ('PIX', 'CHARGES')),
ADD CONSTRAINT "PaymentWebhookAnomaly_reason_check" CHECK ("reasonCode" ~ '^[A-Z0-9_]{1,64}$'),
ADD CONSTRAINT "PaymentWebhookAnomaly_reference_check" CHECK (length("externalReference") BETWEEN 1 AND 128),
ADD CONSTRAINT "PaymentWebhookAnomaly_occurrences_check" CHECK ("occurrences" > 0);
