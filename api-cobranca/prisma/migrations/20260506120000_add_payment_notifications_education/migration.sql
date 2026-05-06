-- CreateEnum
CREATE TYPE "BusinessSegment" AS ENUM ('GENERAL', 'EDUCATION');

-- CreateEnum
CREATE TYPE "PaymentNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "businessSegment" "BusinessSegment" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "paymentNotificationEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "paymentNotificationEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "studentName" TEXT,
ADD COLUMN "studentEnrollment" TEXT,
ADD COLUMN "studentGroup" TEXT,
ADD COLUMN "paidAt" TIMESTAMP(3);

-- Backfill existing paid invoices so period metrics keep working after paidAt becomes canonical.
UPDATE "Invoice" SET "paidAt" = "updatedAt" WHERE "status" = 'PAID' AND "paidAt" IS NULL;

-- CreateTable
CREATE TABLE "PaymentNotification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "PaymentNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipientEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "errorMessage" TEXT,
    "summary" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentNotification_companyId_invoiceId_key" ON "PaymentNotification"("companyId", "invoiceId");

-- CreateIndex
CREATE INDEX "PaymentNotification_companyId_status_createdAt_idx" ON "PaymentNotification"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentNotification_invoiceId_idx" ON "PaymentNotification"("invoiceId");

-- AddForeignKey
ALTER TABLE "PaymentNotification" ADD CONSTRAINT "PaymentNotification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentNotification" ADD CONSTRAINT "PaymentNotification_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
