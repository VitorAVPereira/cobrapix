-- CreateTable
CREATE TABLE "CommunicationInteractiveReference" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "messageId" TEXT NOT NULL,
    "buttonIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationInteractiveReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationInteractiveReference_tokenHash_key" ON "CommunicationInteractiveReference"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationInteractiveReference_messageId_buttonIndex_key" ON "CommunicationInteractiveReference"("messageId", "buttonIndex");

-- CreateIndex
CREATE INDEX "CommunicationMessage_classification_idx" ON "CommunicationMessage"("conversationId", "attributionMethod", "direction");

-- AddForeignKey
ALTER TABLE "CommunicationInteractiveReference" ADD CONSTRAINT "CommunicationInteractiveReference_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

