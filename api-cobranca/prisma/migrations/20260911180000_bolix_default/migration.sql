-- Keep BOLETO enum and historical invoices/charges intact.
ALTER TABLE "Company" ALTER COLUMN "preferredBillingMethod" SET DEFAULT 'BOLIX';
ALTER TABLE "Company" ALTER COLUMN "enabledBillingMethods" SET DEFAULT ARRAY['PIX', 'BOLIX']::"BillingMethod"[];
UPDATE "Company" SET "preferredBillingMethod" = 'BOLIX'
WHERE "preferredBillingMethod" = 'BOLETO';
UPDATE "Company" SET "enabledBillingMethods" = array_remove("enabledBillingMethods", 'BOLETO'::"BillingMethod")
WHERE 'BOLETO'::"BillingMethod" = ANY("enabledBillingMethods");
-- Enabling Bolix on existing companies still requires an administrator to
-- configure the contracted fee; this migration never invents a tariff.
