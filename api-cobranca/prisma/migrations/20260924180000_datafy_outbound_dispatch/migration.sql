ALTER TABLE "CommunicationOutboundIntent"
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "leaseToken" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "quotaReservedAt" TIMESTAMP(3);
CREATE INDEX "CommunicationOutboundIntent_state_nextAttemptAt_idx" ON "CommunicationOutboundIntent"("state", "nextAttemptAt");

ALTER TABLE "GlobalMessageTemplate"
ADD COLUMN "metaTemplateId" TEXT,
ADD COLUMN "metaQuality" TEXT,
ADD COLUMN "metaProviderCategory" TEXT,
ADD COLUMN "metaComponents" JSONB,
ADD COLUMN "metaReviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "metaStatusAt" TIMESTAMP(3),
ADD COLUMN "metaQualityAt" TIMESTAMP(3),
ADD COLUMN "metaCategoryAt" TIMESTAMP(3),
ADD COLUMN "metaComponentsAt" TIMESTAMP(3);
