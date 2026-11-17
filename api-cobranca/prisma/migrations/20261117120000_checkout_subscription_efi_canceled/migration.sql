-- When the Efí confirmed that a subscription no longer charges.
ALTER TABLE "CheckoutSubscription" ADD COLUMN "efiCanceledAt" TIMESTAMP(3);
