Aqui está o plano separado em 8 etapas incrementais, cada uma com dependências claras, escopo definido e verificação:
---
Etapa 1: Schema Foundation (Dia 1-2)
Objetivo: Criar todos os modelos novos no banco sem quebrar o existente.
Dependências: Nenhuma (só o schema atual).
Entregas:
- CollectionProfile (NEW, GOOD, DOUBTFUL, BAD) com thresholds de dias de atraso e score
- CollectionRuleStep — etapa da régua com canal (EMAIL/WHATSAPP/SMS), template, delay após etapa anterior, horário de envio, flag ativo
- CollectionAttempt — registro de cada tentativa de cobrança por companyId + invoiceId + ruleStepId + channel, com status e timestamp
- Debtor.collectionProfile — perfil atribuído manualmente ou por sugestão automática
- EmailEvent — eventos do webhook Resend (sent, delivered, opened, clicked, bounced, etc.)
- WhatsAppConversation + WhatsAppMessage — inbox operacional
- Invoice.externalRef, Debtor.externalDebtorId — para integração ERP
- Índices: CollectionAttempt(companyId, createdAt), EmailEvent(messageId unique), WhatsAppConversation(companyId, status, updatedAt)
Migration dos dados atuais:
- Script que lê Company.collectionReminderDays e cria um CollectionProfile padrão ("Padrão") com as etapas equivalentes via WhatsApp
- Atribuir perfil NEW para todos os devedores existentes
Arquivos: prisma/schema.prisma, migration SQL, seed script de migração
Verificação: prisma migrate dev aplica sem erros, seed cria perfil padrão e atribui a devedores existentes
---
Etapa 2: Canal de E-mail via Resend (Dia 2-4)
Objetivo: Adicionar envio de e-mail como canal de cobrança, independente do WhatsApp.
Dependências: Etapa 1 (schema).
Entregas:
Backend:
- Módulo EmailModule com EmailService, EmailProcessor (worker BullMQ)
- EmailService.sendCollectionEmail(companyId, invoiceId, templateId) — HTML responsivo com link de pagamento, nome do devedor, dados da cobrança
- Armazenamento de RESEND_API_KEY criptografado na Company
- Worker email-messages na fila BullMQ com attempts >= 3, backoff exponencial, pacing 10/segundo
- POST /webhooks/resend — raw body + validação Svix (resend webhook signature), handler para 8 tipos de evento, idempotência por svix-id
- EmailService.getStats(companyId) — entregas, aberturas, cliques, bounces no período
Frontend:
- Campo de e-mail no formulário de criação manual e CSV (já existe)
- Template de e-mail no editor de templates (nova categoria EMAIL)
- Cartão "E-mails Enviados" no dashboard
Arquivos: src/email/email.module.ts, src/email/email.service.ts, src/email/email.processor.ts, src/webhooks/ (novo handler), prisma/schema.prisma (Company.resendApiKeyEncrypted)
Verificação: POST /billing/run envia e-mail de teste, webhook Resend recebe evento delivered, dashboard mostra métricas
---
Etapa 3: Régua de Cobrança por Perfil (Dia 4-7)
Objetivo: Substituir collectionReminderDays fixo por regras configuráveis por perfil de pagador.
Dependências: Etapa 1 (schema), Etapa 2 (Resend disponível como canal).
Entregas:
Backend:
- CollectionProfileService — CRUD de perfis e etapas, classificação automática de devedores (baseado em histórico de pagamento, dias de atraso, score)
- GET/PUT /billing/rules — API para listar e editar perfis e etapas (substitui o GET/PUT /billing/settings para collectionReminderDays)
- CollectionRuleEngine — dado um perfil e uma invoice, calcula qual etapa disparar e qual canal usar, considerando horário de envio permitido, delay entre etapas, e se o canal anterior já foi tentado
- Migração automática: ao iniciar, converte collectionReminderDays antigos em um perfil padrão com etapas WhatsApp equivalentes
- POST /billing/run adaptado para usar o rule engine em vez da lógica fixa antiga
Frontend:
- Tela Configurações > Régua de Cobrança com:
  - Lista de perfis (NEW, GOOD, DOUBTFUL, BAD + customizados)
  - Editor drag-and-drop de etapas por perfil: canal (Email/WhatsApp), template, delay (dias após etapa anterior), horário permitido
  - Preview visual da sequência
- Coluna "Perfil" na InvoiceTable
- Badge de perfil no modal do devedor
Arquivos: src/billing/collection-profile.service.ts, src/billing/collection-rule-engine.ts, src/billing/billing.controller.ts (novos endpoints), frontend/.../configuracoes/regua/page.tsx
Verificação: Criar perfil GOOD com 2 etapas (email dia -2, WhatsApp dia 0), gerar fatura para devedor GOOD, executar billing, verificar que email foi enviado 2 dias antes e WhatsApp no dia do vencimento
---
Etapa 4: CollectionAttempt & Multicanal (Dia 7-9)
Objetivo: Unificar a execução da régua em um engine multicanal com tracking de tentativas.
Dependências: Etapas 1-3.
Entregas:
Backend:
- CollectionOrchestrator — orquestrador que:
  1. Carrega invoices pendentes por company
  2. Para cada uma, obtém o perfil do devedor
  3. Consulta CollectionRuleEngine para determinar a etapa atual
  4. Verifica idempotência via CollectionAttempt (companyId + invoiceId + ruleStepId + channel)
  5. Dispara job BullMQ adequado (WhatsApp ou Email) com pacing por canal
  6. Registra CollectionAttempt com status QUEUED
- Worker de e-mail e WhatsApp atualizam CollectionAttempt para SENT/FAILED
- Fallback de canal: se WhatsApp falhar (token inválido, limite diário), tenta e-mail na mesma etapa
- CollectionAttempt.getHistory(invoiceId) — timeline de todas as tentativas
- Pacing por canal: email até 50/segundo, WhatsApp respeitando limite diário por WABA
Arquivos: src/billing/collection-orchestrator.ts, src/billing/collection-attempt.service.ts, workers atualizados, billing.service.ts refatorado
Verificação: Criar régua com email + WhatsApp, executar billing, verificar CollectionAttempt com 2 registros (email QUEUED → SENT, WhatsApp QUEUED → SENT), idempotência impede reenvio na mesma janela
---
Etapa 5: WhatsApp Inbox Operacional (Dia 9-12)
Objetivo: Permitir que o lojista veja e responda mensagens de clientes dentro da janela de 24h.
Dependências: Etapa 1 (schema), webhook Meta existente.
Entregas:
Backend:
- WhatsAppConversationService — cria/atualiza conversas a partir de mensagens inbound do webhook Meta
- GET /whatsapp/conversations — lista com paginação, filtro por status (NEW/IN_PROGRESS/CLOSED), busca por nome/telefone
- GET /whatsapp/conversations/:id/messages — histórico de mensagens da conversa
- POST /whatsapp/conversations/:id/reply — envia mensagem de texto simples (não template) se serviceWindowExpiresAt > now()
- PUT /whatsapp/conversations/:id/assignee — atribui responsável (user da company)
- PUT /whatsapp/conversations/:id/status — muda status (NEW → IN_PROGRESS → CLOSED)
- Validação da janela de 24h: serviceWindowExpiresAt calculado a partir da última mensagem inbound do cliente
- Idempotência: inbound messages com mesmo messageId não duplicam
Frontend:
- Tela Inbox WhatsApp com:
  - Split view: lista de conversas (esquerda) / chat (direita)
  - Badges: status (NEW/IN_PROGRESS/CLOSED), responsável, janela de resposta restante (contador regressivo)
  - Campo de resposta com botão enviar (desabilitado se janela expirou)
  - Busca e filtros
  - Indicador de "não lido"
- Link no sidebar: "Inbox WhatsApp" com badge de contagem de não lidos
- Notificação visual no header quando há novas mensagens
Arquivos: src/whatsapp/conversation.service.ts, src/whatsapp/conversation.controller.ts, frontend/.../inbox/page.tsx, frontend/.../components/WhatsAppChat.tsx
Verificação: Cliente envia "Olá" pelo WhatsApp, aparece na inbox, lojista responde, cliente recebe, conversa muda para IN_PROGRESS
---
Etapa 6: Relatórios em Tempo Quase Real (Dia 12-14)
Objetivo: Expandir métricas com dados multicanal e por perfil.
Dependências: Etapas 1-4 (dados de CollectionAttempt e EmailEvent existem).
Entregas:
Backend:
- GET /billing/metrics expandido:
  - Recuperação por perfil (NEW/GOOD/DOUBTFUL/BAD): valor recuperado, taxa, tempo médio
  - Recuperação por canal: WhatsApp vs Email (taxa de conversão, tempo até pagamento)
  - Recuperação por etapa da régua: quantos pagam na 1ª, 2ª, 3ª etapa
  - Métricas de e-mail: entregas, taxa de abertura, taxa de clique, bounces
  - Aging de inadimplência: 0-30, 31-60, 61-90, 90+ dias
  - Timeline de collection attempts por invoice
- GET /billing/export — exportação CSV/Excel das métricas
Frontend:
- Dashboard expandido com:
  - Gráfico de barras: recuperação por perfil
  - Gráfico de pizza: canais utilizados
  - Tabela de aging
  - Métricas de e-mail (abertura/clique)
- Filtro de período mantido (hoje, 7d, 30d, ano)
Arquivos: src/billing/billing.service.ts (métricas expandidas), frontend/.../page.tsx (dashboard)
Verificação: Executar billing para múltiplos perfis, verificar dashboard mostra recuperação por perfil e canal corretamente
---
Etapa 7: Integração ERP Genérica (Dia 14-16)
Objetivo: Permitir que ERPs externos sincronizem devedores e faturas via API.
Dependências: Etapa 1 (externalRef no schema).
Entregas:
Backend:
- Módulo IntegrationModule com ErpIntegrationService
- Geração de API key por empresa: hash SHA-256 armazenado em Company.erpApiKeyHash
- Autenticação via header X-API-Key + X-Company-Id
- POST /integrations/erp/debtors/upsert — upsert de devedor por externalDebtorId + companyId
- POST /integrations/erp/invoices/upsert — upsert de fatura por externalInvoiceId + companyId
- GET /integrations/erp/invoices?updatedSince=ISO — lista faturas atualizadas após data
- PUT /integrations/erp/settings — webhook URL de saída, eventos a notificar
- Webhooks outbound assinados (HMAC-SHA256) para eventos: payment.received, invoice.overdue, invoice.canceled, collection.attempted
- Retry de webhooks outbound com BullMQ (3 tentativas, backoff exponencial)
- Idempotência: externalEventId enviado no payload, ERP deve ignorar duplicados
Frontend:
- Tela Configurações > Integração ERP com:
  - Geração/revogação de API key
  - Webhook URL de saída
  - Checkboxes de eventos a notificar
  - Log de últimos webhooks enviados (status, timestamp)
Arquivos: src/integration/erp/, frontend/.../configuracoes/erp/page.tsx
Verificação: Criar API key, upsert devedor via API, upsert fatura, marcar como paga, verificar webhook outbound enviado com assinatura válida
---
Etapa 8: Segurança & Observabilidade (Dia 16-18)
Objetivo: Hardening final antes de produção.
Dependências: Etapas 1-7 (todos os webhooks e serviços existem).
Entregas:
- Verificação de assinatura Svix no webhook Resend (svix-id, svix-timestamp, svix-signature)
- Verificação HMAC nos webhooks outbound ERP
- Rate limiting nos endpoints de integração ERP (100 req/min por API key)
- Logs estruturados (JSON) com correlationId, companyId, channel, eventType em todos os serviços
- CollectionAttempt com campo errorDetails para diagnóstico de falhas
- Health check expandido: Resend API ping, Redis, BullMQ queue depth
- Auditoria: AuditLog model para alterações em regras de cobrança, configurações ERP, atribuição de conversas
- Testes unitários para: CollectionProfileService.classify(), CollectionRuleEngine.getNextStep(), EmailService.send(), ResendWebhookHandler, ErpIntegrationService
- Testes e2e: fatura → pagamento → e-mail → webhook → relatório → webhook ERP
Arquivos: src/common/, health indicators, testes *.spec.ts, test/ e2e
Verificação: npm run test && npm run build passa em ambos os projetos, npm run test:e2e cobre o fluxo completo
---
Resumo de Dependências
Etapa 1 (Schema)
  ├─► Etapa 2 (Resend Email)
  ├─► Etapa 3 (Régua por Perfil) ── depende de 1+2 ──┐
  └─► Etapa 5 (WhatsApp Inbox) ── depende de 1 ──────┤
                                                       ▼
                                              Etapa 4 (Orquestrador Multicanal)
                                                       │
                              ┌─────────────────────────┤
                              ▼                         ▼
                      Etapa 6 (Relatórios)     Etapa 7 (ERP Integration)
                              │                         │
                              └─────────┬───────────────┘
                                        ▼
                                Etapa 8 (Segurança)
Total estimado: 16-18 dias (um dev full-time).
---
Quer que eu detalhe mais alguma etapa ou podemos começar pela Etapa 1?