BEGIN;

LOCK TABLE "CollectionRuleStep" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "CollectionRuleStep" ADD COLUMN "emailTemplateId" TEXT;

-- EMAIL steps used to point at the WhatsApp catalog and were resolved by slug in the
-- email catalog. Convert only references whose effective email template is persisted
-- and active; anything else stops the migration with the affected step IDs, so the
-- email catalog can be prepared (GET /email/templates) without fabricating content here.
DO $$
DECLARE
  unmapped TEXT;
BEGIN
  SELECT string_agg(step."id" || ' (' || COALESCE(catalog."slug", 'sem template') || ')', ', ' ORDER BY step."id")
  INTO unmapped
  FROM "CollectionRuleStep" step
  LEFT JOIN "GlobalMessageTemplate" catalog ON catalog."id" = step."templateId"
  LEFT JOIN "GlobalEmailTemplate" email ON email."slug" = catalog."slug"
  WHERE step."channel" = 'EMAIL'
    AND step."templateId" IS NOT NULL
    AND (catalog."id" IS NULL OR NOT catalog."isActive" OR email."id" IS NULL OR NOT email."isActive");
  IF unmapped IS NOT NULL THEN
    RAISE EXCEPTION 'Etapas EMAIL sem template de e-mail correspondente: %. Prepare o catalogo de e-mail e revise os vinculos antes de aplicar a migracao.', unmapped;
  END IF;
END $$;

UPDATE "CollectionRuleStep" step
SET "emailTemplateId" = email."id", "templateId" = NULL
FROM "GlobalMessageTemplate" catalog
JOIN "GlobalEmailTemplate" email ON email."slug" = catalog."slug"
WHERE step."channel" = 'EMAIL' AND step."templateId" = catalog."id";

ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_emailTemplateId_fkey"
  FOREIGN KEY ("emailTemplateId") REFERENCES "GlobalEmailTemplate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "CollectionRuleStep_emailTemplateId_idx" ON "CollectionRuleStep"("emailTemplateId");

ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_channel_template_check" CHECK (
  ("channel" = 'EMAIL' AND "templateId" IS NULL)
  OR ("channel" = 'WHATSAPP' AND "emailTemplateId" IS NULL)
);

COMMIT;
