-- AlterEnum
ALTER TYPE "CollectionAttemptStatus" ADD VALUE 'SKIPPED';

-- CreateTable
CREATE TABLE "CollectionStepTemplateOverride" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleStepId" TEXT NOT NULL,
    "billingMethod" "BillingMethod" NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionStepTemplateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionStepTemplateOverride_ruleStepId_billingMethod_key" ON "CollectionStepTemplateOverride"("ruleStepId", "billingMethod");

-- CreateIndex
CREATE INDEX "CollectionStepTemplateOverride_companyId_idx" ON "CollectionStepTemplateOverride"("companyId");

-- CreateIndex
CREATE INDEX "CollectionStepTemplateOverride_templateId_idx" ON "CollectionStepTemplateOverride"("templateId");

-- AddForeignKey
ALTER TABLE "CollectionStepTemplateOverride" ADD CONSTRAINT "CollectionStepTemplateOverride_ruleStepId_fkey" FOREIGN KEY ("ruleStepId") REFERENCES "CollectionRuleStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionStepTemplateOverride" ADD CONSTRAINT "CollectionStepTemplateOverride_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only the methods still issued, like the global collection templates.
ALTER TABLE "CollectionStepTemplateOverride" ADD CONSTRAINT "CollectionStepTemplateOverride_method_check" CHECK ("billingMethod" IN ('PIX', 'BOLIX', 'CREDIT_CARD'));
