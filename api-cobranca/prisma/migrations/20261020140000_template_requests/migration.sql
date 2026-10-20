-- CreateEnum
CREATE TYPE "TemplateRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'REJECTED');

-- CreateTable
CREATE TABLE "TemplateRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "ruleStepId" TEXT,
    "purpose" "WhatsappTemplatePurpose",
    "billingMethod" "BillingMethod",
    "message" TEXT NOT NULL,
    "status" "TemplateRequestStatus" NOT NULL DEFAULT 'OPEN',
    "adminNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateRequest_status_createdAt_idx" ON "TemplateRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TemplateRequest_companyId_createdAt_idx" ON "TemplateRequest"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "TemplateRequest" ADD CONSTRAINT "TemplateRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
