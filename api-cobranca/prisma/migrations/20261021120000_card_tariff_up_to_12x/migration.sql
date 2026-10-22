-- Card tariffs follow the Efí table (receipt mode and rates, up to 12x). Rows
-- saved before keep their per-brand array and stay valid until saved again.
ALTER TABLE "CardPaymentSettings" DROP CONSTRAINT "CardPaymentSettings_valid_rates";
ALTER TABLE "CardPaymentSettings" ADD CONSTRAINT "CardPaymentSettings_valid_rates" CHECK ("version" > 0 AND "onTimeBasisPoints" BETWEEN 0 AND 10000 AND "overdueBasisPoints" BETWEEN 0 AND 10000 AND (jsonb_typeof("processingRates") = 'array' OR COALESCE("processingRates"->>'receipt' IN ('ANTICIPATED', 'INSTALLMENTS'), false)));

ALTER TABLE "CardPaymentAttempt" DROP CONSTRAINT "CardPaymentAttempt_valid_amounts";
ALTER TABLE "CardPaymentAttempt" ADD CONSTRAINT "CardPaymentAttempt_valid_amounts" CHECK ("installments" BETWEEN 1 AND 12 AND "submissionCents" > 0 AND "totalCents" >= "submissionCents" AND "efiFeeCents" >= 0 AND "platformFeeBaseCents" >= 0 AND "platformFeeCents" >= 0 AND "platformFeeBasisPoints" BETWEEN 0 AND 10000);
