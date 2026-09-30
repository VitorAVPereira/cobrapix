-- A WhatsApp rule step may choose one template per billing method. Null keeps the
-- step's own choice, so existing steps keep their behavior without a backfill.
ALTER TABLE "CollectionRuleStep" ADD COLUMN     "boletoTemplateId" TEXT,
ADD COLUMN     "bolixTemplateId" TEXT,
ADD COLUMN     "pixTemplateId" TEXT;

CREATE INDEX "CollectionRuleStep_pixTemplateId_idx" ON "CollectionRuleStep"("pixTemplateId");

CREATE INDEX "CollectionRuleStep_boletoTemplateId_idx" ON "CollectionRuleStep"("boletoTemplateId");

CREATE INDEX "CollectionRuleStep_bolixTemplateId_idx" ON "CollectionRuleStep"("bolixTemplateId");

ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_pixTemplateId_fkey" FOREIGN KEY ("pixTemplateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_boletoTemplateId_fkey" FOREIGN KEY ("boletoTemplateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_bolixTemplateId_fkey" FOREIGN KEY ("bolixTemplateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- E-mail steps keep their own catalog: no WhatsApp template per billing method.
ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_method_templates_check" CHECK (
  "channel" = 'WHATSAPP'
  OR ("pixTemplateId" IS NULL AND "boletoTemplateId" IS NULL AND "bolixTemplateId" IS NULL)
);
