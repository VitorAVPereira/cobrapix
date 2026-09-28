-- CreateEnum
CREATE TYPE "WhatsappTemplateOrigin" AS ENUM ('LEGACY_INTERNAL', 'META_IMPORTED');

-- CreateEnum
CREATE TYPE "WhatsappTemplatePurpose" AS ENUM ('EMISSION', 'BEFORE_DUE', 'DUE_TODAY', 'FIRST_OVERDUE', 'RECURRING_OVERDUE', 'CRITICAL_OVERDUE', 'ACTIVATION_NOTICE', 'ACTIVATION_REMINDER');

-- AlterTable
ALTER TABLE "GlobalMessageTemplate" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "mappingRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "origin" "WhatsappTemplateOrigin" NOT NULL DEFAULT 'LEGACY_INTERNAL',
ADD COLUMN     "parameterFormat" VARCHAR(32),
ADD COLUMN     "policyVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "providerAccountId" TEXT,
ADD COLUMN     "providerFingerprint" VARCHAR(64),
ADD COLUMN     "providerRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supportReason" TEXT;

-- CreateTable
CREATE TABLE "WhatsappTemplateMappingRevision" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "providerRevision" INTEGER NOT NULL,
    "providerFingerprint" VARCHAR(64) NOT NULL,
    "components" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappTemplateMappingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyWhatsappTemplateGrant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "grantedAt" TIMESTAMP(3),
    "grantedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyWhatsappTemplateGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyWhatsappTemplateDefault" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purpose" "WhatsappTemplatePurpose" NOT NULL,
    "templateId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyWhatsappTemplateDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappTemplateAudit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "templateId" TEXT,
    "action" VARCHAR(64) NOT NULL,
    "actorUserId" TEXT,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappTemplateAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappTemplateSyncState" (
    "id" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "syncRequestedAt" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(64),
    "lastErrorAt" TIMESTAMP(3),
    "lastResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplateSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplateMappingRevision_templateId_revision_key" ON "WhatsappTemplateMappingRevision"("templateId", "revision");

-- CreateIndex
CREATE INDEX "CompanyWhatsappTemplateGrant_templateId_enabled_idx" ON "CompanyWhatsappTemplateGrant"("templateId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWhatsappTemplateGrant_companyId_templateId_key" ON "CompanyWhatsappTemplateGrant"("companyId", "templateId");

-- CreateIndex
CREATE INDEX "CompanyWhatsappTemplateDefault_templateId_idx" ON "CompanyWhatsappTemplateDefault"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWhatsappTemplateDefault_companyId_purpose_key" ON "CompanyWhatsappTemplateDefault"("companyId", "purpose");

-- CreateIndex
CREATE INDEX "WhatsappTemplateAudit_companyId_createdAt_idx" ON "WhatsappTemplateAudit"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappTemplateAudit_templateId_createdAt_idx" ON "WhatsappTemplateAudit"("templateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplateSyncState_providerAccountId_key" ON "WhatsappTemplateSyncState"("providerAccountId");

-- CreateIndex
CREATE INDEX "GlobalMessageTemplate_providerAccountId_metaTemplateName_me_idx" ON "GlobalMessageTemplate"("providerAccountId", "metaTemplateName", "metaLanguage");

-- CreateIndex
CREATE INDEX "GlobalMessageTemplate_origin_archivedAt_metaStatus_idx" ON "GlobalMessageTemplate"("origin", "archivedAt", "metaStatus");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalMessageTemplate_providerAccountId_metaTemplateId_key" ON "GlobalMessageTemplate"("providerAccountId", "metaTemplateId");

-- AddForeignKey
ALTER TABLE "WhatsappTemplateMappingRevision" ADD CONSTRAINT "WhatsappTemplateMappingRevision_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWhatsappTemplateGrant" ADD CONSTRAINT "CompanyWhatsappTemplateGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWhatsappTemplateGrant" ADD CONSTRAINT "CompanyWhatsappTemplateGrant_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWhatsappTemplateDefault" ADD CONSTRAINT "CompanyWhatsappTemplateDefault_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWhatsappTemplateDefault" ADD CONSTRAINT "CompanyWhatsappTemplateDefault_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An imported template is always identified by WABA + provider ID; legacy rows keep NULLs.
ALTER TABLE "GlobalMessageTemplate" ADD CONSTRAINT "GlobalMessageTemplate_imported_identity_check"
  CHECK ("origin" <> 'META_IMPORTED' OR ("providerAccountId" IS NOT NULL AND "metaTemplateId" IS NOT NULL));
ALTER TABLE "GlobalMessageTemplate" ADD CONSTRAINT "GlobalMessageTemplate_versions_check"
  CHECK ("providerRevision" >= 0 AND "policyVersion" >= 0 AND "mappingRevision" >= 0);
ALTER TABLE "CompanyWhatsappTemplateGrant" ADD CONSTRAINT "CompanyWhatsappTemplateGrant_version_check" CHECK ("version" >= 0);
ALTER TABLE "CompanyWhatsappTemplateDefault" ADD CONSTRAINT "CompanyWhatsappTemplateDefault_version_check" CHECK ("version" >= 0);
ALTER TABLE "WhatsappTemplateMappingRevision" ADD CONSTRAINT "WhatsappTemplateMappingRevision_revision_check" CHECK ("revision" > 0 AND "providerRevision" >= 0);
