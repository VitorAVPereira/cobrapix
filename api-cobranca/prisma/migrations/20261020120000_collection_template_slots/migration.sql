-- CreateTable
CREATE TABLE "CollectionTemplateSlot" (
    "id" TEXT NOT NULL,
    "purpose" "WhatsappTemplatePurpose" NOT NULL,
    "billingMethod" "BillingMethod" NOT NULL,
    "templateId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionTemplateSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTemplateSlot_purpose_billingMethod_key" ON "CollectionTemplateSlot"("purpose", "billingMethod");

-- CreateIndex
CREATE INDEX "CollectionTemplateSlot_templateId_idx" ON "CollectionTemplateSlot"("templateId");

-- AddForeignKey
ALTER TABLE "CollectionTemplateSlot" ADD CONSTRAINT "CollectionTemplateSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GlobalMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only the 18 collection slots: the six collection moments x the methods still issued.
ALTER TABLE "CollectionTemplateSlot" ADD CONSTRAINT "CollectionTemplateSlot_slot_check" CHECK (
    "purpose" IN ('EMISSION', 'BEFORE_DUE', 'DUE_TODAY', 'FIRST_OVERDUE', 'RECURRING_OVERDUE', 'CRITICAL_OVERDUE')
    AND "billingMethod" IN ('PIX', 'BOLIX', 'CREDIT_CARD')
);
