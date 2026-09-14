\set ON_ERROR_STOP on

BEGIN;

INSERT INTO "Company" ("id", "corporateName", "document", "email", "phoneNumber", "updatedAt")
VALUES
  ('integrity-company-a', 'Company A', '11111111000101', 'a@integrity.test', '551100000001', CURRENT_TIMESTAMP),
  ('integrity-company-b', 'Company B', '22222222000102', 'b@integrity.test', '551100000002', CURRENT_TIMESTAMP);

INSERT INTO "User" ("id", "email", "password", "companyId", "role", "updatedAt")
VALUES ('integrity-admin-b', 'admin-b@integrity.test', 'unused', 'integrity-company-b', 'PLATFORM_ADMIN', CURRENT_TIMESTAMP);

INSERT INTO "Debtor" ("id", "companyId", "name", "phoneNumber", "updatedAt")
VALUES
  ('integrity-debtor-a', 'integrity-company-a', 'Debtor A', '551199000001', CURRENT_TIMESTAMP),
  ('integrity-debtor-b', 'integrity-company-b', 'Debtor B', '551199000002', CURRENT_TIMESTAMP);

INSERT INTO "Invoice" ("id", "companyId", "debtorId", "originalAmount", "dueDate", "updatedAt")
VALUES
  ('integrity-invoice-a1', 'integrity-company-a', 'integrity-debtor-a', 100.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('integrity-invoice-a2', 'integrity-company-a', 'integrity-debtor-a', 100.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('integrity-invoice-b', 'integrity-company-b', 'integrity-debtor-b', 100.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- A global fee can retain a valid platform-admin creator from another company.
INSERT INTO "PaymentFeeVersion" (
  "id", "scopeKey", "billingMethod", "version",
  "efiFeeKind", "efiFeeAmountCents", "platformFeeKind", "platformFeeBasisPoints",
  "effectiveFrom", "createdByUserId"
) VALUES (
  'integrity-global-pix', 'GLOBAL', 'PIX', 1,
  'FIXED', 100, 'PERCENTAGE', 200,
  CURRENT_TIMESTAMP, 'integrity-admin-b'
);

INSERT INTO "PaymentFeeVersion" (
  "id", "companyId", "scopeKey", "billingMethod", "version",
  "efiFeeKind", "efiFeeAmountCents", "platformFeeKind", "platformFeeAmountCents",
  "effectiveFrom", "createdByUserId"
) VALUES (
  'integrity-company-b-pix', 'integrity-company-b', 'integrity-company-b', 'PIX', 1,
  'FIXED', 100, 'FIXED', 50,
  CURRENT_TIMESTAMP, 'integrity-admin-b'
);

INSERT INTO "PaymentCharge" (
  "id", "companyId", "invoiceId", "feeVersionId", "billingMethod",
  "grossAmountCents", "estimatedEfiFeeCents", "estimatedPlatformFeeCents",
  "feeSnapshot", "updatedAt"
) VALUES (
  'integrity-charge-a1', 'integrity-company-a', 'integrity-invoice-a1', 'integrity-global-pix', 'PIX',
  10000, 100, 200, '{}'::jsonb, CURRENT_TIMESTAMP
);

DO $$
BEGIN
  BEGIN
    INSERT INTO "EfiOnboarding" ("id", "companyId", "consentUserId", "updatedAt")
    VALUES ('invalid-consent', 'integrity-company-a', 'integrity-admin-b', CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'cross-tenant consent user was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "PaymentFeeVersion" (
      "id", "scopeKey", "billingMethod", "version",
      "efiFeeKind", "efiFeeAmountCents", "platformFeeKind", "platformFeeAmountCents",
      "effectiveFrom", "createdByUserId"
    ) VALUES (
      'invalid-fee-creator', 'GLOBAL', 'BOLETO', 1,
      'FIXED', 100, 'FIXED', 50,
      CURRENT_TIMESTAMP, 'missing-user'
    );
    RAISE EXCEPTION 'missing fee creator was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "PaymentCharge" (
      "id", "companyId", "invoiceId", "feeVersionId", "billingMethod",
      "grossAmountCents", "estimatedEfiFeeCents", "estimatedPlatformFeeCents",
      "feeSnapshot", "updatedAt"
    ) VALUES (
      'invalid-charge-invoice', 'integrity-company-a', 'integrity-invoice-b', 'integrity-global-pix', 'PIX',
      10000, 100, 200, '{}'::jsonb, CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'cross-tenant charge invoice was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "PaymentCharge" (
      "id", "companyId", "invoiceId", "feeVersionId", "billingMethod",
      "grossAmountCents", "estimatedEfiFeeCents", "estimatedPlatformFeeCents",
      "feeSnapshot", "updatedAt"
    ) VALUES (
      'invalid-charge-fee', 'integrity-company-a', 'integrity-invoice-a1', 'integrity-company-b-pix', 'PIX',
      10000, 100, 200, '{}'::jsonb, CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'cross-tenant charge fee was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-tenant charge fee was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "PaymentCharge" (
      "id", "companyId", "invoiceId", "feeVersionId", "billingMethod",
      "grossAmountCents", "estimatedEfiFeeCents", "estimatedPlatformFeeCents",
      "feeSnapshot", "updatedAt"
    ) VALUES (
      'invalid-charge-method', 'integrity-company-a', 'integrity-invoice-a1', 'integrity-global-pix', 'BOLETO',
      10000, 100, 200, '{}'::jsonb, CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'mismatched charge method was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'mismatched charge method was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "PaymentCharge" (
      "id", "companyId", "invoiceId", "feeVersionId", "replacesChargeId", "billingMethod",
      "grossAmountCents", "estimatedEfiFeeCents", "estimatedPlatformFeeCents",
      "feeSnapshot", "updatedAt"
    ) VALUES (
      'invalid-replacement', 'integrity-company-a', 'integrity-invoice-a2', 'integrity-global-pix',
      'integrity-charge-a1', 'PIX', 10000, 100, 200, '{}'::jsonb, CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'cross-invoice replacement was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

INSERT INTO "CommunicationConversation" (
  "id", "channel", "recipientHash", "retentionExpiresAt", "updatedAt"
) VALUES (
  'integrity-conversation', 'WHATSAPP', 'integrity-recipient-hash', CURRENT_TIMESTAMP + INTERVAL '5 years', CURRENT_TIMESTAMP
);

DO $$
BEGIN
  BEGIN
    INSERT INTO "CommunicationMessage" (
      "id", "conversationId", "companyId", "invoiceId", "direction", "content", "retentionExpiresAt"
    ) VALUES (
      'invalid-message-tenant', 'integrity-conversation', 'integrity-company-a', 'integrity-invoice-b',
      'OUTBOUND', 'test', CURRENT_TIMESTAMP + INTERVAL '5 years'
    );
    RAISE EXCEPTION 'cross-tenant message invoice was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "CommunicationMessage" (
      "id", "conversationId", "invoiceId", "direction", "content", "retentionExpiresAt"
    ) VALUES (
      'invalid-message-context', 'integrity-conversation', 'integrity-invoice-a1',
      'OUTBOUND', 'test', CURRENT_TIMESTAMP + INTERVAL '5 years'
    );
    RAISE EXCEPTION 'message context without company was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
