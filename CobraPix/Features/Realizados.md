Etapa 1 concluída
Schema — 7 enums + 7 models + 13 campos novos
Enums:
Enum	Valores
CollectionProfileType	NEW, GOOD, DOUBTFUL, BAD
CollectionChannel	EMAIL, WHATSAPP
CollectionAttemptStatus	QUEUED, SENT, FAILED, DELIVERED, OPENED, CLICKED
ConversationStatus	NEW, IN_PROGRESS, CLOSED
MessageDirection	INBOUND, OUTBOUND
Models:
Model	Propósito	Índices
CollectionProfile	Perfil de cobrança (NEW/GOOD/DOUBTFUL/BAD) com thresholds de dias de atraso	@@unique([companyId, name]), @@index([companyId, isDefault])
CollectionRuleStep	Etapa da régua com canal, template, delay, janela de envio	@@unique([profileId, stepOrder, channel])
CollectionAttempt	Idempotência: invoiceId + ruleStepId + channel único	@@unique([invoiceId, ruleStepId, channel]), @@index([companyId, createdAt])
EmailEvent	Eventos webhook Resend com dedup por emailMessageId	@@unique([emailMessageId]), @@index([companyId, createdAt])
WhatsAppConversation	Inbox operacional — conversa única por companyId + phoneNumber	@@unique([companyId, phoneNumber]), @@index([companyId, status, updatedAt])
WhatsAppMessage	Mensagens dentro de uma conversa	@@index([conversationId, createdAt])
AuditLog	Trilha de auditoria para alterações	@@index([companyId, createdAt]), @@index([entityType, entityId])
Campos novos em modelos existentes:
- Company — resendApiKeyEncrypted, resendFromEmail, erpApiKeyHash, erpWebhookUrl, erpEnabledEvents
- Debtor — collectionProfileId (FK → CollectionProfile), externalDebtorId (+ unique constraint)
- Invoice — externalInvoiceId, externalRef (+ unique constraint)
Seed — Migração automática de dados
O seed (prisma/seed.ts:64-103) é idempotente:
1. Para cada company com collectionReminderDays, verifica se já existe CollectionProfile default
2. Se não, cria perfil "Padrão" com tipo NEW e isDefault: true
3. Cria CollectionRuleStep para cada dia do collectionReminderDays ordenado, canal WHATSAPP, com delayDays = diferença entre dias consecutivos
4. Atribui collectionProfileId a todos os debtors sem perfil daquela company
Resultado da execução: Migrated company ...: profile "Padrao" with 3 steps, debtors updated
Próximo passo: Etapa 2 (Resend Email)