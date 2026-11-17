-- Refunds executed by the system through the Efí, saved before each call.
CREATE TYPE "CheckoutRefundExecutionStatus" AS ENUM ('SUBMITTING', 'PROCESSING', 'DONE', 'FAILED', 'UNCERTAIN');

CREATE TYPE "CheckoutRefundExecutionOrigin" AS ENUM ('SELLER', 'ADMIN', 'SYSTEM');

CREATE TABLE "CheckoutRefundExecution" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "refundRequestId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "CheckoutPaymentMethod" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "CheckoutRefundExecutionStatus" NOT NULL DEFAULT 'SUBMITTING',
    "failureCode" TEXT,
    "efiRefundId" TEXT NOT NULL,
    "issuerIdentityId" TEXT NOT NULL,
    "origin" "CheckoutRefundExecutionOrigin" NOT NULL,
    "requestedByUserId" TEXT,
    "approvalReference" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutRefundExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutRefundExecution_efiRefundId_key" ON "CheckoutRefundExecution"("efiRefundId");

CREATE INDEX "CheckoutRefundExecution_status_updatedAt_idx" ON "CheckoutRefundExecution"("status", "updatedAt");

CREATE INDEX "CheckoutRefundExecution_refundRequestId_status_idx" ON "CheckoutRefundExecution"("refundRequestId", "status");

-- One open execution per refund request: a double click or two workers
-- never send two refunds.
CREATE UNIQUE INDEX "CheckoutRefundExecution_open_request_key" ON "CheckoutRefundExecution"("refundRequestId") WHERE "status" IN ('SUBMITTING', 'PROCESSING', 'UNCERTAIN');

ALTER TABLE "CheckoutRefundExecution" ADD CONSTRAINT "CheckoutRefundExecution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CheckoutRefundExecution" ADD CONSTRAINT "CheckoutRefundExecution_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "CheckoutRefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CheckoutRefundExecution" ADD CONSTRAINT "CheckoutRefundExecution_orderId_companyId_fkey" FOREIGN KEY ("orderId", "companyId") REFERENCES "CheckoutOrder"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CheckoutRefundExecution" ADD CONSTRAINT "CheckoutRefundExecution_issuerIdentityId_fkey" FOREIGN KEY ("issuerIdentityId") REFERENCES "EfiAccountIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
