-- CreateEnum
CREATE TYPE "WhatsappSelectionMode" AS ENUM ('EXPLICIT', 'DEFAULT', 'UNCONFIGURED');

-- AlterTable
ALTER TABLE "CollectionRuleStep" ADD COLUMN     "whatsappPurpose" "WhatsappTemplatePurpose",
ADD COLUMN     "whatsappSelectionMode" "WhatsappSelectionMode";


-- Existing WhatsApp steps keep their ID, order, delays and old template reference, but
-- need an explicit choice among the imported templates: nothing is granted or picked here.
-- The purpose recognized from the legacy slug is kept as a hint for that choice.
UPDATE "CollectionRuleStep" step
SET "whatsappSelectionMode" = 'UNCONFIGURED',
    "whatsappPurpose" = CASE catalog."slug"
      WHEN 'cobranca-emissao' THEN 'EMISSION'::"WhatsappTemplatePurpose"
      WHEN 'pre-vencimento' THEN 'BEFORE_DUE'::"WhatsappTemplatePurpose"
      WHEN 'vencimento-hoje' THEN 'DUE_TODAY'::"WhatsappTemplatePurpose"
      WHEN 'atraso-primeiro-aviso' THEN 'FIRST_OVERDUE'::"WhatsappTemplatePurpose"
      WHEN 'atraso-recorrente' THEN 'RECURRING_OVERDUE'::"WhatsappTemplatePurpose"
      WHEN 'atraso-critico' THEN 'CRITICAL_OVERDUE'::"WhatsappTemplatePurpose"
      ELSE NULL
    END
FROM "CollectionRuleStep" source
LEFT JOIN "GlobalMessageTemplate" catalog ON catalog."id" = source."templateId"
WHERE step."id" = source."id" AND step."channel" = 'WHATSAPP';

ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_whatsapp_selection_check" CHECK (
  ("channel" = 'EMAIL' AND "whatsappSelectionMode" IS NULL AND "whatsappPurpose" IS NULL)
  OR ("channel" = 'WHATSAPP' AND "whatsappSelectionMode" IS NOT NULL
      AND ("whatsappSelectionMode" <> 'DEFAULT' OR "whatsappPurpose" IS NOT NULL)
      AND ("whatsappSelectionMode" <> 'EXPLICIT' OR "templateId" IS NOT NULL))
);
