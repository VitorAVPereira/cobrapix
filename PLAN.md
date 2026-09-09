# Plano: Cobrança Multicanal Escalável

## Resumo

Implementar a evolução do CobraPix em 6 entregas: e-mail via Resend, régua de cobrança por perfil, inbox WhatsApp operacional, relatórios em tempo quase real, integração ERP genérica e endurecimento de segurança/observabilidade.

Decisões travadas:
- ERP inicial: API genérica + webhooks assinados.
- Perfis de pagador: manual com sugestão automática.
- WhatsApp: inbox operacional com responsáveis, status e resposta dentro da janela de 24h.

## Mudanças Principais

- Evoluir o modelo em [schema.prisma](/mnt/c/micro-saas/api-cobranca/prisma/schema.prisma) para suportar `CollectionProfile`, `CollectionRuleStep`, `CollectionAttempt`, preferências por canal, eventos de e-mail, conversas WhatsApp e `externalRef` para ERP.
- Substituir a régua simples `collectionReminderDays` por regras por perfil: `NEW`, `GOOD`, `DOUBTFUL`, `BAD`, mantendo migração automática das configurações atuais para o perfil padrão.
- Criar um módulo multicanal no backend, reaproveitando BullMQ/Redis, com jobs idempotentes por `companyId + invoiceId + ruleStepId + channel`.
- Implementar Resend com `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, HTML responsivo, link de Pix/Boleto/Bolix e webhook assinado para `sent`, `delivered`, `opened`, `clicked`, `bounced`, `complained`, `failed`, `delivery_delayed` e `suppressed`.
- Expandir WhatsApp para inbox: conversas por telefone/devedor, responsável, status `NEW | IN_PROGRESS | CLOSED`, histórico, busca, filtros e resposta manual apenas quando `serviceWindowExpiresAt` estiver válida.
- Criar integração ERP genérica: API key hash por empresa, `externalDebtorId`, `externalInvoiceId`, endpoints de upsert/consulta e webhooks outbound assinados para pagamento, vencimento, cancelamento e tentativas de cobrança.

## APIs E Interfaces

- `GET/PUT /billing/rules`: lista e salva perfis, etapas, canais, templates e horários de envio.
- `POST /billing/run`: passa a executar a régua multicanal, não só WhatsApp.
- `GET /billing/metrics`: adiciona recuperação por perfil, canal, etapa, entregas, abertura/clique de e-mail e aging de inadimplência.
- `POST /webhooks/resend`: recebe eventos Resend com raw body e validação Svix.
- `GET /whatsapp/conversations`, `GET /whatsapp/conversations/:id/messages`, `POST /whatsapp/conversations/:id/reply`, `PUT /whatsapp/conversations/:id/assignee`, `PUT /whatsapp/conversations/:id/status`.
- `POST /integrations/erp/debtors/upsert`, `POST /integrations/erp/invoices/upsert`, `GET /integrations/erp/invoices?updatedSince=...`, `PUT /integrations/erp/settings`.
- Frontend: novas telas em Configurações de Régua, Inbox WhatsApp, Integrações ERP e Dashboard expandido; manter todo acesso via [api-client.ts](/mnt/c/micro-saas/front-cobranca/src/lib/api-client.ts).

## Escalabilidade E Segurança

- Todos os envios externos ficam fora do event loop síncrono, usando BullMQ com `attempts >= 3`, backoff exponencial, pacing por canal e limites Meta já existentes.
- Redis mantém DB `/0` para BullMQ e prefixos por domínio: `billing:*`, `email:*`, `whatsapp:*`, `erp:*`.
- Toda consulta Prisma mantém `companyId`; credenciais Resend/Meta/ERP ficam criptografadas ou hasheadas, nunca em logs.
- Webhooks Meta, Efí, Resend e ERP são assinados/verificados; eventos recebidos são idempotentes por `messageId`/`svix-id`/`externalEventId`.
- Dados do cliente ficam sob controle da empresa: exportação CSV/Excel, histórico completo, trilha de auditoria e preferências por canal/devedor.

## Testes

- Backend unitário: classificador de perfis, cálculo de etapas da régua, idempotência dos jobs, fallback de canal, Resend mockado, webhook Resend assinado, inbox WhatsApp e isolamento `companyId`.
- Backend e2e: criação de fatura -> geração de pagamento -> envio e-mail/WhatsApp -> webhook de status -> relatório atualizado -> webhook ERP emitido.
- Frontend: testes Jest para api-client e componentes críticos; validação visual/manual das telas de régua, inbox e integração ERP.
- Verificação final: `cd api-cobranca && npm run test && npm run build`; `cd front-cobranca && npx jest && npm run build`.

## Assumptions

- SMS, IA de cobrança, protesto/negativação e conectores nativos Omie/TOTVS ficam fora do primeiro ciclo.
- Relatórios “em tempo real” serão near real-time por webhooks + polling curto no frontend; WebSocket/SSE entra depois se necessário.
- E-mail de cobrança v1 envia HTML com links e dados de pagamento; anexar PDF binário de boleto fica opcional por configuração para proteger entregabilidade.
- Fontes de referência: [Neofin Régua de Cobrança](https://www.neofin.com.br/solucoes/regua-de-cobranca-inteligente), [Neofin Interface WhatsApp](https://www.neofin.com.br/solucoes/interface-whatsapp), [Resend SDK Node](https://github.com/resend/resend-node), [eventos de webhook Resend](https://resend.com/docs/webhooks/event-types) e [verificação de webhooks Resend](https://resend.com/docs/webhooks/verify-webhooks-requests).
