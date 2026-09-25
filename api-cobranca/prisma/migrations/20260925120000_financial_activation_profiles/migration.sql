-- Financial activation, phase A: versioned financial profile, Efí account
-- identities, credential versions, validation attempts, charge context and
-- late-payment terms. The unused per-company split percentages are removed.

-- CreateEnum
CREATE TYPE "EfiEnvironment" AS ENUM ('HOMOLOGATION', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "EfiAccountOwnership" AS ENUM ('PLATFORM', 'COMPANY');

-- CreateEnum
CREATE TYPE "EfiCredentialStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'RETIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FinancialActivationOrigin" AS ENUM ('AUTOMATIC_OPENING', 'MANUAL_ADMIN');

-- CreateEnum
CREATE TYPE "FinancialAccountMode" AS ENUM ('CUSTOMER_ACCOUNT', 'PLATFORM_ACCOUNT');

-- CreateEnum
CREATE TYPE "FinancialPayoutMode" AS ENUM ('DIRECT_TO_CUSTOMER', 'EFI_SPLIT', 'MANUAL');

-- CreateEnum
CREATE TYPE "FinancialProfileStatus" AS ENUM ('DRAFT', 'VALIDATING', 'READY', 'VALIDATION_FAILED', 'ACTIVE', 'SUPERSEDED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FinancialAuthorizationKind" AS ENUM ('ACCOUNT_OPENING_CONSENT', 'ACCOUNT_INTEGRATION_AUTHORIZATION', 'POWER_OF_ATTORNEY');

-- CreateEnum
CREATE TYPE "FinancialValidationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "Company" DROP COLUMN "onTimeSplitPercentageBps",
DROP COLUMN "overdueSplitPercentageBps",
ADD COLUMN     "activeFinancialProfileId" TEXT,
ADD COLUMN     "defaultLateFineBasisPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "defaultLateInterestMonthlyBasisPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "defaultPaymentDaysAfterDue" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GatewayAccount" ADD COLUMN     "efiAccountIdentityId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "lateFineBasisPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateInterestMonthlyBasisPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentDaysAfterDue" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PaymentCharge" ADD COLUMN     "accountMode" "FinancialAccountMode",
ADD COLUMN     "distributionSnapshot" JSONB,
ADD COLUMN     "financialEnvironment" "EfiEnvironment",
ADD COLUMN     "financialProfileId" TEXT,
ADD COLUMN     "issuerCredentialVersionId" TEXT,
ADD COLUMN     "issuerIdentityId" TEXT,
ADD COLUMN     "lateFineBasisPoints" INTEGER,
ADD COLUMN     "lateInterestMonthlyBasisPoints" INTEGER,
ADD COLUMN     "paymentDaysAfterDue" INTEGER,
ADD COLUMN     "payoutMode" "FinancialPayoutMode";

-- AlterTable
ALTER TABLE "RecurringInvoice" ADD COLUMN     "lateFineBasisPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateInterestMonthlyBasisPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentDaysAfterDue" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EfiAccountIdentity" (
    "id" TEXT NOT NULL,
    "ownership" "EfiAccountOwnership" NOT NULL,
    "companyId" TEXT,
    "environment" "EfiEnvironment" NOT NULL,
    "holderDocument" TEXT NOT NULL,
    "efiAccountNumber" TEXT NOT NULL,
    "efiAccountDigit" TEXT,
    "payeeCode" TEXT,
    "pixKey" TEXT,
    "healthStatus" "IntegrationHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastValidatedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "sanitizedLastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EfiAccountIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EfiCredentialVersion" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "EfiCredentialStatus" NOT NULL DEFAULT 'CANDIDATE',
    "encryptedClientId" TEXT NOT NULL,
    "encryptedClientSecret" TEXT NOT NULL,
    "encryptedCertificate" TEXT NOT NULL,
    "encryptedCertificatePassword" TEXT,
    "credentialKeyVersion" TEXT NOT NULL,
    "certificateFingerprint" TEXT NOT NULL,
    "certificateExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EfiCredentialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfileVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "FinancialProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "FinancialActivationOrigin" NOT NULL,
    "accountMode" "FinancialAccountMode" NOT NULL,
    "payoutMode" "FinancialPayoutMode" NOT NULL,
    "environment" "EfiEnvironment" NOT NULL,
    "enabledMethods" "BillingMethod"[],
    "issuerIdentityId" TEXT,
    "issuerCredentialVersionId" TEXT,
    "authorizationKind" "FinancialAuthorizationKind",
    "authorizationReference" TEXT,
    "authorizationValidUntil" TIMESTAMP(3),
    "ownershipVerifiedAt" TIMESTAMP(3),
    "ownershipVerifiedByUserId" TEXT,
    "ownershipEvidenceReference" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validationHash" TEXT,
    "creationIdempotencyKey" TEXT NOT NULL,
    "activationIdempotencyKey" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialValidationAttempt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileRevision" INTEGER NOT NULL,
    "credentialVersionId" TEXT,
    "status" "FinancialValidationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "steps" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "validationHash" TEXT,
    "sanitizedErrorCode" TEXT,
    "validUntil" TIMESTAMP(3),
    "requestedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialValidationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EfiAccountIdentity_companyId_idx" ON "EfiAccountIdentity"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EfiAccountIdentity_environment_efiAccountNumber_key" ON "EfiAccountIdentity"("environment", "efiAccountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EfiAccountIdentity_id_companyId_key" ON "EfiAccountIdentity"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EfiCredentialVersion_identityId_version_key" ON "EfiCredentialVersion"("identityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EfiCredentialVersion_id_identityId_key" ON "EfiCredentialVersion"("id", "identityId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfileVersion_creationIdempotencyKey_key" ON "FinancialProfileVersion"("creationIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfileVersion_activationIdempotencyKey_key" ON "FinancialProfileVersion"("activationIdempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialProfileVersion_companyId_status_idx" ON "FinancialProfileVersion"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfileVersion_companyId_version_key" ON "FinancialProfileVersion"("companyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfileVersion_id_companyId_key" ON "FinancialProfileVersion"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialValidationAttempt_idempotencyKey_key" ON "FinancialValidationAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialValidationAttempt_profileId_profileRevision_idx" ON "FinancialValidationAttempt"("profileId", "profileRevision");

-- CreateIndex
CREATE INDEX "FinancialValidationAttempt_status_nextRunAt_idx" ON "FinancialValidationAttempt"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "Company_activeFinancialProfileId_key" ON "Company"("activeFinancialProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayAccount_efiAccountIdentityId_key" ON "GatewayAccount"("efiAccountIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayAccount_efiAccountIdentityId_companyId_key" ON "GatewayAccount"("efiAccountIdentityId", "companyId");

-- CreateIndex
CREATE INDEX "PaymentCharge_financialProfileId_idx" ON "PaymentCharge"("financialProfileId");

-- CreateIndex
CREATE INDEX "PaymentCharge_issuerIdentityId_idx" ON "PaymentCharge"("issuerIdentityId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_activeFinancialProfileId_fkey" FOREIGN KEY ("activeFinancialProfileId") REFERENCES "FinancialProfileVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GatewayAccount" ADD CONSTRAINT "GatewayAccount_efiAccountIdentityId_companyId_fkey" FOREIGN KEY ("efiAccountIdentityId", "companyId") REFERENCES "EfiAccountIdentity"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_financialProfileId_companyId_fkey" FOREIGN KEY ("financialProfileId", "companyId") REFERENCES "FinancialProfileVersion"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_issuerIdentityId_fkey" FOREIGN KEY ("issuerIdentityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_issuerCredentialVersionId_issuerIdentityId_fkey" FOREIGN KEY ("issuerCredentialVersionId", "issuerIdentityId") REFERENCES "EfiCredentialVersion"("id", "identityId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EfiAccountIdentity" ADD CONSTRAINT "EfiAccountIdentity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EfiCredentialVersion" ADD CONSTRAINT "EfiCredentialVersion_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EfiCredentialVersion" ADD CONSTRAINT "EfiCredentialVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfileVersion" ADD CONSTRAINT "FinancialProfileVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfileVersion" ADD CONSTRAINT "FinancialProfileVersion_issuerIdentityId_fkey" FOREIGN KEY ("issuerIdentityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialProfileVersion" ADD CONSTRAINT "FinancialProfileVersion_issuerCredentialVersionId_issuerId_fkey" FOREIGN KEY ("issuerCredentialVersionId", "issuerIdentityId") REFERENCES "EfiCredentialVersion"("id", "identityId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialProfileVersion" ADD CONSTRAINT "FinancialProfileVersion_ownershipVerifiedByUserId_fkey" FOREIGN KEY ("ownershipVerifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfileVersion" ADD CONSTRAINT "FinancialProfileVersion_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfileVersion" ADD CONSTRAINT "FinancialProfileVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialValidationAttempt" ADD CONSTRAINT "FinancialValidationAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialValidationAttempt" ADD CONSTRAINT "FinancialValidationAttempt_profileId_companyId_fkey" FOREIGN KEY ("profileId", "companyId") REFERENCES "FinancialProfileVersion"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialValidationAttempt" ADD CONSTRAINT "FinancialValidationAttempt_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity rules Prisma cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE "Company"
ADD CONSTRAINT "Company_late_terms_check" CHECK (
    "defaultLateFineBasisPoints" BETWEEN 0 AND 1000 AND
    "defaultLateInterestMonthlyBasisPoints" BETWEEN 0 AND 10000 AND
    "defaultPaymentDaysAfterDue" >= 0
);

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_late_terms_check" CHECK (
    "lateFineBasisPoints" BETWEEN 0 AND 1000 AND
    "lateInterestMonthlyBasisPoints" BETWEEN 0 AND 10000 AND
    "paymentDaysAfterDue" >= 0
);

ALTER TABLE "RecurringInvoice"
ADD CONSTRAINT "RecurringInvoice_late_terms_check" CHECK (
    "lateFineBasisPoints" BETWEEN 0 AND 1000 AND
    "lateInterestMonthlyBasisPoints" BETWEEN 0 AND 10000 AND
    "paymentDaysAfterDue" >= 0
);

ALTER TABLE "EfiAccountIdentity"
ADD CONSTRAINT "EfiAccountIdentity_ownership_check" CHECK (
    ("ownership" = 'PLATFORM' AND "companyId" IS NULL) OR
    ("ownership" = 'COMPANY' AND "companyId" IS NOT NULL)
),
ADD CONSTRAINT "EfiAccountIdentity_document_check" CHECK ("holderDocument" ~ '^([0-9]{11}|[0-9]{14})$'),
ADD CONSTRAINT "EfiAccountIdentity_account_check" CHECK ("efiAccountNumber" ~ '^[0-9]{1,20}$'),
ADD CONSTRAINT "EfiAccountIdentity_consecutiveFailures_check" CHECK ("consecutiveFailures" >= 0);

-- One central account per environment; companies share it by reference.
CREATE UNIQUE INDEX "EfiAccountIdentity_platform_environment_key"
ON "EfiAccountIdentity" ("environment") WHERE "ownership" = 'PLATFORM';

ALTER TABLE "EfiCredentialVersion"
ADD CONSTRAINT "EfiCredentialVersion_version_check" CHECK ("version" > 0),
ADD CONSTRAINT "EfiCredentialVersion_fingerprint_check" CHECK (
    "certificateFingerprint" ~ '^([0-9A-F]{2}:){31}[0-9A-F]{2}$'
);

CREATE UNIQUE INDEX "EfiCredentialVersion_active_identity_key"
ON "EfiCredentialVersion" ("identityId") WHERE "status" = 'ACTIVE';

ALTER TABLE "FinancialProfileVersion"
ADD CONSTRAINT "FinancialProfileVersion_mode_check" CHECK (
    ("accountMode" = 'CUSTOMER_ACCOUNT' AND "payoutMode" = 'DIRECT_TO_CUSTOMER') OR
    ("accountMode" = 'PLATFORM_ACCOUNT' AND "payoutMode" IN ('EFI_SPLIT', 'MANUAL'))
),
ADD CONSTRAINT "FinancialProfileVersion_origin_check" CHECK (
    "origin" = 'MANUAL_ADMIN' OR "accountMode" = 'CUSTOMER_ACCOUNT'
),
ADD CONSTRAINT "FinancialProfileVersion_authorization_check" CHECK (
    "authorizationKind" IS NULL OR
    ("accountMode" = 'PLATFORM_ACCOUNT' AND "authorizationKind" = 'POWER_OF_ATTORNEY') OR
    ("accountMode" = 'CUSTOMER_ACCOUNT' AND "origin" = 'AUTOMATIC_OPENING' AND "authorizationKind" = 'ACCOUNT_OPENING_CONSENT') OR
    ("accountMode" = 'CUSTOMER_ACCOUNT' AND "origin" = 'MANUAL_ADMIN' AND "authorizationKind" = 'ACCOUNT_INTEGRATION_AUTHORIZATION')
),
ADD CONSTRAINT "FinancialProfileVersion_methods_check" CHECK (
    cardinality("enabledMethods") > 0 AND
    "enabledMethods" <@ ARRAY['PIX', 'BOLIX']::"BillingMethod"[]
),
ADD CONSTRAINT "FinancialProfileVersion_counters_check" CHECK ("version" > 0 AND "revision" > 0),
-- A profile can only be READY or published once issuer, credential,
-- ownership, authorization and validation are all recorded.
ADD CONSTRAINT "FinancialProfileVersion_ready_check" CHECK (
    "status" NOT IN ('READY', 'ACTIVE', 'SUPERSEDED') OR (
        "issuerIdentityId" IS NOT NULL AND
        "issuerCredentialVersionId" IS NOT NULL AND
        "authorizationKind" IS NOT NULL AND
        "authorizationReference" IS NOT NULL AND
        "ownershipVerifiedAt" IS NOT NULL AND
        "validatedAt" IS NOT NULL AND
        "validationHash" IS NOT NULL
    )
),
ADD CONSTRAINT "FinancialProfileVersion_published_check" CHECK (
    "status" NOT IN ('ACTIVE', 'SUPERSEDED') OR
    ("activatedAt" IS NOT NULL AND "activationIdempotencyKey" IS NOT NULL)
);

CREATE UNIQUE INDEX "FinancialProfileVersion_active_company_key"
ON "FinancialProfileVersion" ("companyId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "FinancialProfileVersion_open_candidate_company_key"
ON "FinancialProfileVersion" ("companyId")
WHERE "status" IN ('DRAFT', 'VALIDATING', 'READY', 'VALIDATION_FAILED');

ALTER TABLE "FinancialValidationAttempt"
ADD CONSTRAINT "FinancialValidationAttempt_counters_check" CHECK (
    "profileRevision" > 0 AND "attempts" >= 0
);

-- Charge context is all-or-nothing: either a legacy row without context or a
-- complete snapshot of the profile that issued it.
ALTER TABLE "PaymentCharge"
ADD CONSTRAINT "PaymentCharge_financial_context_check" CHECK (
    (
        "financialProfileId" IS NULL AND "issuerIdentityId" IS NULL AND
        "issuerCredentialVersionId" IS NULL AND "accountMode" IS NULL AND
        "payoutMode" IS NULL AND "financialEnvironment" IS NULL AND
        "distributionSnapshot" IS NULL
    ) OR (
        "financialProfileId" IS NOT NULL AND "issuerIdentityId" IS NOT NULL AND
        "issuerCredentialVersionId" IS NOT NULL AND "accountMode" IS NOT NULL AND
        "payoutMode" IS NOT NULL AND "financialEnvironment" IS NOT NULL AND
        "distributionSnapshot" IS NOT NULL
    )
),
ADD CONSTRAINT "PaymentCharge_late_terms_check" CHECK (
    (
        "lateFineBasisPoints" IS NULL AND "lateInterestMonthlyBasisPoints" IS NULL AND
        "paymentDaysAfterDue" IS NULL
    ) OR (
        "lateFineBasisPoints" IS NOT NULL AND "lateFineBasisPoints" BETWEEN 0 AND 1000 AND
        "lateInterestMonthlyBasisPoints" IS NOT NULL AND "lateInterestMonthlyBasisPoints" BETWEEN 0 AND 10000 AND
        "paymentDaysAfterDue" IS NOT NULL AND "paymentDaysAfterDue" >= 0
    )
);

-- Identity facts never change; a different account is a different identity.
CREATE FUNCTION "reject_efi_identity_mutation"() RETURNS trigger AS $$
BEGIN
    IF NEW."ownership" IS DISTINCT FROM OLD."ownership" OR
       NEW."companyId" IS DISTINCT FROM OLD."companyId" OR
       NEW."environment" IS DISTINCT FROM OLD."environment" OR
       NEW."holderDocument" IS DISTINCT FROM OLD."holderDocument" OR
       NEW."efiAccountNumber" IS DISTINCT FROM OLD."efiAccountNumber" THEN
        RAISE EXCEPTION 'EfiAccountIdentity identity fields are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EfiAccountIdentity_immutable_identity"
BEFORE UPDATE ON "EfiAccountIdentity"
FOR EACH ROW EXECUTE FUNCTION "reject_efi_identity_mutation"();

-- Encrypted blobs may be re-encrypted by key rotation; what they contain may not.
CREATE FUNCTION "reject_efi_credential_mutation"() RETURNS trigger AS $$
BEGIN
    IF NEW."identityId" IS DISTINCT FROM OLD."identityId" OR
       NEW."version" IS DISTINCT FROM OLD."version" OR
       NEW."certificateFingerprint" IS DISTINCT FROM OLD."certificateFingerprint" OR
       NEW."certificateExpiresAt" IS DISTINCT FROM OLD."certificateExpiresAt" THEN
        RAISE EXCEPTION 'EfiCredentialVersion identity fields are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EfiCredentialVersion_immutable_identity"
BEFORE UPDATE ON "EfiCredentialVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_efi_credential_mutation"();

-- The issuer must match the account mode: the company's own identity for
-- CUSTOMER_ACCOUNT, the shared central identity for PLATFORM_ACCOUNT, always
-- in the profile's environment.
CREATE FUNCTION "validate_financial_profile_issuer"() RETURNS trigger AS $$
DECLARE
    identity_ownership "EfiAccountOwnership";
    identity_company_id TEXT;
    identity_environment "EfiEnvironment";
BEGIN
    IF NEW."issuerIdentityId" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "ownership", "companyId", "environment"
    INTO identity_ownership, identity_company_id, identity_environment
    FROM "EfiAccountIdentity"
    WHERE "id" = NEW."issuerIdentityId";

    IF identity_environment <> NEW."environment" THEN
        RAISE EXCEPTION 'FinancialProfileVersion issuer environment differs';
    END IF;

    IF NEW."accountMode" = 'CUSTOMER_ACCOUNT' AND (
        identity_ownership <> 'COMPANY' OR identity_company_id <> NEW."companyId"
    ) THEN
        RAISE EXCEPTION 'FinancialProfileVersion issuer must be the company account';
    END IF;

    IF NEW."accountMode" = 'PLATFORM_ACCOUNT' AND identity_ownership <> 'PLATFORM' THEN
        RAISE EXCEPTION 'FinancialProfileVersion issuer must be the platform account';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinancialProfileVersion_validate_issuer"
BEFORE INSERT OR UPDATE OF "issuerIdentityId", "accountMode", "environment", "companyId"
ON "FinancialProfileVersion"
FOR EACH ROW EXECUTE FUNCTION "validate_financial_profile_issuer"();

-- Published profiles are frozen: the only change allowed is ACTIVE ->
-- SUPERSEDED. Terminal candidates are frozen as well.
CREATE FUNCTION "reject_published_financial_profile_mutation"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" IN ('ACTIVE', 'SUPERSEDED') THEN
            RAISE EXCEPTION 'Published FinancialProfileVersion rows cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD."status" IN ('ACTIVE', 'SUPERSEDED', 'CANCELED', 'EXPIRED') THEN
        IF NOT (
            OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' AND
            (to_jsonb(NEW) - 'status' - 'supersededAt' - 'updatedAt') =
            (to_jsonb(OLD) - 'status' - 'supersededAt' - 'updatedAt')
        ) THEN
            RAISE EXCEPTION 'FinancialProfileVersion % is immutable', OLD."status";
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinancialProfileVersion_immutable_update"
BEFORE UPDATE ON "FinancialProfileVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_published_financial_profile_mutation"();

CREATE TRIGGER "FinancialProfileVersion_immutable_delete"
BEFORE DELETE ON "FinancialProfileVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_published_financial_profile_mutation"();

-- At commit, a company either has no ACTIVE profile and no pointer, or its
-- pointer references its single ACTIVE profile. Deferred so the activation
-- transaction may supersede, activate and move the pointer in any order.
CREATE FUNCTION "check_company_financial_profile"(target_company_id TEXT) RETURNS void AS $$
DECLARE
    pointer_id TEXT;
    active_id TEXT;
BEGIN
    SELECT "activeFinancialProfileId" INTO pointer_id
    FROM "Company" WHERE "id" = target_company_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT "id" INTO active_id
    FROM "FinancialProfileVersion"
    WHERE "companyId" = target_company_id AND "status" = 'ACTIVE';

    IF pointer_id IS DISTINCT FROM active_id THEN
        RAISE EXCEPTION 'Company active financial profile pointer is inconsistent';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "check_company_financial_profile_from_company"() RETURNS trigger AS $$
BEGIN
    PERFORM "check_company_financial_profile"(NEW."id");
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "check_company_financial_profile_from_profile"() RETURNS trigger AS $$
BEGIN
    PERFORM "check_company_financial_profile"(NEW."companyId");
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Company_financial_profile_consistency"
AFTER INSERT OR UPDATE OF "activeFinancialProfileId" ON "Company"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_company_financial_profile_from_company"();

CREATE CONSTRAINT TRIGGER "FinancialProfileVersion_company_consistency"
AFTER INSERT OR UPDATE OF "status" ON "FinancialProfileVersion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_company_financial_profile_from_profile"();

-- A new charge copies its context from an ACTIVE profile of the same company.
-- Legacy charges never gain a context afterwards, and a recorded context and
-- its late-payment terms are immutable.
CREATE FUNCTION "validate_payment_charge_financial_context"() RETURNS trigger AS $$
DECLARE
    profile RECORD;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD."financialProfileId" IS NULL AND NEW."financialProfileId" IS NOT NULL THEN
            RAISE EXCEPTION 'PaymentCharge context cannot be attached after creation';
        END IF;
        IF OLD."financialProfileId" IS NOT NULL AND (
            NEW."financialProfileId" IS DISTINCT FROM OLD."financialProfileId" OR
            NEW."issuerIdentityId" IS DISTINCT FROM OLD."issuerIdentityId" OR
            NEW."issuerCredentialVersionId" IS DISTINCT FROM OLD."issuerCredentialVersionId" OR
            NEW."accountMode" IS DISTINCT FROM OLD."accountMode" OR
            NEW."payoutMode" IS DISTINCT FROM OLD."payoutMode" OR
            NEW."financialEnvironment" IS DISTINCT FROM OLD."financialEnvironment" OR
            NEW."distributionSnapshot" IS DISTINCT FROM OLD."distributionSnapshot"
        ) THEN
            RAISE EXCEPTION 'PaymentCharge financial context is immutable';
        END IF;
        IF OLD."lateFineBasisPoints" IS NOT NULL AND (
            NEW."lateFineBasisPoints" IS DISTINCT FROM OLD."lateFineBasisPoints" OR
            NEW."lateInterestMonthlyBasisPoints" IS DISTINCT FROM OLD."lateInterestMonthlyBasisPoints" OR
            NEW."paymentDaysAfterDue" IS DISTINCT FROM OLD."paymentDaysAfterDue"
        ) THEN
            RAISE EXCEPTION 'PaymentCharge late-payment terms are immutable';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."financialProfileId" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "status", "accountMode", "payoutMode", "environment",
           "issuerIdentityId", "issuerCredentialVersionId", "enabledMethods"
    INTO profile
    FROM "FinancialProfileVersion"
    WHERE "id" = NEW."financialProfileId" AND "companyId" = NEW."companyId";

    IF NOT FOUND OR profile."status" <> 'ACTIVE' THEN
        RAISE EXCEPTION 'PaymentCharge requires an ACTIVE financial profile of its company';
    END IF;

    IF NEW."issuerIdentityId" IS DISTINCT FROM profile."issuerIdentityId" OR
       NEW."accountMode" IS DISTINCT FROM profile."accountMode" OR
       NEW."payoutMode" IS DISTINCT FROM profile."payoutMode" OR
       NEW."financialEnvironment" IS DISTINCT FROM profile."environment" THEN
        RAISE EXCEPTION 'PaymentCharge context differs from its financial profile';
    END IF;

    IF NOT (NEW."billingMethod" = ANY (profile."enabledMethods")) THEN
        RAISE EXCEPTION 'PaymentCharge billing method is not enabled by its financial profile';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentCharge_validate_financial_context"
BEFORE INSERT OR UPDATE ON "PaymentCharge"
FOR EACH ROW EXECUTE FUNCTION "validate_payment_charge_financial_context"();
