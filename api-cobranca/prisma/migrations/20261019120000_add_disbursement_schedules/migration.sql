-- CreateEnum
CREATE TYPE "DisbursementScheduleUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "DisbursementScheduleStatus" AS ENUM ('ACTIVE', 'ENDED');

-- AlterEnum
ALTER TYPE "DisbursementBatchStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "DisbursementBatch" ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "scheduleOccurrence" INTEGER,
ADD COLUMN     "scheduleProblem" TEXT,
ADD COLUMN     "scheduledFor" DATE;

-- CreateTable
CREATE TABLE "DisbursementSchedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "unit" "DisbursementScheduleUnit" NOT NULL,
    "every" INTEGER NOT NULL,
    "firstDate" DATE NOT NULL,
    "endsOn" DATE,
    "maxOccurrences" INTEGER,
    "occurrencesCreated" INTEGER NOT NULL DEFAULT 0,
    "status" "DisbursementScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisbursementSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementScheduleItem" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "DisbursementScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisbursementSchedule_status_idx" ON "DisbursementSchedule"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementSchedule_id_companyId_key" ON "DisbursementSchedule"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementScheduleItem_scheduleId_recipientId_key" ON "DisbursementScheduleItem"("scheduleId", "recipientId");

-- CreateIndex
CREATE INDEX "DisbursementBatch_status_scheduledFor_idx" ON "DisbursementBatch"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementBatch_scheduleId_scheduleOccurrence_key" ON "DisbursementBatch"("scheduleId", "scheduleOccurrence");

-- AddForeignKey
ALTER TABLE "DisbursementBatch" ADD CONSTRAINT "DisbursementBatch_scheduleId_companyId_fkey" FOREIGN KEY ("scheduleId", "companyId") REFERENCES "DisbursementSchedule"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DisbursementSchedule" ADD CONSTRAINT "DisbursementSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementScheduleItem" ADD CONSTRAINT "DisbursementScheduleItem_scheduleId_companyId_fkey" FOREIGN KEY ("scheduleId", "companyId") REFERENCES "DisbursementSchedule"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementScheduleItem" ADD CONSTRAINT "DisbursementScheduleItem_recipientId_companyId_fkey" FOREIGN KEY ("recipientId", "companyId") REFERENCES "DisbursementRecipient"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

