-- Cifra+ Checkout, part 1: checkout companies, seller terms, page settings,
-- images, products, order bumps and coupons. Existing companies stay BILLING.
-- CreateEnum
CREATE TYPE "CompanyProduct" AS ENUM ('BILLING', 'CHECKOUT');

-- CreateEnum
CREATE TYPE "CheckoutFeePayer" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "CheckoutDeliveryMode" AS ENUM ('ACCESS_LINK', 'WEBHOOK', 'BOTH');

-- CreateEnum
CREATE TYPE "CheckoutCouponType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "CheckoutAssetKind" AS ENUM ('LOGO', 'BANNER', 'PRODUCT_IMAGE');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "product" "CompanyProduct" NOT NULL DEFAULT 'BILLING';

-- CreateTable
CREATE TABLE "CheckoutSellerTerms" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "platformFeeBasisPoints" INTEGER NOT NULL,
    "payoutDocument" TEXT NOT NULL,
    "payoutPixKey" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutSellerTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "logoAssetId" TEXT,
    "bannerAssetId" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0F766E',
    "supportEmail" TEXT,
    "supportWhatsapp" TEXT,
    "whatsappButtonPhone" TEXT,
    "pixEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxInstallments" INTEGER NOT NULL DEFAULT 12,
    "pixFeePayer" "CheckoutFeePayer" NOT NULL DEFAULT 'SELLER',
    "cardFeePayer" "CheckoutFeePayer" NOT NULL DEFAULT 'BUYER',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "CheckoutAssetKind" NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutProduct" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "compareAtPriceCents" INTEGER,
    "imageAssetId" TEXT,
    "accessPeriodMonths" INTEGER,
    "deliveryMode" "CheckoutDeliveryMode" NOT NULL DEFAULT 'ACCESS_LINK',
    "accessUrl" TEXT,
    "accessInstructions" TEXT,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutOrderBump" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "offeredProductId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "compareAtPriceCents" INTEGER,
    "headline" TEXT,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutOrderBump_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutCoupon" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CheckoutCouponType" NOT NULL,
    "value" INTEGER NOT NULL,
    "appliesToAllProducts" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutCouponProduct" (
    "couponId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "CheckoutCouponProduct_pkey" PRIMARY KEY ("couponId","productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSellerTerms_companyId_version_key" ON "CheckoutSellerTerms"("companyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSettings_companyId_key" ON "CheckoutSettings"("companyId");

-- CreateIndex
CREATE INDEX "CheckoutAsset_companyId_createdAt_idx" ON "CheckoutAsset"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAsset_id_companyId_key" ON "CheckoutAsset"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutProduct_slug_key" ON "CheckoutProduct"("slug");

-- CreateIndex
CREATE INDEX "CheckoutProduct_companyId_active_createdAt_idx" ON "CheckoutProduct"("companyId", "active", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutProduct_id_companyId_key" ON "CheckoutProduct"("id", "companyId");

-- CreateIndex
CREATE INDEX "CheckoutOrderBump_productId_active_position_idx" ON "CheckoutOrderBump"("productId", "active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutOrderBump_productId_offeredProductId_key" ON "CheckoutOrderBump"("productId", "offeredProductId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutCoupon_companyId_code_key" ON "CheckoutCoupon"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutCoupon_id_companyId_key" ON "CheckoutCoupon"("id", "companyId");

-- CreateIndex
CREATE INDEX "CheckoutCouponProduct_productId_idx" ON "CheckoutCouponProduct"("productId");

-- AddForeignKey
ALTER TABLE "CheckoutSellerTerms" ADD CONSTRAINT "CheckoutSellerTerms_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSettings" ADD CONSTRAINT "CheckoutSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutSettings" ADD CONSTRAINT "CheckoutSettings_logoAssetId_companyId_fkey" FOREIGN KEY ("logoAssetId", "companyId") REFERENCES "CheckoutAsset"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutSettings" ADD CONSTRAINT "CheckoutSettings_bannerAssetId_companyId_fkey" FOREIGN KEY ("bannerAssetId", "companyId") REFERENCES "CheckoutAsset"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutAsset" ADD CONSTRAINT "CheckoutAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutProduct" ADD CONSTRAINT "CheckoutProduct_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutProduct" ADD CONSTRAINT "CheckoutProduct_imageAssetId_companyId_fkey" FOREIGN KEY ("imageAssetId", "companyId") REFERENCES "CheckoutAsset"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOrderBump" ADD CONSTRAINT "CheckoutOrderBump_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutOrderBump" ADD CONSTRAINT "CheckoutOrderBump_productId_companyId_fkey" FOREIGN KEY ("productId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutOrderBump" ADD CONSTRAINT "CheckoutOrderBump_offeredProductId_companyId_fkey" FOREIGN KEY ("offeredProductId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutCoupon" ADD CONSTRAINT "CheckoutCoupon_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutCouponProduct" ADD CONSTRAINT "CheckoutCouponProduct_couponId_companyId_fkey" FOREIGN KEY ("couponId", "companyId") REFERENCES "CheckoutCoupon"("id", "companyId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CheckoutCouponProduct" ADD CONSTRAINT "CheckoutCouponProduct_productId_companyId_fkey" FOREIGN KEY ("productId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

