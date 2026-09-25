# Execução da etapa 4 — envios, limites e templates

Plano: `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`, somente etapa 4.

## Decisões e interfaces

- Ruling: continuar no checkout `dev`, conforme pedido de implementação aqui e etapas anteriores; preservar todas as alterações locais. Sem commit, deploy ou envio externo real.
- Ruling: catálogo e canal são globais por contrato aprovado; consultas de domínio comercial continuam com companyId. A regra genérica da skill NestJS não transforma o catálogo compartilhado em catálogo de tenant.
- Interface etapas 2/4: reserva já persiste contexto validado e mensagem; acrescentar claim, recuperação e resultado com compare-and-set, sem apagar/recriar intenções.
- Interface etapas 3/4: status antecipado continua durável e concilia após o ID externo; eventos de template passam a atualizar catálogo, sem atribuir tenant.
- Ruling: documentação pública consultada em 24/09 agora informa 4.800 envios/min e 6.000 downloads/min. Manter 500/60/60 do plano como limites locais conservadores; nenhum aumento automático. Demais operações, inclusive mídia, usam categoria de consultas.
- Ruling: 60 jobs/s é teto técnico BullMQ; 60 mensagens/h por remetente e 20/h por destinatário são proteções locais existentes. Aplicar adicionalmente quota Datafy por hash do token, nunca por empresa, e não liberar envio na indisponibilidade do Redis.
- Ruling: mensagens incertas e claims expirados nunca são reenviados automaticamente. Falha local após aceitação exige triagem; não há troca automática de transporte.
- Ruling: respostas administrativas WhatsApp serão persistidas e enfileiradas; revalidar janela no worker. E-mail permanece no fluxo atual. Retenção não é estendida por retry.

Decisões do responsável em 24/09, na retomada:

- Ruling: liberação de `metaReviewRequired` pelo administrador fica para a etapa 6. Até lá, template marcado permanece bloqueado; nenhuma rota nova de liberação.
- Ruling: o envio pela inbox antiga (`POST /whatsapp/conversations/:id/reply`) é desativado com 410. Respostas saem apenas pela central de comunicações; a limpeza da tela antiga (`front-cobranca/src/app/(dashboard)/inbox`) fica para a etapa 6.
- Ruling: intenções `UNCERTAIN` ficam somente na listagem administrativa nesta etapa; resolução auditada pertence às etapas 5/6. Uma cobrança em `UNCERTAIN` continua bloqueada para aquela etapa da régua até a resolução.
- Ruling: chave idempotente passa a ser obrigatória em todo envio; a chave derivada do conteúdo foi removida, pois bloqueava para sempre uma segunda mensagem idêntica ao mesmo contato. Avisos/lembretes Efí usam chave por empresa e dia (padrão já usado no alerta Efí), sem alterar o fluxo Efí: uma nova tentativa do workflow reutiliza a intenção pendente em vez de duplicar o envio.

## Checklist

- [x] Limite Redis atômico no adaptador, espera 429 e testes de 6.000 intenções.
- [x] Ciclo de intenção, recuperação, triagem e todos os caminhos de envio.
- [x] Catálogo paginado, criação sem duplicação e eventos de template seguros.
- [x] PostgreSQL/Redis descartáveis, regressões, build/lint e revisão.

## Entregas

- `OutboundDispatcherService` concentra todos os envios WhatsApp: cobrança do worker, respostas administrativas enfileiradas, jobs `outbound-intent` recuperados e avisos Efí. `sendTextMessage` síncrono, `WhatsAppConversationService.sendReply` e o ramo WhatsApp de `deliverCentralReply` foram removidos por não terem mais uso seguro.
- Revalidação no worker imediatamente antes do transporte: transporte/número da intenção, canal pausado, supressão do destinatário, janela de atendimento para texto livre, template aprovado e sem revisão, parâmetros posicionais, preferência da empresa, fatura pendente e opt-in do devedor.
- Canal pausado e falha transitória de banco na reserva de quota mantêm a intenção `PENDING` (nada transmitido), em vez de `FAILED`. Rejeição definitiva de uma cobrança recuperada da fila registra `CollectionLog`/`CollectionAttempt` uma única vez.
- Commit de aceitação repetido até três vezes enquanto o lease é válido. Se o lease expirou durante a transmissão e a recuperação marcou `WORKER_LOST_AFTER_CLAIM`, a aceitação tardia do mesmo worker ainda grava o ID externo (`UNCERTAIN` → `ACCEPTED`); intenções incertas nunca são reclamadas por outro worker, então não há reenvio.
- Quotas: Datafy por hash do token (script Lua sobre `TIME` do Redis), destinatários únicos por 24 h do número compartilhado e da empresa com `pg_advisory_xact_lock`, remetente 60/h e destinatário 20/h com marcador por intenção. Conexão Redis preguiçosa compartilhada (`redisReady`) evita negações espúrias nas primeiras chamadas concorrentes após o boot.
- Conversa da central: resposta WhatsApp enfileirada atualiza status `IN_PROGRESS`, prévia administrativa e `unreadCount`, como antes, sem estender retenção.
- Documentação dos estados, limites (técnicos × proteção comercial) e templates em `api-cobranca/src/whatsapp/transport/README.md`.
- Migration `20260924180000_datafy_outbound_dispatch` (aditiva): lease/próxima tentativa/quota da intenção e estado de provedor dos templates. Aplicada apenas nos bancos descartáveis.

## Como validar

No diretório `api-cobranca`, com Docker Desktop Linux e imagens `postgres:16-alpine` e `redis:7-alpine`:

```powershell
npm run prisma:generate
npm test -- --runInBand
npm run test:communications:postgres
npx eslint src/common src/whatsapp src/communications src/queue src/templates src/webhooks src/health src/config
npm run build
```

`test/outbound-dispatch-postgres.cjs` é chamado pelo harness de comunicações sobre o mesmo PostgreSQL descartável e cria seu próprio Redis rotulado (`ciframais.dispatch-test`), removido ao final após conferir a etiqueta. Transporte simulado; nenhuma chamada externa.

## Verificação

- Base na retomada: 75 suítes / 446 testes e harness com 31 migrations passaram antes das alterações.
- Harness PostgreSQL 16 + Redis 7 (novos cenários): seis jobs concorrentes → uma transmissão; timeout → `UNCERTAIN` sem reenvio; aceitação externa com falha local persistente → `UNCERTAIN`; lease expirado com aceitação tardia → `ACCEPTED` com ID preservado; status do webhook recebido antes do retorno HTTP concilia depois da aceitação; efeitos de cobrança uma vez; fatura paga e janela fechada enquanto na fila → rejeição sem transmitir; Redis inacessível e canal pausado → `PENDING`, depois enviado uma vez; quota Datafy atômica entre dois processos, chave sem token; quota diária `TIER_50` do número compartilhado entre duas empresas, com espera em vez de falha e destinatário já reservado sem consumir nova vaga.
- RED→GREEN: fixture de quota concorrente falhou com `connect()` duplo do ioredis ("already connecting") antes de `redisReady`; comprovado isoladamente e corrigido.
- Suíte geral: 77 suítes / 457 testes passaram. Build do backend passou. ESLint sem erros nos módulos acima (formatação Prettier aplicada aos arquivos Datafy das etapas 1–4; os ajustes são só de formatação).
- Erros de tipagem pré-existentes (fora desta etapa) continuam em specs não alterados: `admin.service.spec`, `billing.service.spec`, `invoices.service.spec`, `webhooks.controller.spec` e `message.worker.spec`. Não afetam `nest build` nem a execução do Jest.
- Revisão: releitura do diff da etapa pelo implementador. Não houve revisão por agente independente nesta retomada; recomendada antes da etapa 5.

## Limitações e pendências para as próximas etapas

- Etapa 5/6: resolução auditada de `UNCERTAIN`; liberação de `metaReviewRequired`; remoção/adaptação da tela `/inbox` antiga, que agora recebe 410 ao responder.
- O teto de 60 mensagens/h do remetente vale para o número compartilhado inteiro e é o limite efetivo da plataforma. Não foi alterado; qualquer aumento deve ser decisão explícita.
- `MessagingUsage` legado entra na contagem diária do canal sem distinção de número; com um único número compartilhado o efeito é o esperado.
- A cobrança recuperada da fila que falha definitivamente não aciona o fallback de e-mail (o job original não está disponível); o fallback continua no caminho síncrono do worker.
- Nada foi aplicado na VPS. A migration e o código seguem para a etapa 8/9.
