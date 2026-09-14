CREATE TABLE "GlobalMessageTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "footerText" TEXT,
    "paymentButtonEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paymentButtonLabel" TEXT NOT NULL DEFAULT 'Abrir pagamento',
    "copyCodeButtonEnabled" BOOLEAN NOT NULL DEFAULT false,
    "copyCodeSource" "MessageTemplateCopyCodeSource" NOT NULL DEFAULT 'AUTO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metaTemplateName" TEXT,
    "metaLanguage" TEXT NOT NULL DEFAULT 'pt_BR',
    "category" "WhatsAppTemplateCategory" NOT NULL DEFAULT 'UTILITY',
    "metaStatus" TEXT NOT NULL DEFAULT 'LOCAL',
    "metaRejectedReason" TEXT,
    "lastMetaSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GlobalMessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GlobalEmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resendTemplateId" TEXT,
    "resendAlias" TEXT,
    "resendStatus" TEXT NOT NULL DEFAULT 'local',
    "resendPublishedAt" TIMESTAMP(3),
    "lastResendSyncAt" TIMESTAMP(3),
    "resendError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GlobalEmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyTemplatePreference" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "CollectionChannel" NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "greeting" VARCHAR(80),
    "instructions" VARCHAR(280),
    "signature" VARCHAR(120),
    "globalMessageTemplateId" TEXT,
    "globalEmailTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyTemplatePreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GlobalMessageTemplate_slug_key" ON "GlobalMessageTemplate"("slug");
CREATE UNIQUE INDEX "GlobalEmailTemplate_slug_key" ON "GlobalEmailTemplate"("slug");
CREATE INDEX "GlobalEmailTemplate_resendTemplateId_idx" ON "GlobalEmailTemplate"("resendTemplateId");
CREATE UNIQUE INDEX "CompanyTemplatePreference_companyId_channel_slug_key" ON "CompanyTemplatePreference"("companyId", "channel", "slug");
CREATE INDEX "CompanyTemplatePreference_globalMessageTemplateId_idx" ON "CompanyTemplatePreference"("globalMessageTemplateId");
CREATE INDEX "CompanyTemplatePreference_globalEmailTemplateId_idx" ON "CompanyTemplatePreference"("globalEmailTemplateId");

ALTER TABLE "CompanyTemplatePreference" ADD CONSTRAINT "CompanyTemplatePreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyTemplatePreference" ADD CONSTRAINT "CompanyTemplatePreference_globalMessageTemplateId_fkey" FOREIGN KEY ("globalMessageTemplateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyTemplatePreference" ADD CONSTRAINT "CompanyTemplatePreference_globalEmailTemplateId_fkey" FOREIGN KEY ("globalEmailTemplateId") REFERENCES "GlobalEmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
