-- Default grace period accepting payment after the due date: 30 days
-- (decision of 25/09/2026). Existing companies only carried the column
-- default, since no screen could set it yet; invoices keep their values.
ALTER TABLE "Company" ALTER COLUMN "defaultPaymentDaysAfterDue" SET DEFAULT 30;
ALTER TABLE "Invoice" ALTER COLUMN "paymentDaysAfterDue" SET DEFAULT 30;
ALTER TABLE "RecurringInvoice" ALTER COLUMN "paymentDaysAfterDue" SET DEFAULT 30;

UPDATE "Company" SET "defaultPaymentDaysAfterDue" = 30 WHERE "defaultPaymentDaysAfterDue" = 0;
