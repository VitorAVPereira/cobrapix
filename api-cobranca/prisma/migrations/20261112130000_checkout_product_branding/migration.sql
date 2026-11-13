-- Page look per product (logo, banner and color); empty falls back to the checkout settings.
ALTER TABLE "CheckoutProduct" ADD COLUMN "logoAssetId" TEXT,
ADD COLUMN "bannerAssetId" TEXT,
ADD COLUMN "primaryColor" TEXT;

ALTER TABLE "CheckoutProduct" ADD CONSTRAINT "CheckoutProduct_logoAssetId_companyId_fkey" FOREIGN KEY ("logoAssetId", "companyId") REFERENCES "CheckoutAsset"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CheckoutProduct" ADD CONSTRAINT "CheckoutProduct_bannerAssetId_companyId_fkey" FOREIGN KEY ("bannerAssetId", "companyId") REFERENCES "CheckoutAsset"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
