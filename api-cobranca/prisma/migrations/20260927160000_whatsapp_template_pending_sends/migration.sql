-- CreateEnum
CREATE TYPE "CommunicationTransmissionOutcome" AS ENUM ('NOT_SENT', 'ACCEPTED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "WhatsappTemplatePendingState" AS ENUM ('BLOCKED', 'RESUMED', 'CLOSED');

-- AlterEnum
ALTER TYPE "CommunicationIntentState" ADD VALUE 'BLOCKED';

-- AlterEnum
ALTER TYPE "CollectionAttemptStatus" ADD VALUE 'BLOCKED';

-- AlterTable
ALTER TABLE "CommunicationOutboundIntent" ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "logicalKey" VARCHAR(200),
ADD COLUMN     "resumeReviewId" TEXT,
ADD COLUMN     "templateContext" JSONB,
ADD COLUMN     "templateContextFingerprint" VARCHAR(64),
ADD COLUMN     "templateSnapshot" JSONB,
ADD COLUMN     "transmission" "CommunicationTransmissionOutcome" NOT NULL DEFAULT 'NOT_SENT';

-- CreateTable
CREATE TABLE "WhatsappTemplatePendingSend" (
    "id" TEXT NOT NULL,
    "logicalKey" VARCHAR(200) NOT NULL,
    "companyId" TEXT NOT NULL,
    "origin" VARCHAR(32) NOT NULL,
    "invoiceId" TEXT,
    "debtorId" TEXT,
    "ruleStepId" TEXT,
    "templateId" TEXT,
    "request" JSONB NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "snapshot" JSONB,
    "state" "WhatsappTemplatePendingState" NOT NULL DEFAULT 'BLOCKED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "currentIntentId" TEXT,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedReason" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplatePendingSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappTemplateResumeReview" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "confirmationKey" VARCHAR(64),
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappTemplateResumeReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplatePendingSend_logicalKey_key" ON "WhatsappTemplatePendingSend"("logicalKey");

-- CreateIndex
CREATE INDEX "WhatsappTemplatePendingSend_state_companyId_blockedAt_idx" ON "WhatsappTemplatePendingSend"("state", "companyId", "blockedAt");

-- CreateIndex
CREATE INDEX "WhatsappTemplatePendingSend_companyId_state_blockedAt_idx" ON "WhatsappTemplatePendingSend"("companyId", "state", "blockedAt");

-- CreateIndex
CREATE INDEX "WhatsappTemplatePendingSend_templateId_code_idx" ON "WhatsappTemplatePendingSend"("templateId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplateResumeReview_confirmationKey_key" ON "WhatsappTemplateResumeReview"("confirmationKey");

-- CreateIndex
CREATE INDEX "WhatsappTemplateResumeReview_actorUserId_createdAt_idx" ON "WhatsappTemplateResumeReview"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationOutboundIntent_logicalKey_generation_key" ON "CommunicationOutboundIntent"("logicalKey", "generation");

-- AddForeignKey
ALTER TABLE "CommunicationOutboundIntent" ADD CONSTRAINT "CommunicationOutboundIntent_resumeReviewId_fkey" FOREIGN KEY ("resumeReviewId") REFERENCES "WhatsappTemplateResumeReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappTemplatePendingSend" ADD CONSTRAINT "WhatsappTemplatePendingSend_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappTemplatePendingSend" ADD CONSTRAINT "WhatsappTemplatePendingSend_invoiceId_companyId_fkey" FOREIGN KEY ("invoiceId", "companyId") REFERENCES "Invoice"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappTemplatePendingSend" ADD CONSTRAINT "WhatsappTemplatePendingSend_currentIntentId_fkey" FOREIGN KEY ("currentIntentId") REFERENCES "CommunicationOutboundIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one generation of a logical communication may be eligible, in flight, accepted
-- or uncertain; failed and blocked generations stay as history.
CREATE UNIQUE INDEX "CommunicationOutboundIntent_live_logicalKey_key"
  ON "CommunicationOutboundIntent"("logicalKey")
  WHERE "logicalKey" IS NOT NULL AND "state" IN ('PENDING', 'SENDING', 'ACCEPTED', 'UNCERTAIN');

CREATE INDEX "CommunicationOutboundIntent_template_pending_idx"
  ON "CommunicationOutboundIntent"("id")
  WHERE "state" = 'PENDING' AND "templateSnapshot" IS NOT NULL;

ALTER TABLE "CommunicationOutboundIntent" ADD CONSTRAINT "CommunicationOutboundIntent_generation_check" CHECK ("generation" >= 0);
ALTER TABLE "WhatsappTemplatePendingSend" ADD CONSTRAINT "WhatsappTemplatePendingSend_version_check" CHECK ("version" >= 1 AND "occurrences" >= 1);
ALTER TABLE "WhatsappTemplatePendingSend" ADD CONSTRAINT "WhatsappTemplatePendingSend_origin_check" CHECK ("origin" IN ('COLLECTION', 'ADMIN_REPLY', 'ACTIVATION'));
