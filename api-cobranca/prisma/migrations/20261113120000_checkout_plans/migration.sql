-- Plans of a product (period, price and how it is charged) and the plan of each order.
CREATE TYPE "CheckoutPlanBilling" AS ENUM ('INSTALLMENT', 'RECURRING');

CREATE TABLE "CheckoutPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intervalMonths" INTEGER NOT NULL,
    "billing" "CheckoutPlanBilling" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "compareAtPriceCents" INTEGER,
    "maxInstallments" INTEGER,
    "pixFeePayer" "CheckoutFeePayer",
    "cardFeePayer" "CheckoutFeePayer",
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutPlan_id_companyId_key" ON "CheckoutPlan"("id", "companyId");

CREATE INDEX "CheckoutPlan_productId_active_position_idx" ON "CheckoutPlan"("productId", "active", "position");

ALTER TABLE "CheckoutPlan" ADD CONSTRAINT "CheckoutPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CheckoutPlan" ADD CONSTRAINT "CheckoutPlan_productId_companyId_fkey" FOREIGN KEY ("productId", "companyId") REFERENCES "CheckoutProduct"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CheckoutOrder" ADD COLUMN "planId" TEXT;

ALTER TABLE "CheckoutOrder" ADD CONSTRAINT "CheckoutOrder_planId_companyId_fkey" FOREIGN KEY ("planId", "companyId") REFERENCES "CheckoutPlan"("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
