-- CreateEnum
CREATE TYPE "CheckoutAfterPurchase" AS ENUM ('ACCESS', 'OFFER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "CheckoutOfferKind" AS ENUM ('UPSELL', 'DOWNSELL');

-- CreateEnum
CREATE TYPE "CheckoutOfferDecision" AS ENUM ('ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "CheckoutCardAttempt" ADD COLUMN     "reuseEncrypted" TEXT,
ADD COLUMN     "reuseWipedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CheckoutOrder" ADD COLUMN     "offerExpiresAt" TIMESTAMP(3),
ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "offerTokenHash" TEXT,
ADD COLUMN     "parentOrderId" TEXT;

-- AlterTable
ALTER TABLE "CheckoutProduct" ADD COLUMN     "afterPurchase" "CheckoutAfterPurchase" NOT NULL DEFAULT 'ACCESS',
ADD COLUMN     "afterPurchaseUrl" TEXT,
ADD COLUMN     "offerWindowMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "CheckoutOffer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "CheckoutOfferKind" NOT NULL,
    "offeredProductId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "compareAtPriceCents" INTEGER,
    "headline" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutOfferResponse" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "decision" "CheckoutOfferDecision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutOfferResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutOffer_productId_kind_key" ON "CheckoutOffer"("productId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutOffer_id_companyId_key" ON "CheckoutOffer"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutOfferResponse_orderId_offerId_key" ON "CheckoutOfferResponse"("orderId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutOrder_offerTokenHash_key" ON "CheckoutOrder"("offerTokenHash");

-- CreateIndex
CREATE INDEX "CheckoutOrder_parentOrderId_offerId_idx" ON "CheckoutOrder"("parentOrderId", "offerId");

-- AddForeignKey
ALTER TABLE "CheckoutOffer" ADD CONSTRAINT "CheckoutOffer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutOffer" ADD CONSTRAINT "CheckoutOffer_productId_companyId_fkey" FOREIGN KEY ("productId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOffer" ADD CONSTRAINT "CheckoutOffer_offeredProductId_companyId_fkey" FOREIGN KEY ("offeredProductId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOfferResponse" ADD CONSTRAINT "CheckoutOfferResponse_orderId_companyId_fkey" FOREIGN KEY ("orderId", "companyId") REFERENCES "CheckoutOrder"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOfferResponse" ADD CONSTRAINT "CheckoutOfferResponse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutOfferResponse" ADD CONSTRAINT "CheckoutOfferResponse_offerId_companyId_fkey" FOREIGN KEY ("offerId", "companyId") REFERENCES "CheckoutOffer"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_parentOrderId_companyId_fkey" FOREIGN KEY ("parentOrderId", "companyId") REFERENCES "CheckoutOrder"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_offerId_companyId_fkey" FOREIGN KEY ("offerId", "companyId") REFERENCES "CheckoutOffer"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

