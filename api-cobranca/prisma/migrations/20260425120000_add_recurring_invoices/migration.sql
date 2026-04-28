CREATE TYPE "RecurringInvoiceStatus" AS ENUM ('ACTIVE', 'PAUSED');

CREATE TABLE "RecurringInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "billingType" "BillingMethod" NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "status" "RecurringInvoiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastGeneratedPeriod" TEXT,
    "nextDueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Invoice"
ADD COLUMN "recurringInvoiceId" TEXT,
ADD COLUMN "recurrencePeriod" TEXT;

CREATE INDEX "RecurringInvoice_companyId_idx" ON "RecurringInvoice"("companyId");
CREATE INDEX "RecurringInvoice_debtorId_idx" ON "RecurringInvoice"("debtorId");
CREATE INDEX "RecurringInvoice_companyId_status_idx" ON "RecurringInvoice"("companyId", "status");
CREATE INDEX "Invoice_recurringInvoiceId_idx" ON "Invoice"("recurringInvoiceId");
CREATE UNIQUE INDEX "Invoice_recurringInvoiceId_recurrencePeriod_key" ON "Invoice"("recurringInvoiceId", "recurrencePeriod");

ALTER TABLE "RecurringInvoice"
ADD CONSTRAINT "RecurringInvoice_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecurringInvoice"
ADD CONSTRAINT "RecurringInvoice_debtorId_fkey"
FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_recurringInvoiceId_fkey"
FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
