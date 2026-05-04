-- CreateEnum
CREATE TYPE "CollectionProfileType" AS ENUM ('NEW', 'GOOD', 'DOUBTFUL', 'BAD');

-- CreateEnum
CREATE TYPE "CollectionChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "CollectionAttemptStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'DELIVERED', 'OPENED', 'CLICKED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "resendApiKeyEncrypted" TEXT,
ADD COLUMN "resendFromEmail" TEXT,
ADD COLUMN "erpApiKeyHash" TEXT,
ADD COLUMN "erpWebhookUrl" TEXT,
ADD COLUMN "erpEnabledEvents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Debtor" ADD COLUMN "collectionProfileId" TEXT,
ADD COLUMN "externalDebtorId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "externalInvoiceId" TEXT,
ADD COLUMN "externalRef" TEXT;

-- CreateTable
CREATE TABLE "CollectionProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profileType" "CollectionProfileType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "daysOverdueMin" INTEGER,
    "daysOverdueMax" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionRuleStep" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "channel" "CollectionChannel" NOT NULL,
    "templateId" TEXT,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "sendTimeStart" TEXT,
    "sendTimeEnd" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionRuleStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAttempt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "ruleStepId" TEXT NOT NULL,
    "channel" "CollectionChannel" NOT NULL,
    "status" "CollectionAttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "externalMessageId" TEXT,
    "errorDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "svixId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "invoiceId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "rawPayload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "debtorId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'NEW',
    "assigneeId" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "serviceWindowExpiresAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "messageId" TEXT,
    "status" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionProfile_companyId_name_key" ON "CollectionProfile"("companyId", "name");

-- CreateIndex
CREATE INDEX "CollectionProfile_companyId_isDefault_idx" ON "CollectionProfile"("companyId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionRuleStep_profileId_stepOrder_channel_key" ON "CollectionRuleStep"("profileId", "stepOrder", "channel");

-- CreateIndex
CREATE INDEX "CollectionRuleStep_profileId_stepOrder_idx" ON "CollectionRuleStep"("profileId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAttempt_companyId_invoiceId_ruleStepId_channel_key" ON "CollectionAttempt"("companyId", "invoiceId", "ruleStepId", "channel");

-- CreateIndex
CREATE INDEX "CollectionAttempt_companyId_createdAt_idx" ON "CollectionAttempt"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionAttempt_invoiceId_idx" ON "CollectionAttempt"("invoiceId");

-- CreateIndex
CREATE INDEX "CollectionAttempt_externalMessageId_idx" ON "CollectionAttempt"("externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_svixId_key" ON "EmailEvent"("svixId");

-- CreateIndex
CREATE INDEX "EmailEvent_companyId_occurredAt_idx" ON "EmailEvent"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailEvent_emailMessageId_idx" ON "EmailEvent"("emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_companyId_phoneNumber_key" ON "WhatsAppConversation"("companyId", "phoneNumber");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_companyId_status_updatedAt_idx" ON "WhatsAppConversation"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_messageId_key" ON "WhatsAppMessage"("messageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_createdAt_idx" ON "WhatsAppMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Debtor_companyId_externalDebtorId_key" ON "Debtor"("companyId", "externalDebtorId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_externalInvoiceId_key" ON "Invoice"("companyId", "externalInvoiceId");

-- AddForeignKey
ALTER TABLE "Debtor" ADD CONSTRAINT "Debtor_collectionProfileId_fkey" FOREIGN KEY ("collectionProfileId") REFERENCES "CollectionProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionProfile" ADD CONSTRAINT "CollectionProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CollectionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRuleStep" ADD CONSTRAINT "CollectionRuleStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAttempt" ADD CONSTRAINT "CollectionAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAttempt" ADD CONSTRAINT "CollectionAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAttempt" ADD CONSTRAINT "CollectionAttempt_ruleStepId_fkey" FOREIGN KEY ("ruleStepId") REFERENCES "CollectionRuleStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "CollectionProfile" ("id", "companyId", "name", "profileType", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'Padrao', 'NEW', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company" c
WHERE NOT EXISTS (
    SELECT 1
    FROM "CollectionProfile" p
    WHERE p."companyId" = c."id" AND p."isDefault" = true
);

WITH reminder_days AS (
    SELECT
        c."id" AS "companyId",
        p."id" AS "profileId",
        reminder."day"::integer AS "reminderDay"
    FROM "Company" c
    INNER JOIN "CollectionProfile" p ON p."companyId" = c."id" AND p."isDefault" = true
    CROSS JOIN LATERAL unnest(
        CASE
            WHEN cardinality(COALESCE(c."collectionReminderDays", ARRAY[]::integer[])) = 0 THEN ARRAY[0]::integer[]
            ELSE c."collectionReminderDays"
        END
    ) AS reminder("day")
),
unique_days AS (
    SELECT DISTINCT
        "profileId",
        "reminderDay"
    FROM reminder_days
),
ordered_days AS (
    SELECT
        "profileId",
        "reminderDay",
        row_number() OVER (PARTITION BY "profileId" ORDER BY "reminderDay") - 1 AS "stepOrder"
    FROM unique_days
),
step_days AS (
    SELECT
        "profileId",
        "stepOrder",
        "reminderDay",
        lag("reminderDay", 1, 0) OVER (PARTITION BY "profileId" ORDER BY "stepOrder") AS "previousReminderDay"
    FROM ordered_days
)
INSERT INTO "CollectionRuleStep" ("id", "profileId", "stepOrder", "channel", "delayDays", "isActive", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "profileId",
    "stepOrder",
    'WHATSAPP',
    CASE
        WHEN "stepOrder" = 0 THEN "reminderDay"
        ELSE "reminderDay" - "previousReminderDay"
    END,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM step_days
WHERE NOT EXISTS (
    SELECT 1
    FROM "CollectionRuleStep" s
    WHERE s."profileId" = step_days."profileId"
);

UPDATE "Debtor" d
SET "collectionProfileId" = p."id"
FROM "CollectionProfile" p
WHERE p."companyId" = d."companyId"
  AND p."isDefault" = true
  AND d."collectionProfileId" IS NULL;
