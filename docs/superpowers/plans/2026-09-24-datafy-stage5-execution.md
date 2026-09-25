# Execução da etapa 5 — atribuição e API de consulta por empresa

Plano: `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`, somente etapa 5.

## Decisões e interfaces

- Ruling: continuar no checkout `dev`, preservando alterações locais; sem commit, deploy ou envio externo real. Frontend pertence à etapa 6; contratos existentes consumidos pela tela atual continuam compatíveis.
- Ruling (responsável, 24/09): implementar a infraestrutura completa de referência opaca para botões. Token emitido pelo servidor por mensagem/botão, persistido apenas como hash; resolução confere canal, destinatário e contexto antes de atribuir. `companyId`/texto do payload nunca são confiáveis. Nenhum template atual declara resposta rápida, então a emissão fica disponível sem uso até existir esse template.
- Ruling (responsável, 24/09): resposta administrativa por template com botão de pagamento exige contexto de cobrança; o link é gerado no momento da transmissão, igual à régua (o token de pagamento expira e não pode entrar no hash idempotente da intenção).
- Ruling (responsável, 24/09): avisos/lembretes Efí continuam com contexto da empresa e visíveis na projeção dela.
- Ruling: `context.id` só atribui quando a mensagem citada está persistida na mesma conversa (mesmo destinatário), no mesmo `transportChannelId` não nulo, e já possui empresa. Mensagens legadas sem canal comprovado não propagam contexto. O contexto herdado é revalidado (fatura/devedor da empresa e telefone do devedor = destinatário).
- Ruling: mudança de atribuição (manual ou chegada tardia do ID externo de um envio) reavalia, na mesma transação, as respostas que citam a mensagem e estão `UNASSIGNED`/`REPLY_CONTEXT`, com auditoria `SYSTEM`. Atribuições `MANUAL` e `INTERACTIVE_CONTEXT` dependentes não são sobrescritas. Não há propagação para a conversa inteira.
- Ruling: resposta administrativa com contexto de empresa não passa pela checagem de elegibilidade da régua (fatura paga continua podendo ser respondida), não gera `CollectionLog` nem consome a cota comercial da empresa; a cota do número compartilhado continua valendo.
- Ruling: projeções da empresa são calculadas na leitura a partir das mensagens autorizadas; não há cache a invalidar. Cursores são opacos, assinados com HMAC (chave derivada de `JWT_SECRET` com separação de domínio) e vinculados a usuário, empresa, rota, conversa e filtros.
- Ruling: mensagem de entrada classificada manualmente como "sem empresa" (`MANUAL` com contexto nulo) deixa de contar como pendente de classificação; `UNASSIGNED` e linhas legadas sem método continuam pendentes.

## Checklist

- [x] Resolução por `context.id` e referência opaca na ingestão (Datafy e Meta direta); reavaliação de dependentes.
- [x] Atribuição manual transacional e auditada com `expectedRevision`.
- [x] API da empresa: conversas e mensagens com cursor, sem dados de outras empresas.
- [x] Rotas administrativas: filtros, paginação de mensagens, resposta com contexto/citação e resposta por template.
- [x] Testes de serviço, controller e PostgreSQL real (fixture A/B, ataques por ID/cursor, concorrência).

## Contratos

| Rota | Acesso | Comportamento |
| --- | --- | --- |
| `GET /communications/conversations?cursor&limit&channel` | Empresa da sessão | Conversas com ao menos uma mensagem da empresa. `contact` vem do devedor da própria empresa ou do destinatário; prévia, contagem e última atividade calculadas só sobre mensagens visíveis. `{items, nextCursor}`, limite 1–100, padrão 25. |
| `GET /communications/conversations/:id/messages?cursor&limit` | Empresa da sessão | Mensagens da empresa, mais novas primeiro. Citação só aparece se a mensagem citada também for da empresa. Sem IDs externos, status global, não lidas ou dados de outras empresas. 404 se não houver mensagem visível, inclusive com cursor antigo. |
| `GET /communications/admin/conversations` | Admin | Filtros `companyId`, `invoiceId`, `status`, `pendingClassification`, `channel`; cada item traz `unclassifiedCount`. Paginação por página mantida para a tela atual. |
| `GET /communications/admin/conversations/:id?cursor&limit` | Admin | Página mais recente (padrão 50) em ordem cronológica, com empresa, cobrança, devedor, método/revisão de atribuição, estado da intenção, anexos e `replyToMessageId`; `nextCursor` carrega as anteriores. |
| `PATCH /communications/admin/messages/:id/attribution` | Admin | `{expectedRevision, context:{companyId\|null, invoiceId?, debtorId?}, reason}`. 400 contexto inválido, 403 papel sem admin (reconferido no banco), 409 revisão desatualizada ou mensagem de envio (contexto imutável). |
| `POST /communications/admin/conversations/:id/replies` | Admin | Mantém `idempotencyId`; acrescenta `context` e `replyToMessageId` (somente WhatsApp, mesma conversa e canal). Sem contexto a resposta fica só no admin. Mesmo ID com outro conteúdo/contexto → 409. |
| `POST /communications/admin/conversations/:id/template-replies` | Admin | `{idempotencyId, templateId, parameters[], context?}`. Template global aprovado e sem revisão, parâmetros posicionais conferidos; botão de pagamento exige cobrança. Mesmo controle de intenção. |

## Entregas

- `reply-attribution.ts`: resolução na ingestão por referência opaca (primeiro) e por `context.id`, com revalidação do contexto; reavaliação de respostas dependentes com auditoria `SYSTEM`, sem sobrescrever decisões manuais. Chamado pelo webhook Datafy, pelo webhook Meta, pela atribuição manual e pela aceitação de envios.
- `CommunicationTokenService`: cursores HMAC com escopo e tokens de botão determinísticos (`cfm1.<43>`), armazenados só como SHA-256 em `CommunicationInteractiveReference`. A referência é gravada antes da transmissão.
- Dispatcher: origem `ADMIN_REPLY` (sem elegibilidade da régua, `CollectionLog`, `MessagingUsage` ou cota comercial da empresa), citação `context.message_id`, link de pagamento gerado na transmissão e botões de resposta rápida apenas se o template aprovado os declarar como `QUICK_REPLY`.
- Migration aditiva `20260924210000_datafy_tenant_attribution`: tabela `CommunicationInteractiveReference` e índice de classificação por conversa. Aplicada apenas nos bancos descartáveis.

## Como validar

No diretório `api-cobranca`, com Docker Desktop Linux:

```powershell
npm run prisma:generate
npm test -- --runInBand
npm run test:communications:postgres
npx eslint src/common src/whatsapp src/communications src/queue src/templates src/webhooks src/health src/config
npm run build
```

`test/tenant-conversations-postgres.cjs` roda sobre o PostgreSQL descartável do harness de comunicações, com transporte simulado e webhooks assinados com segredo sintético.

## Verificação

- Harness PostgreSQL 16 (32 migrations): fixture do plano (contato P com saída A, saída B, resposta citando A, resposta citando B e entrada sem referência) → A vê só seu par, B só o seu, admin vê as cinco; conteúdo, prévia, contato, citação e contagem sem dados da outra empresa; paginação completa sem duplicatas; cursor de outra empresa/usuário/filtro → 400; conversa estranha, empresa sem mensagens ou ID inexistente → 404; leitura da empresa não altera status, não lidas ou prévia globais; token de botão resolvido só para o contato de origem, payload forjado ignorado; resposta recebida antes da aceitação atribuída após o commit do ID externo; atribuição manual com 400/403/409, auditoria, corrida com um único vencedor e reavaliação de dependentes preservando decisão manual; resposta da plataforma com contexto visível só para a empresa, citação preservada, fatura paga respondível, sem `CollectionLog`; contexto cruzado recusado antes de persistir.
- Mutação de controle: removido temporariamente o filtro `companyId` da consulta de mensagens da empresa → a fixture A/B falhou; filtro restaurado e harness verde.
- Suíte geral: 81 suítes / 498 testes. Build do backend passou. ESLint sem erros nos módulos acima. Os erros de tipagem pré-existentes em specs não alterados continuam os mesmos da etapa 4.
- Revisão: releitura do diff pelo implementador, seguida de `/code-review` (esforço alto) sobre as alterações das etapas 1–5. Os 10 achados foram corrigidos:
  - `pendingClassification=false` era lido como `true` pela conversão implícita do `ValidationPipe`: RED→GREEN com o pipe da aplicação.
  - Cursor da lista de conversas passou a usar o horário como texto UTC do banco; o harness percorre todas as páginas e confere o `max(createdAt)` exato.
  - Retry de resposta admin já reservada não é mais barrado pela janela encerrada.
  - Avisos/lembretes Efí usam série de tentativas (`attemptKey`): só uma rejeição definitiva libera nova chave; pendente, aceito ou incerto nunca.
  - Erros determinísticos na reserva de cota (registro inexistente, consulta inválida) falham em vez de repetir para sempre.
  - Reavaliação de dependentes percorre todos em lotes (teste com 105) e resolve a citação uma única vez.
  - Contagem de variáveis de template unificada em `templateVariableNames` (régua, dispatcher e resposta por template).
  - Projeção da empresa lê canal e contato numa única consulta.
  - Cliente Redis compartilhado por processo (`acquireRedis`/`releaseRedis`) para limites e cotas, com encerramento pelo último usuário.
  - Regras de envio por origem centralizadas em `dispatchPolicy`.
- Suíte após a revisão: todas as suítes passaram; harness PostgreSQL/Redis verde com os novos cenários (paginação multi-página, 105 dependentes, série de tentativas).

## Limitações e pendências

- Etapa 6: telas da empresa e do admin (a tela atual continua funcionando com os contratos antigos); liberação de templates em revisão; resolução de `UNCERTAIN`; remoção da inbox antiga.
- Nenhum template aprovado declara resposta rápida; a emissão de referências opacas está pronta, mas sem uso até o catálogo suportar esses botões (hoje a compatibilidade do template os marca para revisão).
- A listagem administrativa continua ordenada por `updatedAt` da conversa e paginada por página, para compatibilidade com a tela atual; a projeção da empresa não usa esses campos.
- Nada foi aplicado na VPS.

