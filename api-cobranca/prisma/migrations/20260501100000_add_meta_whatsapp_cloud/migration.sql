CREATE TYPE "WhatsappProvider" AS ENUM ('META_CLOUD', 'EVOLUTION');

CREATE TYPE "WhatsAppTemplateCategory" AS ENUM ('UTILITY', 'MARKETING', 'AUTHENTICATION');

ALTER TABLE "Company"
  ADD COLUMN "whatsappProvider" "WhatsappProvider" NOT NULL DEFAULT 'META_CLOUD',
  ADD COLUMN "metaPhoneNumberId" TEXT,
  ADD COLUMN "metaBusinessAccountId" TEXT,
  ADD COLUMN "metaBusinessPhoneNumber" TEXT,
  ADD COLUMN "metaAccessTokenEncrypted" TEXT,
  ADD COLUMN "metaDefaultLanguage" TEXT NOT NULL DEFAULT 'pt_BR';

ALTER TABLE "Debtor"
  ADD COLUMN "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whatsappOptInAt" TIMESTAMP(3),
  ADD COLUMN "whatsappOptInSource" TEXT;

ALTER TABLE "MessageTemplate"
  ADD COLUMN "metaTemplateName" TEXT,
  ADD COLUMN "metaLanguage" TEXT NOT NULL DEFAULT 'pt_BR',
  ADD COLUMN "category" "WhatsAppTemplateCategory" NOT NULL DEFAULT 'UTILITY',
  ADD COLUMN "metaStatus" TEXT NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "metaRejectedReason" TEXT,
  ADD COLUMN "lastMetaSyncAt" TIMESTAMP(3);
