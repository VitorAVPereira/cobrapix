-- AlterTable
ALTER TABLE "CommunicationAttachment" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorCode" VARCHAR(64),
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseToken" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sha256" VARCHAR(64),
ADD COLUMN     "storedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CommunicationAttachment_state_nextAttemptAt_idx" ON "CommunicationAttachment"("state", "nextAttemptAt");

