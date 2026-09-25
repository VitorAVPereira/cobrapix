# Execução — WhatsApp somente via Datafy

Pedido do responsável (25/09/2026): a plataforma usará apenas o Datafy; remover as
integrações diretas com a Meta e manter o WhatsApp só via Datafy. Complementa as
etapas 1–8 de `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`.

## Decisões

- Ruling (responsável): remover o webhook `/webhooks/meta` e as variáveis `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_BASE_URL`; o app Meta próprio deixa de ser assinado.
- Ruling (responsável): manter os nomes `META_PHONE_NUMBER_ID` e `META_BUSINESS_ACCOUNT_ID`: são IDs da WABA, ainda conferidos contra o `/me` do Datafy.
- Ruling (responsável): remover a página `/configuracoes/whatsapp` (formulário de token Meta por empresa, já recusado pelo backend e fora do menu); o caminho redireciona para `/configuracoes/cobranca`.
- Ruling (responsável): produção ainda não envia mensagens reais; publicação direta com Datafy, sem janela de transição. `infra/interserver/DATAFY.md` foi reescrito nesse formato.
- Ruling: banco preservado. Os valores de enum `META_DIRECT`, `META_CLOUD` e `META` (estado de pausa do canal) e as colunas `meta*` de `Company` continuam como histórico; nenhuma migration. Intenção pendente com `transport = META_DIRECT` falha antes de transmitir, sem reenvio pelo Datafy.
- Ruling: `WHATSAPP_TRANSPORT` e `META_ACCESS_TOKEN`/`META_GRAPH_API_VERSION` deixam de existir; se ainda presentes no ambiente são descartadas pela validação. Em produção `DATAFY_API_TOKEN`, `DATAFY_WEBHOOK_SECRET`, `DATAFY_WEBHOOK_BASE_URL` e os IDs são obrigatórios; fora de produção podem faltar (canal não configurado, cobrança registrada como pendente). Formatos (`sk_live_`, `whsec_`, IDs numéricos) validados sempre.
- Ruling: o consumo de 24 h do painel (`GET /whatsapp/usage`) era alimentado só pelo webhook Meta (`WhatsAppInteraction`). Passa a ser calculado das mensagens WhatsApp da empresa em `CommunicationMessage`: enviados = `sent`/`delivered`/`read`, entregues = `delivered`/`read`, lidos, falhas e respostas recebidas atribuídas à empresa.
- Ruling: `/health` informa o canal Datafy como `healthy` quando a configuração local está completa, com `authentication: NOT_CHECKED` (mesma semântica da antiga Meta direta); antes ficava `unknown` e deixava o status geral sempre degradado.
- Opt-out: o webhook Meta desmarcava o opt-in dos devedores por telefone; no Datafy o opt-out já é tratado por supressão global do destinatário (etapa 3), que bloqueia envios de todas as empresas.

## Entregas

- Backend: `DatafyTransport` único (a base Graph abstrata e `MetaDirectTransport` foram removidas); `WhatsappTransportModule` sempre cria Datafy; `WebhooksService` só com Efí; rotas `GET/POST /webhooks/meta`, `POST /whatsapp/meta`, `POST /whatsapp/instance`, `GET /whatsapp/status` e `POST /whatsapp/disconnect` removidas; `ConfigureMetaWhatsappDto` e o campo `meta` / `metaAccessToken` dos DTOs de clientes admin removidos (já eram recusados); `AdminModule` não depende mais de `WhatsappModule`; `recordInteraction`, `updateTierFromWebhook` e `handleInboundMessage` (inbox legada por telefone) removidos; indicador `WhatsappHealthIndicator`; worker de cobrança verifica só a configuração Datafy.
- Frontend: página e item de menu do WhatsApp removidos, métodos `configureMetaWhatsapp`, `getWhatsappStatus` e `disconnectWhatsapp` e tipos Meta removidos do cliente HTTP; texto do opt-in do devedor.
- Testes: validação de ambiente Datafy-only, transporte único, consumo por mensagens, health; harness e e2e sem Meta (reentrega Datafy com novo delivery id, `/webhooks/meta` responde 404, todos os envios pela origem Datafy, nenhuma intenção fora de `DATAFY`).
- Docs: `AGENTS.md` (arquitetura, variáveis e webhooks; referências à Evolution API removidas), `.env.example`, `infra/interserver/api.env.example`, `transport/README.md`, `api-cobranca/README.md`, `infra/interserver/DATAFY.md`.

## Verificação

- Backend: 84 suítes / 553 testes; ESLint sem erros em `src` e testes `.ts`; `nest build` sem erros; tipagem sem erros novos (os erros antigos de specs continuam os mesmos).
- E2E Datafy em infraestrutura descartável: 11/11. `communications-postgres.cjs` (33 migrations, webhook, envio, conversas, mídia): PASS.
- Frontend: 35 suítes / 123 testes; `tsc`, lint (1 aviso antigo em `InvoiceTable.tsx`) e `next build` sem erros. Tipos gerados antigos em `.next/dev/types` (de 14/09, referenciando a página removida) foram apagados; o `next dev` os recria.
- Não verificado: token e webhook reais do Datafy (passos 1 e 9 do runbook).
