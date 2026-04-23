ALTER TABLE "Company"
ALTER COLUMN "gatewayProvider" SET DEFAULT 'EFI';

UPDATE "Company"
SET "gatewayProvider" = 'EFI'
WHERE "gatewayProvider" = 'ASAAS'
  AND "gatewayAccountId" IS NULL
  AND "gatewayApiKey" IS NULL;

CREATE TABLE IF NOT EXISTS "GatewayAccount" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'EFI',
  "environment" TEXT NOT NULL DEFAULT 'homologation',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payeeCode" TEXT NOT NULL,
  "efiAccountNumber" TEXT NOT NULL,
  "efiAccountDigit" TEXT,
  "pixKey" TEXT NOT NULL,
  "encryptedClientId" TEXT NOT NULL,
  "encryptedClientSecret" TEXT NOT NULL,
  "encryptedCertificate" TEXT,
  "certificatePath" TEXT,
  "encryptedCertificatePassword" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GatewayAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GatewayAccount_companyId_key" ON "GatewayAccount"("companyId");
CREATE INDEX IF NOT EXISTS "GatewayAccount_companyId_idx" ON "GatewayAccount"("companyId");
CREATE INDEX IF NOT EXISTS "GatewayAccount_provider_environment_idx" ON "GatewayAccount"("provider", "environment");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GatewayAccount_companyId_fkey'
  ) THEN
    ALTER TABLE "GatewayAccount"
    ADD CONSTRAINT "GatewayAccount_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "GatewayAccount"
ADD COLUMN IF NOT EXISTS "efiAccountDigit" TEXT,
ADD COLUMN IF NOT EXISTS "encryptedCertificate" TEXT;

CREATE TABLE IF NOT EXISTS "OriginalBankAccount" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "holderName" TEXT NOT NULL,
  "holderDocument" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "agency" TEXT NOT NULL,
  "account" TEXT NOT NULL,
  "accountDigit" TEXT,
  "accountType" TEXT NOT NULL DEFAULT 'CHECKING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OriginalBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OriginalBankAccount_companyId_key" ON "OriginalBankAccount"("companyId");
CREATE INDEX IF NOT EXISTS "OriginalBankAccount_companyId_idx" ON "OriginalBankAccount"("companyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'OriginalBankAccount_companyId_fkey'
  ) THEN
    ALTER TABLE "OriginalBankAccount"
    ADD CONSTRAINT "OriginalBankAccount_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "efiTxid" TEXT,
ADD COLUMN IF NOT EXISTS "efiChargeId" TEXT,
ADD COLUMN IF NOT EXISTS "efiLocId" TEXT,
ADD COLUMN IF NOT EXISTS "efiPixCopiaECola" TEXT,
ADD COLUMN IF NOT EXISTS "boletoLinhaDigitavel" TEXT,
ADD COLUMN IF NOT EXISTS "boletoLink" TEXT,
ADD COLUMN IF NOT EXISTS "boletoPdf" TEXT,
ADD COLUMN IF NOT EXISTS "splitConfigId" TEXT,
ADD COLUMN IF NOT EXISTS "notificationToken" TEXT,
ADD COLUMN IF NOT EXISTS "gatewayStatusRaw" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_efiTxid_key" ON "Invoice"("efiTxid");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_efiChargeId_key" ON "Invoice"("efiChargeId");
