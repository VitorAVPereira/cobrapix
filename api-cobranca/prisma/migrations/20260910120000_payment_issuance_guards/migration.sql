-- New invoices remain drafts until an explicitly authorized issuance succeeds.
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Multiple providers/methods must never reserve the same invoice concurrently.
CREATE UNIQUE INDEX "PaymentCharge_one_open_issuance_per_invoice"
ON "PaymentCharge" ("companyId", "invoiceId")
WHERE "status" IN ('DRAFT', 'PENDING', 'ACTIVE');

-- Disconnected accounts use an empty key; real EVP ownership is exclusive.
CREATE UNIQUE INDEX "GatewayAccount_unique_pix_key"
ON "GatewayAccount" ("pixKey") WHERE "pixKey" <> '';
