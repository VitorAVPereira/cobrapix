-- AlterEnum
ALTER TYPE "CheckoutRefundStatus" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "CheckoutRefundRequest" ADD COLUMN     "amountCents" INTEGER,
ADD COLUMN     "buyerRemindedAt" TIMESTAMP(3),
ADD COLUMN     "holdUntil" TIMESTAMP(3),
ADD COLUMN     "itemIndexes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

