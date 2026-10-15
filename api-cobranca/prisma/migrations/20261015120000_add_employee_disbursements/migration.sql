-- CreateEnum
CREATE TYPE "DisbursementDocumentType" AS ENUM ('CPF', 'CNPJ');

-- CreateEnum
CREATE TYPE "DisbursementBatchStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_FAILURES', 'REJECTED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DisbursementItemStatus" AS ENUM ('PENDING', 'SENDING', 'IN_PROCESSING', 'PAID', 'FAILED', 'UNCERTAIN', 'CANCELED');

-- CreateEnum
CREATE TYPE "DisbursementApprovalState" AS ENUM ('AWAITING', 'APPROVED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'HELD');

-- CreateTable
CREATE TABLE "DisbursementSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "approverName" TEXT NOT NULL,
    "approverPhone" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisbursementSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementRecipient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" "DisbursementDocumentType" NOT NULL,
    "document" TEXT NOT NULL,
    "pixKey" TEXT,
    "bankIspb" TEXT,
    "bankAgency" TEXT,
    "bankAccount" TEXT,
    "bankAccountType" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisbursementRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "DisbursementBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "issuerIdentityId" TEXT,
    "approvalRequests" INTEGER NOT NULL DEFAULT 0,
    "sendPausedUntil" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisbursementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "documentType" "DisbursementDocumentType" NOT NULL,
    "document" TEXT NOT NULL,
    "pixKey" TEXT,
    "bankIspb" TEXT,
    "bankAgency" TEXT,
    "bankAccount" TEXT,
    "bankAccountType" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "DisbursementItemStatus" NOT NULL DEFAULT 'PENDING',
    "idEnvio" TEXT NOT NULL,
    "e2eId" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "sendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisbursementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementApproval" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestNumber" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "settingsVersion" INTEGER NOT NULL,
    "approverPhoneHash" TEXT NOT NULL,
    "approveLabel" TEXT,
    "rejectLabel" TEXT,
    "intentId" TEXT,
    "state" "DisbursementApprovalState" NOT NULL DEFAULT 'AWAITING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decisionMessageId" TEXT,
    "decisionExternalMessageId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "ackSentAt" TIMESTAMP(3),
    "noticeSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisbursementApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementSettings_companyId_version_key" ON "DisbursementSettings"("companyId", "version");

-- CreateIndex
CREATE INDEX "DisbursementRecipient_companyId_active_name_idx" ON "DisbursementRecipient"("companyId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementRecipient_companyId_document_key" ON "DisbursementRecipient"("companyId", "document");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementRecipient_id_companyId_key" ON "DisbursementRecipient"("id", "companyId");

-- CreateIndex
CREATE INDEX "DisbursementBatch_companyId_createdAt_idx" ON "DisbursementBatch"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "DisbursementBatch_status_idx" ON "DisbursementBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementBatch_id_companyId_key" ON "DisbursementBatch"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementItem_idEnvio_key" ON "DisbursementItem"("idEnvio");

-- CreateIndex
CREATE INDEX "DisbursementItem_companyId_status_idx" ON "DisbursementItem"("companyId", "status");

-- CreateIndex
CREATE INDEX "DisbursementItem_status_updatedAt_idx" ON "DisbursementItem"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementItem_batchId_recipientId_key" ON "DisbursementItem"("batchId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementApproval_intentId_key" ON "DisbursementApproval"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementApproval_decisionMessageId_key" ON "DisbursementApproval"("decisionMessageId");

-- CreateIndex
CREATE INDEX "DisbursementApproval_state_expiresAt_idx" ON "DisbursementApproval"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "DisbursementApproval_companyId_createdAt_idx" ON "DisbursementApproval"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementApproval_batchId_requestNumber_key" ON "DisbursementApproval"("batchId", "requestNumber");

-- AddForeignKey
ALTER TABLE "DisbursementSettings" ADD CONSTRAINT "DisbursementSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementRecipient" ADD CONSTRAINT "DisbursementRecipient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementBatch" ADD CONSTRAINT "DisbursementBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementBatch" ADD CONSTRAINT "DisbursementBatch_issuerIdentityId_companyId_fkey" FOREIGN KEY ("issuerIdentityId", "companyId") REFERENCES "EfiAccountIdentity"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DisbursementItem" ADD CONSTRAINT "DisbursementItem_batchId_companyId_fkey" FOREIGN KEY ("batchId", "companyId") REFERENCES "DisbursementBatch"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementItem" ADD CONSTRAINT "DisbursementItem_recipientId_companyId_fkey" FOREIGN KEY ("recipientId", "companyId") REFERENCES "DisbursementRecipient"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementApproval" ADD CONSTRAINT "DisbursementApproval_batchId_companyId_fkey" FOREIGN KEY ("batchId", "companyId") REFERENCES "DisbursementBatch"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

