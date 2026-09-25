
-- CreateEnum
CREATE TYPE "PaymentSettlementStatus" AS ENUM ('AWAITING_EVIDENCE', 'RECONCILED', 'DIVERGENT');

-- CreateEnum
CREATE TYPE "PlatformFeeEvidenceStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "LedgerEntryKind" AS ENUM ('PAYMENT', 'EFI_FEE', 'PLATFORM_FEE', 'REFUND', 'PLATFORM_FEE_REVERSAL', 'DUPLICATE_PAYMENT');

-- CreateEnum
CREATE TYPE "LedgerEntrySource" AS ENUM ('PROVIDER_WEBHOOK', 'PROVIDER_RECONCILIATION', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SettlementDivergenceStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "refundPlatformFeeOnRefund" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "complementsInvoiceId" TEXT;

-- CreateTable
CREATE TABLE "PaymentSettlement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentChargeId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "accountMode" "FinancialAccountMode",
    "financialEnvironment" "EfiEnvironment",
    "status" "PaymentSettlementStatus" NOT NULL,
    "evidenceStatus" "PlatformFeeEvidenceStatus" NOT NULL,
    "platformFeeDueCents" INTEGER NOT NULL,
    "platformFeeEvidenceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialLedgerEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentChargeId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "kind" "LedgerEntryKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "source" "LedgerEntrySource" NOT NULL,
    "evidenceReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFeeEvidence" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "receivedAmountCents" INTEGER NOT NULL,
    "expectedAmountCents" INTEGER NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "note" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFeeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementDivergence" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER,
    "status" "SettlementDivergenceStatus" NOT NULL DEFAULT 'OPEN',
    "decision" TEXT,
    "decisionReference" TEXT,
    "decisionNote" TEXT,
    "complementaryInvoiceId" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementDivergence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettlement_paymentChargeId_key" ON "PaymentSettlement"("paymentChargeId");

-- CreateIndex
CREATE INDEX "PaymentSettlement_companyId_status_idx" ON "PaymentSettlement"("companyId", "status");

-- CreateIndex
CREATE INDEX "PaymentSettlement_status_createdAt_idx" ON "PaymentSettlement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentSettlement_platformFeeEvidenceId_idx" ON "PaymentSettlement"("platformFeeEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialLedgerEntry_idempotencyKey_key" ON "FinancialLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_settlementId_kind_idx" ON "FinancialLedgerEntry"("settlementId", "kind");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_companyId_occurredAt_idx" ON "FinancialLedgerEntry"("companyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFeeEvidence_scope_reference_key" ON "PlatformFeeEvidence"("scope", "reference");

-- CreateIndex
CREATE INDEX "SettlementDivergence_companyId_status_idx" ON "SettlementDivergence"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementDivergence_settlementId_code_reference_key" ON "SettlementDivergence"("settlementId", "code", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_complementsInvoiceId_key" ON "Invoice"("complementsInvoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_complementsInvoiceId_companyId_fkey" FOREIGN KEY ("complementsInvoiceId", "companyId") REFERENCES "Invoice"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_paymentChargeId_fkey" FOREIGN KEY ("paymentChargeId") REFERENCES "PaymentCharge"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_platformFeeEvidenceId_fkey" FOREIGN KEY ("platformFeeEvidenceId") REFERENCES "PlatformFeeEvidence"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_paymentChargeId_fkey" FOREIGN KEY ("paymentChargeId") REFERENCES "PaymentCharge"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PaymentSettlement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlatformFeeEvidence" ADD CONSTRAINT "PlatformFeeEvidence_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SettlementDivergence" ADD CONSTRAINT "SettlementDivergence_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PaymentSettlement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SettlementDivergence" ADD CONSTRAINT "SettlementDivergence_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ---------------------------------------------------------------------------
-- Integrity rules (etapa 7)
-- ---------------------------------------------------------------------------

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_complement_not_self_check" CHECK (
    "complementsInvoiceId" IS NULL OR "complementsInvoiceId" <> "id"
);

ALTER TABLE "PaymentSettlement"
ADD CONSTRAINT "PaymentSettlement_amounts_check" CHECK ("platformFeeDueCents" >= 0 AND "version" >= 0),
ADD CONSTRAINT "PaymentSettlement_evidence_check" CHECK (
    ("evidenceStatus" IN ('CONFIRMED', 'MISMATCH')) = ("platformFeeEvidenceId" IS NOT NULL)
);

ALTER TABLE "PlatformFeeEvidence"
ADD CONSTRAINT "PlatformFeeEvidence_values_check" CHECK (
    "scope" IN ('PRODUCTION', 'HOMOLOGATION', 'LEGACY') AND
    char_length("reference") BETWEEN 1 AND 128 AND
    "receivedAmountCents" >= 0 AND
    "expectedAmountCents" >= 0 AND
    "matched" = ("receivedAmountCents" = "expectedAmountCents") AND
    ("note" IS NULL OR char_length("note") <= 500)
);

ALTER TABLE "FinancialLedgerEntry"
ADD CONSTRAINT "FinancialLedgerEntry_values_check" CHECK (
    "amountCents" <> 0 AND
    char_length("idempotencyKey") BETWEEN 1 AND 200 AND
    ("evidenceReference" IS NULL OR char_length("evidenceReference") BETWEEN 1 AND 128)
);

ALTER TABLE "SettlementDivergence"
ADD CONSTRAINT "SettlementDivergence_values_check" CHECK (
    "code" ~ '^[A-Z0-9_]{1,64}$' AND
    char_length("reference") <= 128 AND
    ("decisionReference" IS NULL OR char_length("decisionReference") BETWEEN 1 AND 128) AND
    ("decisionNote" IS NULL OR char_length("decisionNote") <= 500)
),
ADD CONSTRAINT "SettlementDivergence_resolution_check" CHECK (
    ("status" = 'RESOLVED') = (
        "decision" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolvedByUserId" IS NOT NULL
    )
);

-- A settlement belongs to its charge's company and invoice, for good.
CREATE FUNCTION "payment_settlement_guard"() RETURNS trigger AS $$
DECLARE
    charge_company TEXT;
    charge_invoice TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."companyId" <> OLD."companyId"
           OR NEW."paymentChargeId" <> OLD."paymentChargeId"
           OR NEW."invoiceId" <> OLD."invoiceId" THEN
            RAISE EXCEPTION 'SETTLEMENT_OWNER_IMMUTABLE';
        END IF;
        RETURN NEW;
    END IF;
    SELECT "companyId", "invoiceId" INTO charge_company, charge_invoice
    FROM "PaymentCharge" WHERE id = NEW."paymentChargeId";
    IF charge_company IS DISTINCT FROM NEW."companyId"
       OR charge_invoice IS DISTINCT FROM NEW."invoiceId" THEN
        RAISE EXCEPTION 'SETTLEMENT_CHARGE_MISMATCH';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentSettlement_guard"
BEFORE INSERT OR UPDATE ON "PaymentSettlement"
FOR EACH ROW EXECUTE FUNCTION "payment_settlement_guard"();

-- The ledger is append-only and each entry matches its settlement.
CREATE FUNCTION "financial_ledger_guard"() RETURNS trigger AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'LEDGER_APPEND_ONLY';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "PaymentSettlement"
        WHERE id = NEW."settlementId"
          AND "companyId" = NEW."companyId"
          AND "paymentChargeId" = NEW."paymentChargeId"
    ) THEN
        RAISE EXCEPTION 'LEDGER_SETTLEMENT_MISMATCH';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinancialLedgerEntry_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "FinancialLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "financial_ledger_guard"();

-- Evidence is a record of what was seen in the statement: never rewritten.
CREATE FUNCTION "platform_fee_evidence_guard"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'EVIDENCE_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PlatformFeeEvidence_guard"
BEFORE UPDATE OR DELETE ON "PlatformFeeEvidence"
FOR EACH ROW EXECUTE FUNCTION "platform_fee_evidence_guard"();

-- Divergences follow their settlement's company; a resolved one is final.
CREATE FUNCTION "settlement_divergence_guard"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'DIVERGENCE_PERMANENT';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD."status" = 'RESOLVED' THEN
            RAISE EXCEPTION 'DIVERGENCE_RESOLVED';
        END IF;
        IF NEW."settlementId" <> OLD."settlementId" OR NEW."companyId" <> OLD."companyId"
           OR NEW."code" <> OLD."code" OR NEW."reference" <> OLD."reference" THEN
            RAISE EXCEPTION 'DIVERGENCE_IDENTITY_IMMUTABLE';
        END IF;
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "PaymentSettlement"
        WHERE id = NEW."settlementId" AND "companyId" = NEW."companyId"
    ) THEN
        RAISE EXCEPTION 'DIVERGENCE_SETTLEMENT_MISMATCH';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SettlementDivergence_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SettlementDivergence"
FOR EACH ROW EXECUTE FUNCTION "settlement_divergence_guard"();
