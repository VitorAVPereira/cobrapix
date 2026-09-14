-- CreateEnum
CREATE TYPE "EfiOnboardingStatus" AS ENUM ('DRAFT', 'NOTICE_PENDING', 'AWAITING_REPRESENTATIVE', 'EFI_PROCESSING', 'SUBMISSION_UNCERTAIN', 'PROVISIONING', 'ACTIVE', 'REFUSED', 'CORRECTION_REQUIRED', 'CONFIGURATION_ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "PaymentFeeKind" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "PaymentChargeStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'PAID', 'CANCELED', 'EXPIRED', 'REPLACED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "IntegrationHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "PlatformIntegration" AS ENUM ('META', 'RESEND', 'EFI_ONBOARDING', 'EFI_PAYMENTS');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "tradeName" TEXT;

-- AlterTable
ALTER TABLE "GatewayAccount" ADD COLUMN     "certificateExpiresAt" TIMESTAMP(3),
ADD COLUMN     "certificateFingerprint" TEXT,
ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "credentialKeyVersion" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "healthStatus" "IntegrationHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "lastValidatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EfiOnboarding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "EfiOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "simplifiedAccountRequestId" TEXT,
    "submissionIdempotencyKey" TEXT,
    "submissionAttempts" INTEGER NOT NULL DEFAULT 0,
    "noticeAttempts" INTEGER NOT NULL DEFAULT 0,
    "provisioningAttempts" INTEGER NOT NULL DEFAULT 0,
    "reminderAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "nextReminderAt" TIMESTAMP(3),
    "retryBlockedUntil" TIMESTAMP(3),
    "lastProgressAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "noticeAcceptedAt" TIMESTAMP(3),
    "refusalAt" TIMESTAMP(3),
    "adminAlertedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "sensitiveDataExpiresAt" TIMESTAMP(3),
    "sensitiveDataDeletedAt" TIMESTAMP(3),
    "sanitizedErrorCode" TEXT,
    "sanitizedErrorMessage" TEXT,
    "consentAcceptedAt" TIMESTAMP(3),
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "consentDraftRevision" INTEGER,
    "consentUserId" TEXT,
    "consentIpAddress" TEXT,
    "authorizationTextVersion" TEXT,
    "termsVersion" TEXT,
    "privacyPolicyVersion" TEXT,
    "submittedCompanyDocument" TEXT,
    "provisioningCheckpoint" JSONB,
    "representativeNameEncrypted" TEXT,
    "representativeCpfEncrypted" TEXT,
    "representativeBirthDateEncrypted" TEXT,
    "representativeMotherNameEncrypted" TEXT,
    "representativeEmailEncrypted" TEXT,
    "representativePhoneEncrypted" TEXT,
    "sensitiveDataKeyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EfiOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentFeeVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "billingMethod" "BillingMethod" NOT NULL,
    "version" INTEGER NOT NULL,
    "efiFeeKind" "PaymentFeeKind" NOT NULL,
    "efiFeeAmountCents" INTEGER,
    "efiFeeBasisPoints" INTEGER,
    "platformFeeKind" "PaymentFeeKind" NOT NULL,
    "platformFeeAmountCents" INTEGER,
    "platformFeeBasisPoints" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentFeeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCharge" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "feeVersionId" TEXT NOT NULL,
    "replacesChargeId" TEXT,
    "billingMethod" "BillingMethod" NOT NULL,
    "status" "PaymentChargeStatus" NOT NULL DEFAULT 'DRAFT',
    "grossAmountCents" INTEGER NOT NULL,
    "estimatedEfiFeeCents" INTEGER NOT NULL,
    "estimatedPlatformFeeCents" INTEGER NOT NULL,
    "effectiveEfiFeeCents" INTEGER,
    "effectivePlatformFeeCents" INTEGER,
    "feeSnapshot" JSONB NOT NULL,
    "gatewayId" TEXT,
    "efiTxid" TEXT,
    "efiChargeId" TEXT,
    "efiLocId" TEXT,
    "splitConfigId" TEXT,
    "pixPayload" TEXT,
    "boletoLine" TEXT,
    "paymentUrl" TEXT,
    "gatewayStatusRaw" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformIntegrationState" (
    "id" TEXT NOT NULL,
    "integration" "PlatformIntegration" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "healthStatus" "IntegrationHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastHealthyAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "sanitizedLastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformIntegrationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationConversation" (
    "id" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "recipientEncrypted" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'NEW',
    "lastInboundAt" TIMESTAMP(3),
    "serviceWindowExpiresAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "recipientAnonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "companyId" TEXT,
    "invoiceId" TEXT,
    "debtorId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "status" TEXT,
    "readAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EfiOnboarding_companyId_key" ON "EfiOnboarding"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EfiOnboarding_simplifiedAccountRequestId_key" ON "EfiOnboarding"("simplifiedAccountRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "EfiOnboarding_submissionIdempotencyKey_key" ON "EfiOnboarding"("submissionIdempotencyKey");

-- CreateIndex
CREATE INDEX "EfiOnboarding_status_updatedAt_idx" ON "EfiOnboarding"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "EfiOnboarding_nextReminderAt_idx" ON "EfiOnboarding"("nextReminderAt");

-- CreateIndex
CREATE INDEX "EfiOnboarding_sensitiveDataExpiresAt_idx" ON "EfiOnboarding"("sensitiveDataExpiresAt");

-- CreateIndex
CREATE INDEX "PaymentFeeVersion_companyId_billingMethod_effectiveFrom_idx" ON "PaymentFeeVersion"("companyId", "billingMethod", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PaymentFeeVersion_scopeKey_billingMethod_effectiveFrom_idx" ON "PaymentFeeVersion"("scopeKey", "billingMethod", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentFeeVersion_scopeKey_billingMethod_version_key" ON "PaymentFeeVersion"("scopeKey", "billingMethod", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Debtor_id_companyId_key" ON "Debtor"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_id_companyId_key" ON "Invoice"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCharge_id_companyId_invoiceId_key" ON "PaymentCharge"("id", "companyId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCharge_replacesChargeId_companyId_invoiceId_key" ON "PaymentCharge"("replacesChargeId", "companyId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCharge_gatewayId_key" ON "PaymentCharge"("gatewayId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCharge_efiTxid_key" ON "PaymentCharge"("efiTxid");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCharge_efiChargeId_key" ON "PaymentCharge"("efiChargeId");

-- CreateIndex
CREATE INDEX "PaymentCharge_companyId_status_createdAt_idx" ON "PaymentCharge"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentCharge_invoiceId_createdAt_idx" ON "PaymentCharge"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentCharge_feeVersionId_idx" ON "PaymentCharge"("feeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformIntegrationState_integration_key" ON "PlatformIntegrationState"("integration");

-- CreateIndex
CREATE INDEX "PlatformIntegrationState_healthStatus_updatedAt_idx" ON "PlatformIntegrationState"("healthStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "CommunicationConversation_status_updatedAt_idx" ON "CommunicationConversation"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CommunicationConversation_retentionExpiresAt_idx" ON "CommunicationConversation"("retentionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationConversation_channel_recipientHash_key" ON "CommunicationConversation"("channel", "recipientHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessage_externalMessageId_key" ON "CommunicationMessage"("externalMessageId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_conversationId_createdAt_idx" ON "CommunicationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_companyId_direction_createdAt_idx" ON "CommunicationMessage"("companyId", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_invoiceId_idx" ON "CommunicationMessage"("invoiceId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_retentionExpiresAt_idx" ON "CommunicationMessage"("retentionExpiresAt");

-- AddForeignKey
ALTER TABLE "EfiOnboarding" ADD CONSTRAINT "EfiOnboarding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EfiOnboarding" ADD CONSTRAINT "EfiOnboarding_consentUserId_companyId_fkey" FOREIGN KEY ("consentUserId", "companyId") REFERENCES "User"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentFeeVersion" ADD CONSTRAINT "PaymentFeeVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentFeeVersion" ADD CONSTRAINT "PaymentFeeVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_invoiceId_companyId_fkey" FOREIGN KEY ("invoiceId", "companyId") REFERENCES "Invoice"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_feeVersionId_fkey" FOREIGN KEY ("feeVersionId") REFERENCES "PaymentFeeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_replacesChargeId_companyId_invoiceId_fkey" FOREIGN KEY ("replacesChargeId", "companyId", "invoiceId") REFERENCES "PaymentCharge"("id", "companyId", "invoiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CommunicationConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_invoiceId_companyId_fkey" FOREIGN KEY ("invoiceId", "companyId") REFERENCES "Invoice"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_debtorId_companyId_fkey" FOREIGN KEY ("debtorId", "companyId") REFERENCES "Debtor"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve every charge lifecycle transition independently from the current row.
CREATE TABLE "PaymentChargeStatusHistory" (
    "id" TEXT NOT NULL,
    "paymentChargeId" TEXT NOT NULL,
    "previousStatus" "PaymentChargeStatus",
    "status" "PaymentChargeStatus" NOT NULL,
    "providerStatus" TEXT,
    "sanitizedDetails" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentChargeStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentChargeStatusHistory_paymentChargeId_occurredAt_idx"
ON "PaymentChargeStatusHistory"("paymentChargeId", "occurredAt");

ALTER TABLE "PaymentChargeStatusHistory"
ADD CONSTRAINT "PaymentChargeStatusHistory_paymentChargeId_fkey"
FOREIGN KEY ("paymentChargeId") REFERENCES "PaymentCharge"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD COLUMN "retentionExpiresAt" TIMESTAMP(3);
CREATE INDEX "AuditLog_retentionExpiresAt_idx" ON "AuditLog"("retentionExpiresAt");

-- Fee components use the same discriminated-union contract as the domain types.
ALTER TABLE "PaymentFeeVersion"
ADD CONSTRAINT "PaymentFeeVersion_scope_check" CHECK (
    ("companyId" IS NULL AND "scopeKey" = 'GLOBAL') OR
    ("companyId" IS NOT NULL AND "scopeKey" = "companyId")
),
ADD CONSTRAINT "PaymentFeeVersion_version_check" CHECK ("version" > 0),
ADD CONSTRAINT "PaymentFeeVersion_effective_range_check" CHECK (
    "effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"
),
ADD CONSTRAINT "PaymentFeeVersion_efi_component_check" CHECK (
    ("efiFeeKind" = 'FIXED' AND "efiFeeAmountCents" >= 0 AND "efiFeeBasisPoints" IS NULL) OR
    ("efiFeeKind" = 'PERCENTAGE' AND "efiFeeAmountCents" IS NULL AND "efiFeeBasisPoints" BETWEEN 0 AND 10000)
),
ADD CONSTRAINT "PaymentFeeVersion_platform_component_check" CHECK (
    ("platformFeeKind" = 'FIXED' AND "platformFeeAmountCents" >= 0 AND "platformFeeBasisPoints" IS NULL) OR
    ("platformFeeKind" = 'PERCENTAGE' AND "platformFeeAmountCents" IS NULL AND "platformFeeBasisPoints" BETWEEN 0 AND 10000)
);

ALTER TABLE "PaymentCharge"
ADD CONSTRAINT "PaymentCharge_amounts_check" CHECK (
    "grossAmountCents" > 0 AND
    "estimatedEfiFeeCents" >= 0 AND
    "estimatedPlatformFeeCents" >= 0 AND
    ("effectiveEfiFeeCents" IS NULL OR "effectiveEfiFeeCents" >= 0) AND
    ("effectivePlatformFeeCents" IS NULL OR "effectivePlatformFeeCents" >= 0)
);

ALTER TABLE "CommunicationMessage"
ADD CONSTRAINT "CommunicationMessage_context_check" CHECK (
    "companyId" IS NOT NULL OR ("invoiceId" IS NULL AND "debtorId" IS NULL)
);

ALTER TABLE "EfiOnboarding"
ADD CONSTRAINT "EfiOnboarding_attempts_check" CHECK (
    "submissionAttempts" >= 0 AND
    "noticeAttempts" >= 0 AND
    "provisioningAttempts" >= 0 AND
    "reminderAttempts" >= 0 AND
    "draftRevision" >= 0 AND
    ("consentDraftRevision" IS NULL OR "consentDraftRevision" >= 0)
);

ALTER TABLE "GatewayAccount"
ADD CONSTRAINT "GatewayAccount_consecutiveFailures_check" CHECK ("consecutiveFailures" >= 0);

ALTER TABLE "PlatformIntegrationState"
ADD CONSTRAINT "PlatformIntegrationState_consecutiveFailures_check" CHECK ("consecutiveFailures" >= 0);

-- Historical fee rows are append-only so an emitted charge always points to
-- the exact configuration that was in force at issuance time.
CREATE FUNCTION "reject_payment_fee_version_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'PaymentFeeVersion rows are immutable; create a new version';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentFeeVersion_immutable_update"
BEFORE UPDATE ON "PaymentFeeVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_payment_fee_version_mutation"();

CREATE TRIGGER "PaymentFeeVersion_immutable_delete"
BEFORE DELETE ON "PaymentFeeVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_payment_fee_version_mutation"();

-- A charge may use a global fee or its own tenant override, but the payment
-- method must always match the selected version.
CREATE FUNCTION "validate_payment_charge_fee_version"() RETURNS trigger AS $$
DECLARE
    fee_company_id TEXT;
    fee_billing_method "BillingMethod";
BEGIN
    SELECT "companyId", "billingMethod"
    INTO fee_company_id, fee_billing_method
    FROM "PaymentFeeVersion"
    WHERE "id" = NEW."feeVersionId";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PaymentCharge fee version does not exist';
    END IF;

    IF fee_company_id IS NOT NULL AND fee_company_id <> NEW."companyId" THEN
        RAISE EXCEPTION 'PaymentCharge fee version belongs to another company';
    END IF;

    IF fee_billing_method <> NEW."billingMethod" THEN
        RAISE EXCEPTION 'PaymentCharge billing method differs from fee version';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentCharge_validate_fee_version"
BEFORE INSERT OR UPDATE OF "companyId", "billingMethod", "feeVersionId"
ON "PaymentCharge"
FOR EACH ROW EXECUTE FUNCTION "validate_payment_charge_fee_version"();
