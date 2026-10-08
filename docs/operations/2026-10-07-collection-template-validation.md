# Validação da régua de cobrança e dos templates — 07/10/2026

## Resultado

Validação local com Nest/HTTP/JWT, PostgreSQL 16 e Redis 7 descartáveis,
filas BullMQ e workers reais. Datafy e Resend foram simulados no `fetch`;
no e-mail, o SDK Resend executou a montagem real da requisição. As chamadas
financeiras externas foram simuladas. Nenhuma mensagem ou cobrança real foi enviada.

Foram corrigidas três falhas reproduzidas por testes antes da alteração do código.
As tarifas e regras financeiras de Pix/Bolix não foram alteradas.

| Verificação | Resultado |
| --- | --- |
| Backend completo | 121 suítes, 968 testes aprovados |
| Frontend completo | 56 suítes, 310 testes aprovados |
| Integrações de régua, templates, Datafy, cartão e emissão Pix/Bolix | 8 suítes, 68 testes aprovados |
| Comando oficial `npm run test:e2e:templates` após inclusão das regressões | 5 suítes, 38 testes aprovados (subconjunto dos 68) |
| Régua, catálogo, pendências, migração de e-mail, transição e comunicação em PostgreSQL | 6 runners aprovados; schema atual com 45 migrations |
| Build do backend | Aprovado (`npx nest build`) |
| TypeScript do frontend | Aprovado (`npx tsc --noEmit`) |
| ESLint dos arquivos alterados e `git diff --check` | Aprovados |
| Revisão independente das alterações | Nenhum achado acionável |

## Falhas reproduzidas e corrigidas

### Template de cartão ignorado na primeira mensagem

- **Gap encontrado:** a projeção Prisma de `loadInitialChargeInvoice` não incluía
  `cardTemplateId`, embora a API gravasse corretamente a escolha na régua.
- **Impacto:** uma fatura de cartão usava o template-base de Pix e ficava retida com
  `VALUE_MISSING`, mesmo com um template de cartão compatível configurado.
- **Proposta:** carregar o campo na mesma consulta dos demais templates por método.
- **Situação:** corrigido em
  [message.worker.ts](../../api-cobranca/src/queue/workers/message.worker.ts).
  O teste agora comprova envio do template correto, link público pagável, uma cobrança
  e uma mensagem; a etapa Inicial não é repetida pelo agendador.

### E-mail recusado pela fila

- **Gap encontrado:** `EmailQueueService` usava um `jobId` com separadores `:`,
  recusado pelo BullMQ instalado com `Custom Id cannot contain :`.
- **Impacto:** os envios iniciais e agendados falhavam antes de chegar ao worker de e-mail.
- **Proposta:** gerar um identificador SHA256 determinístico com empresa, fatura,
  etapa e destinatário, preservando a deduplicação.
- **Situação:** corrigido em
  [email.queue.ts](../../api-cobranca/src/email/email.queue.ts).
  Os testes exercitam `addJob` e `addBulk` em Redis real, envio e deduplicação.

### Modelo de e-mail desativado ainda enfileirado

- **Gap encontrado:** os produtores verificavam a existência do template, mas ignoravam
  o `isActive` da preferência da empresa.
- **Impacto:** desmarcar **Usar este modelo** no editor não impedia novos envios pela régua.
- **Proposta:** respeitar `isActive` antes de registrar a tentativa e enfileirar,
  mantendo a escolha da etapa e sem fallback para outro modelo.
- **Situação:** corrigido em `queueInitialEmail` e
  [BillingService](../../api-cobranca/src/billing/billing.service.ts).
  Os testes desativam o modelo pela API da empresa e comprovam ausência de tentativa
  e envio nos caminhos inicial e agendado.

## Cobertura do fluxo

| Cenário | Evidência |
| --- | --- |
| Escolha de template por método | Gravação/leitura HTTP da régua; Inicial e agendador escolhem o cartão; Pix/Bolix preservam seus templates |
| Link de cartão | O token enviado é resolvido pela API pública: fatura correta, `CREDIT_CARD`, `PAYABLE`; nenhum débito de cartão ao enviar aviso |
| Links de Pix/Bolix | Cobranças confirmadas com snapshot financeiro real e resposta Efí simulada; mensagem reutiliza a cobrança e o link é pagável |
| E-mail de cartão, Pix e Bolix | Modelo da etapa, assunto e variáveis renderizados, sem placeholders pendentes; envio inicial/agendado, inclusive concorrente |
| Dois canais | WhatsApp e e-mail cumprem suas etapas Inicial uma vez e compartilham a cobrança de cartão |
| Padrão de emissão | Sem etapa Inicial WhatsApp, usa somente o padrão EMISSION da empresa |
| Incompatibilidade | Template de Pix em cartão fica retido; não há fallback ou retomada automática |
| Autorização | Sem opt-in não envia; escolhas de outra empresa são recusadas; revogação de grant antes da transmissão bloqueia |
| Fatura encerrada | PAID/CANCELED antes do worker não geram cobrança nem aviso; retomada de pendência paga fecha sem enviar |
| Reexecução/concorrência | Uma tentativa por etapa; uma intenção por comunicação; sem duplicar cobrança ou envio |
| Retomada administrativa | Confirmação idempotente, perda de job recuperada; mudança de mapping/grant exige nova revisão |
| Resultado incerto | UNCERTAIN e aceitação tardia não são reenviados automaticamente |
| Tela da régua | Seleção e persistência do cartão, filtro de templates com Pix/boleto, aviso de grant e limpeza da escolha |

Os novos 16 casos estão em
[card-collection-templates.e2e-spec.ts](../../api-cobranca/test/card-collection-templates.e2e-spec.ts)
e integram `npm run test:e2e:templates`.

Na primeira rodada, `emission-template-selection.e2e-spec.ts` ainda esperava que um
template de Pix fosse incompatível apenas com BOLETO. A expectativa foi atualizada
para incluir CREDIT_CARD; a rodada final passou. A primeira execução unitária teve
33 falhas de infraestrutura por bloqueio de portas locais no sandbox, nas suítes
`financial-activation.controller`, `datafy-webhook.controller`, `whatsapp.integration`,
`whatsapp-stats.controller` e `datafy-body-parser`; a repetição com portas locais
permitidas passou nos 968 testes. Isso não exigiu alteração de produção.

## Reexecução

Em `api-cobranca`, com Docker local disponível:

```bash
npm test -- --runInBand
npm run test:e2e:templates
node test/e2e-disposable.cjs datafy-communications.e2e-spec.ts card-checkout.e2e-spec.ts payment-issuance-recovery.e2e-spec.ts
npm run test:collection-rules:postgres
npm run test:template-catalog:postgres
npm run test:template-pending:postgres
npm run test:template-email-migration:postgres
npm run test:template-transition:postgres
npm run test:communications:postgres
npx nest build
```

Em `front-cobranca`:

```bash
npx jest --runInBand
npx tsc --noEmit
```

Os runners descartáveis substituem as variáveis de banco/fila e removem seus próprios
containers. Não executar as integrações diretamente contra um banco compartilhado.

## Publicação e limites

Não houve deploy, acesso à VPS ou consulta a dados de produção. A homologação real
de Efí/split, aprovação dos templates e entrega Datafy/Resend continua necessária;
respostas simuladas não comprovam entrega pelos provedores reais.

Se o erro antigo de enfileiramento de e-mail já ocorreu, conferir as tentativas EMAIL
em QUEUED sem job antes de publicar: no agendador, a tentativa pode ter sido gravada
antes de `addBulk` falhar. A correção não reenvia pendências antigas automaticamente.
Também não cancela e-mails que já estavam na fila antes de desativar o modelo.

**Alterações fora do pedido:** nenhuma ampliação funcional. As três correções foram
necessárias para o fluxo validado; sem mudança de schema, tarifas ou permissões.

## Revisão das opções da régua — 08/10/2026

A tela passa a oferecer **Pix, BOLIX e Cartão de crédito** para escolha de templates
por forma de pagamento. Boleto foi removido dos seletores e dos avisos de
incompatibilidade. Ao salvar, o payload omite `BOLETO`; a API preserva a configuração
legada, inclusive em etapas com tentativas registradas. Desmarcar a escolha por
método limpa também o template de cartão.

Os três cenários de regressão falharam antes da correção. A primeira repetição revelou
que o novo teste tentava salvar sem editar um template; o cenário foi corrigido para
selecionar o cartão antes de salvar. O build também identificou acesso sem
discriminar o canal em três asserções: elas passaram a conferir o payload por caminho,
respeitando o tipo `RuleStepInput`, sem alteração adicional no código de produção.

Revalidação: 968 testes de backend, 311 de frontend (14 da tela da régua), integração
de régua em PostgreSQL com 45 migrations, builds de API/Next com webpack e lint
aprovados. O lint completo do frontend mantém um aviso existente de `useReactTable`.
Revisão independente do delta sem achados acionáveis. Nenhuma mensagem real,
habilitação financeira, merge ou deploy realizado.

### Isolamento da suíte de capacidade do canal

Uma rodada ampliada, juntando as oito suítes anteriores à de capacidade do canal,
teve 69 testes aprovados e seis falhas por timeout nos fluxos de catálogo/retomada.
O banco descartável continha 277 intenções artificiais da suíte de capacidade em
`PENDING`, sem payload válido para transmissão; elas ocupavam os lotes de 100 da
recuperação. Os envios esperados não eram recuperados a tempo; a continuação dos
testes alterava as versões e produzia a retenção `TEMPLATE_VERSION_CHANGED`.

O comando oficial de templates passou nos 38 casos, e o catálogo isolado passou
nos seis. A reprodução mínima, capacidade seguida de catálogo no mesmo banco,
voltou a apresentar os três timeouts. A correção limita-se ao `afterAll` da suíte
de capacidade: remove as intenções pertencentes às duas empresas criadas pela
própria suíte antes de fechar a conexão. Nenhuma rotina de produção foi alterada.
O agrupamento separado de cartão, Datafy e recuperação de emissão passou em
30 casos.

Após a limpeza, a rodada ampliada final passou em **nove suítes, 75 testes**.
O lint da suíte alterada e a revisão independente do cleanup também passaram.
