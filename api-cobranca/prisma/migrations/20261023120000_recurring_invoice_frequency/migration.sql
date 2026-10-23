-- Recurrences repeat weekly to yearly; existing ones stay monthly.
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY');

ALTER TABLE "RecurringInvoice"
ADD COLUMN "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN "studentName" TEXT,
ADD COLUMN "studentEnrollment" TEXT,
ADD COLUMN "studentGroup" TEXT;

-- Student data used to reach only the first invoice of a recurrence: the
-- recurrence takes it from its oldest invoice that has it. Invoices are not changed.
UPDATE "RecurringInvoice" AS r
SET "studentName" = i."studentName",
    "studentEnrollment" = i."studentEnrollment",
    "studentGroup" = i."studentGroup"
FROM (
  SELECT DISTINCT ON ("recurringInvoiceId")
    "recurringInvoiceId", "studentName", "studentEnrollment", "studentGroup"
  FROM "Invoice"
  WHERE "recurringInvoiceId" IS NOT NULL
    AND ("studentName" IS NOT NULL OR "studentEnrollment" IS NOT NULL OR "studentGroup" IS NOT NULL)
  ORDER BY "recurringInvoiceId", "dueDate" ASC, "createdAt" ASC
) AS i
WHERE r."id" = i."recurringInvoiceId";
