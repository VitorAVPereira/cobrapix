-- CreateEnum
CREATE TYPE "CommunicationTransport" AS ENUM ('META_DIRECT', 'DATAFY');

-- CreateEnum
CREATE TYPE "CommunicationRecipientType" AS ENUM ('PHONE', 'BSUID');

-- CreateEnum
CREATE TYPE "CommunicationMessageSource" AS ENUM ('LEGACY', 'LIVE', 'IMPORTED');

-- CreateEnum
CREATE TYPE "CommunicationAttributionMethod" AS ENUM ('UNASSIGNED', 'OUTBOUND_CONTEXT', 'REPLY_CONTEXT', 'INTERACTIVE_CONTEXT', 'MANUAL');

-- CreateEnum
CREATE TYPE "CommunicationDeliveryState" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommunicationIntentState" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'FAILED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "CommunicationActorType" AS ENUM ('SYSTEM', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "CommunicationAttachmentState" AS ENUM ('PENDING', 'READY', 'UNAVAILABLE', 'EXPIRED');

-- AlterTable
ALTER TABLE "CommunicationConversation" ADD COLUMN     "recipientType" "CommunicationRecipientType";

-- AlterTable
ALTER TABLE "CommunicationMessage" ADD COLUMN     "attributionMethod" "CommunicationAttributionMethod",
ADD COLUMN     "attributionRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "messageType" TEXT,
ADD COLUMN     "providerTimestamp" TIMESTAMP(3),
ADD COLUMN     "recipientType" "CommunicationRecipientType",
ADD COLUMN     "replyToExternalMessageId" TEXT,
ADD COLUMN     "source" "CommunicationMessageSource" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "statusOccurredAt" TIMESTAMP(3),
ADD COLUMN     "transportChannelId" TEXT;

-- CreateTable
CREATE TABLE "CommunicationWebhookDelivery" (
    "id" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "transport" "CommunicationTransport" NOT NULL,
    "transportChannelId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "bodyHash" VARCHAR(64) NOT NULL,
    "payloadEncrypted" TEXT,
    "state" "CommunicationDeliveryState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(64),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "payloadPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationOutboundIntent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "messageId" TEXT NOT NULL,
    "companyId" TEXT,
    "invoiceId" TEXT,
    "debtorId" TEXT,
    "transport" "CommunicationTransport" NOT NULL,
    "transportChannelId" TEXT NOT NULL,
    "recipientType" "CommunicationRecipientType" NOT NULL,
    "recipientHash" VARCHAR(64) NOT NULL,
    "recipientEncrypted" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "payloadEncrypted" TEXT,
    "state" "CommunicationIntentState" NOT NULL DEFAULT 'PENDING',
    "externalMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(64),
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationOutboundIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationAttributionAudit" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "actorType" "CommunicationActorType" NOT NULL,
    "actorUserId" TEXT,
    "method" "CommunicationAttributionMethod" NOT NULL,
    "oldContext" JSONB NOT NULL,
    "newContext" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationAttributionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "externalMediaId" TEXT,
    "contentType" VARCHAR(255),
    "sizeBytes" INTEGER,
    "storageKey" TEXT,
    "state" "CommunicationAttachmentState" NOT NULL DEFAULT 'PENDING',
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationWebhookDelivery_state_nextAttemptAt_idx" ON "CommunicationWebhookDelivery"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CommunicationWebhookDelivery_state_leaseExpiresAt_idx" ON "CommunicationWebhookDelivery"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "CommunicationWebhookDelivery_retentionExpiresAt_idx" ON "CommunicationWebhookDelivery"("retentionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationWebhookDelivery_transport_channel_delivery_key" ON "CommunicationWebhookDelivery"("transport", "transportChannelId", "deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationOutboundIntent_idempotencyKey_key" ON "CommunicationOutboundIntent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationOutboundIntent_messageId_key" ON "CommunicationOutboundIntent"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationOutboundIntent_externalMessageId_key" ON "CommunicationOutboundIntent"("externalMessageId");

-- CreateIndex
CREATE INDEX "CommunicationOutboundIntent_companyId_createdAt_id_idx" ON "CommunicationOutboundIntent"("companyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CommunicationOutboundIntent_state_createdAt_idx" ON "CommunicationOutboundIntent"("state", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationOutboundIntent_retentionExpiresAt_idx" ON "CommunicationOutboundIntent"("retentionExpiresAt");

-- CreateIndex
CREATE INDEX "CommunicationAttributionAudit_actorUserId_createdAt_idx" ON "CommunicationAttributionAudit"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationAttributionAudit_messageId_revision_key" ON "CommunicationAttributionAudit"("messageId", "revision");

-- CreateIndex
CREATE INDEX "CommunicationAttachment_state_createdAt_idx" ON "CommunicationAttachment"("state", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationAttachment_retentionExpiresAt_idx" ON "CommunicationAttachment"("retentionExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationAttachment_messageId_externalMediaId_key" ON "CommunicationAttachment"("messageId", "externalMediaId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_tenant_conversation_cursor_idx" ON "CommunicationMessage"("companyId", "conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CommunicationMessage_tenant_cursor_idx" ON "CommunicationMessage"("companyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CommunicationMessage_reply_context_idx" ON "CommunicationMessage"("transportChannelId", "replyToExternalMessageId");

-- AddForeignKey
ALTER TABLE "CommunicationOutboundIntent" ADD CONSTRAINT "CommunicationOutboundIntent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationOutboundIntent" ADD CONSTRAINT "CommunicationOutboundIntent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationOutboundIntent" ADD CONSTRAINT "CommunicationOutboundIntent_invoiceId_companyId_fkey" FOREIGN KEY ("invoiceId", "companyId") REFERENCES "Invoice"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationOutboundIntent" ADD CONSTRAINT "CommunicationOutboundIntent_debtorId_companyId_fkey" FOREIGN KEY ("debtorId", "companyId") REFERENCES "Debtor"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAttributionAudit" ADD CONSTRAINT "CommunicationAttributionAudit_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAttributionAudit" ADD CONSTRAINT "CommunicationAttributionAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAttachment" ADD CONSTRAINT "CommunicationAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants not expressible in the Prisma schema. No inferred legacy context.
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_revision_check"
  CHECK ("attributionRevision" >= 0);

ALTER TABLE "CommunicationOutboundIntent"
  ADD CONSTRAINT "CommunicationOutboundIntent_context_check"
    CHECK ("companyId" IS NOT NULL OR ("invoiceId" IS NULL AND "debtorId" IS NULL)),
  ADD CONSTRAINT "CommunicationOutboundIntent_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "CommunicationOutboundIntent_hashes_check"
    CHECK ("requestHash" ~ '^[a-f0-9]{64}$' AND "recipientHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "CommunicationOutboundIntent_channel_check" CHECK ("transportChannelId" ~ '^[0-9]{1,64}$'),
  ADD CONSTRAINT "CommunicationOutboundIntent_error_check" CHECK ("lastErrorCode" ~ '^[A-Z0-9_]{1,64}$');

ALTER TABLE "CommunicationWebhookDelivery"
  ADD CONSTRAINT "CommunicationWebhookDelivery_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "CommunicationWebhookDelivery_hash_check" CHECK ("bodyHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "CommunicationWebhookDelivery_channel_check" CHECK ("transportChannelId" ~ '^[0-9]{1,64}$'),
  ADD CONSTRAINT "CommunicationWebhookDelivery_error_check" CHECK ("lastErrorCode" ~ '^[A-Z0-9_]{1,64}$');

ALTER TABLE "CommunicationAttributionAudit"
  ADD CONSTRAINT "CommunicationAttributionAudit_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "CommunicationAttributionAudit_actor_check" CHECK ("actorType" <> 'SYSTEM' OR "actorUserId" IS NULL);

ALTER TABLE "CommunicationAttachment" ADD CONSTRAINT "CommunicationAttachment_size_check" CHECK ("sizeBytes" >= 0);
