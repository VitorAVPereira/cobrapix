BEGIN;

LOCK TABLE "CollectionRuleStep" IN SHARE ROW EXCLUSIVE MODE;

-- Never publish tenant-specific content into the shared catalog or silently
-- replace an unmapped selection with the default message. Leave all data intact
-- and require an explicit mapping before deploying in that case.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CollectionRuleStep" step
    JOIN "CollectionProfile" profile ON profile."id" = step."profileId"
    JOIN "MessageTemplate" legacy ON legacy."id" = step."templateId"
    LEFT JOIN "GlobalMessageTemplate" catalog ON catalog."slug" = legacy."slug"
    WHERE catalog."id" IS NULL OR legacy."companyId" <> profile."companyId"
  ) THEN
    RAISE EXCEPTION 'Reguas com templates legados sem correspondencia no catalogo global da empresa. Revise os vinculos antes de aplicar a migracao.';
  END IF;
END $$;

ALTER TABLE "CollectionRuleStep" DROP CONSTRAINT "CollectionRuleStep_templateId_fkey";

UPDATE "CollectionRuleStep" step
SET "templateId" = catalog."id"
FROM "MessageTemplate" legacy
JOIN "GlobalMessageTemplate" catalog ON catalog."slug" = legacy."slug"
WHERE step."templateId" = legacy."id";

ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "GlobalMessageTemplate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
