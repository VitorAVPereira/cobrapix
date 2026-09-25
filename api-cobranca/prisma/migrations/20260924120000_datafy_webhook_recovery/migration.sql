-- AlterTable
ALTER TABLE "CommunicationWebhookDelivery" ADD COLUMN     "eventKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastReplayActorId" TEXT,
ADD COLUMN     "lastReplayedAt" TIMESTAMP(3),
ADD COLUMN     "leaseToken" TEXT,
ADD COLUMN     "replayCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wabaId" TEXT;

-- CreateTable
CREATE TABLE "CommunicationRecipientSuppression" (
    "id" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "recipientType" "CommunicationRecipientType" NOT NULL,
    "recipientHash" VARCHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationRecipientSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessageStatusEvent" (
    "id" TEXT NOT NULL,
    "eventKey" VARCHAR(64) NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "transportChannelId" TEXT NOT NULL,
    "recipientType" "CommunicationRecipientType" NOT NULL,
    "recipientHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "errorCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appliedAt" TIMESTAMP(3),
    "resolutionCode" VARCHAR(64),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationMessageStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationRecipientSuppression_channel_recipientHash_key" ON "CommunicationRecipientSuppression"("channel", "recipientHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessageStatusEvent_eventKey_key" ON "CommunicationMessageStatusEvent"("eventKey");

-- CreateIndex
CREATE INDEX "CommunicationMessageStatusEvent_appliedAt_nextAttemptAt_idx" ON "CommunicationMessageStatusEvent"("appliedAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CommunicationMessageStatusEvent_externalMessageId_transport_idx" ON "CommunicationMessageStatusEvent"("externalMessageId", "transportChannelId");

-- CreateIndex
CREATE INDEX "CommunicationMessageStatusEvent_deliveryId_idx" ON "CommunicationMessageStatusEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "CommunicationMessageStatusEvent_retentionExpiresAt_idx" ON "CommunicationMessageStatusEvent"("retentionExpiresAt");

-- CreateIndex
CREATE INDEX "CommunicationWebhookDelivery_reviewRequired_createdAt_idx" ON "CommunicationWebhookDelivery"("reviewRequired", "createdAt");

-- AddForeignKey
ALTER TABLE "CommunicationMessageStatusEvent" ADD CONSTRAINT "CommunicationMessageStatusEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "CommunicationWebhookDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunicationWebhookDelivery"
  ADD CONSTRAINT "CommunicationWebhookDelivery_replay_check" CHECK ("replayCount" >= 0),
  ADD CONSTRAINT "CommunicationWebhookDelivery_waba_check" CHECK ("wabaId" ~ '^[0-9]{1,64}$');
ALTER TABLE "CommunicationRecipientSuppression"
  ADD CONSTRAINT "CommunicationRecipientSuppression_hash_check" CHECK ("recipientHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "CommunicationRecipientSuppression_reason_check" CHECK ("reasonCode" ~ '^[A-Z0-9_]{1,64}$');
ALTER TABLE "CommunicationMessageStatusEvent"
  ADD CONSTRAINT "CommunicationMessageStatusEvent_status_check" CHECK ("status" IN ('sent', 'delivered', 'read', 'failed')),
  ADD CONSTRAINT "CommunicationMessageStatusEvent_hash_check" CHECK ("eventKey" ~ '^[a-f0-9]{64}$' AND "recipientHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "CommunicationMessageStatusEvent_channel_check" CHECK ("transportChannelId" ~ '^[0-9]{1,64}$'),
  ADD CONSTRAINT "CommunicationMessageStatusEvent_resolution_check" CHECK ("resolutionCode" ~ '^[A-Z0-9_]{1,64}$'),
  ADD CONSTRAINT "CommunicationMessageStatusEvent_errors_check" CHECK (cardinality("errorCodes") = 0 OR array_to_string("errorCodes", ',') ~ '^[0-9]{1,12}(,[0-9]{1,12})*$');
