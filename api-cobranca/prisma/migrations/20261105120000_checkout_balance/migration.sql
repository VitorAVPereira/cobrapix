-- Cifra+ Checkout, part 3: the seller's balance (immutable ledger) and refund
-- requests. Orders paid before this migration get their sale entries once.
-- CreateEnum
CREATE TYPE "CheckoutLedgerKind" AS ENUM ('SALE', 'EFI_FEE', 'PLATFORM_FEE', 'REFUND', 'PLATFORM_FEE_REVERSAL', 'CHARGEBACK', 'PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CheckoutRefundOrigin" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "CheckoutRefundStatus" AS ENUM ('REQUESTED', 'DONE', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CheckoutOrderStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "CheckoutOrderStatus" ADD VALUE 'CHARGEBACK';

-- CreateTable
CREATE TABLE "CheckoutLedgerEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" "CheckoutLedgerKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutRefundRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "origin" "CheckoutRefundOrigin" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CheckoutRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutLedgerEntry_idempotencyKey_key" ON "CheckoutLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CheckoutLedgerEntry_companyId_availableAt_idx" ON "CheckoutLedgerEntry"("companyId", "availableAt");

-- CreateIndex
CREATE INDEX "CheckoutLedgerEntry_orderId_idx" ON "CheckoutLedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "CheckoutRefundRequest_companyId_status_createdAt_idx" ON "CheckoutRefundRequest"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CheckoutRefundRequest_orderId_status_idx" ON "CheckoutRefundRequest"("orderId", "status");

-- AddForeignKey
ALTER TABLE "CheckoutLedgerEntry" ADD CONSTRAINT "CheckoutLedgerEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLedgerEntry" ADD CONSTRAINT "CheckoutLedgerEntry_orderId_companyId_fkey" FOREIGN KEY ("orderId", "companyId") REFERENCES "CheckoutOrder"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutRefundRequest" ADD CONSTRAINT "CheckoutRefundRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutRefundRequest" ADD CONSTRAINT "CheckoutRefundRequest_orderId_companyId_fkey" FOREIGN KEY ("orderId", "companyId") REFERENCES "CheckoutOrder"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Backfill: paid orders from part 2 get the same three entries the payment
-- confirmation now writes (same idempotency keys, so nothing doubles later).
INSERT INTO "CheckoutLedgerEntry" ("id", "companyId", "orderId", "kind", "amountCents", "availableAt", "idempotencyKey")
SELECT gen_random_uuid()::text, o."companyId", o."id", 'SALE'::"CheckoutLedgerKind", o."totalCents",
       o."paidAt" + interval '7 days', 'sale:' || o."id"
FROM "CheckoutOrder" o
WHERE o."status" = 'PAID' AND o."paidAt" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "CheckoutLedgerEntry" ("id", "companyId", "orderId", "kind", "amountCents", "availableAt", "idempotencyKey")
SELECT gen_random_uuid()::text, o."companyId", o."id", 'EFI_FEE'::"CheckoutLedgerKind",
       -COALESCE(a."providerFeeCents", o."efiFeeCents"),
       o."paidAt" + interval '7 days', 'efi-fee:' || o."id"
FROM "CheckoutOrder" o
LEFT JOIN "CheckoutPaymentAttempt" a ON a."orderId" = o."id"
WHERE o."status" = 'PAID' AND o."paidAt" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "CheckoutLedgerEntry" ("id", "companyId", "orderId", "kind", "amountCents", "availableAt", "idempotencyKey")
SELECT gen_random_uuid()::text, o."companyId", o."id", 'PLATFORM_FEE'::"CheckoutLedgerKind", -o."platformFeeCents",
       o."paidAt" + interval '7 days', 'platform-fee:' || o."id"
FROM "CheckoutOrder" o
WHERE o."status" = 'PAID' AND o."paidAt" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;
