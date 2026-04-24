ALTER TABLE "Company"
ADD COLUMN "autoDiscountEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoDiscountDaysAfterDue" INTEGER,
ADD COLUMN "autoDiscountPercentage" DECIMAL(5,2);

ALTER TABLE "Debtor"
ADD COLUMN "useGlobalBillingSettings" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "collectionReminderDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "autoDiscountEnabled" BOOLEAN,
ADD COLUMN "autoDiscountDaysAfterDue" INTEGER,
ADD COLUMN "autoDiscountPercentage" DECIMAL(5,2);
