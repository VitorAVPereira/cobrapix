CREATE INDEX "Company_whatsappStatus_whatsappInstanceId_idx" ON "Company"("whatsappStatus", "whatsappInstanceId");

CREATE INDEX "Invoice_companyId_status_dueDate_idx" ON "Invoice"("companyId", "status", "dueDate");
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

CREATE INDEX "CollectionLog_companyId_actionType_createdAt_idx" ON "CollectionLog"("companyId", "actionType", "createdAt");
