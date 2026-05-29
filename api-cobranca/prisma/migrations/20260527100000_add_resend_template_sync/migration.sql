ALTER TABLE "EmailTemplate"
  ADD COLUMN "resendTemplateId" TEXT,
  ADD COLUMN "resendAlias" TEXT,
  ADD COLUMN "resendStatus" TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN "resendPublishedAt" TIMESTAMP(3),
  ADD COLUMN "lastResendSyncAt" TIMESTAMP(3),
  ADD COLUMN "resendError" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "EmailTemplate_companyId_deletedAt_idx"
  ON "EmailTemplate"("companyId", "deletedAt");

CREATE INDEX "EmailTemplate_resendTemplateId_idx"
  ON "EmailTemplate"("resendTemplateId");
