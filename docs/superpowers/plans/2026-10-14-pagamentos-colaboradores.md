# Pagamentos a colaboradores — plano de desenvolvimento para revisão

> **Para execução por agente:** executar por tarefa, na ordem, com testes antes da implementação e um
> commit por tarefa. A tarefa 1 bloqueia as tarefas financeiras (7 e 8). Nenhuma chamada financeira
> real; homologação Efí só como ação operacional autorizada. Testes de banco e Redis só em
> infraestrutura descartável.

**Objetivo:** a empresa, com a funcionalidade liberada pelo admin, paga colaboradores por Pix a partir
da própria conta Efí, depois da aprovação registrada no WhatsApp do aprovador.

**Arquitetura:** módulo novo `api-cobranca/src/disbursements/`. Envio de Pix pela identidade emissora
do perfil financeiro ativo. Pedido de aprovação por template do catálogo com respostas rápidas
estáticas. Decisão lida das mensagens `button` já gravadas. Um worker `@Cron` faz a decisão, o envio,
a verificação e a expiração. O resultado chega pelo ramo novo do webhook Pix.

**Especificação:** [Pagamentos a colaboradores](../specs/2026-10-12-pagamentos-colaboradores-design.md).

## Restrições globais

- **Sem cálculo de folha.** Valores líquidos informados pela empresa.
- **Nenhum Pix sem aprovação válida.** Precisa ser decisão `APPROVED` gravada para o pedido atual,
  com o hash do lote igual ao hash do pedido.
- **Envio só pela conta emissora fotografada no pedido.** Conta mudou, item falha sem envio.
- **Envio em dúvida** (`UNCERTAIN`) nunca é reenviado automaticamente nem dado como falha sem prova.
- **Funcionalidade desligada:** 404 nas rotas da empresa, e o worker não envia.
- **Celular do aprovador** só pelo admin, com versões imutáveis.
- **Migrations aditivas.** Nada muda em cobranças, régua, Pix recebido ou split.
- **Logs** sem CPF, CNPJ, chave, conta, valor individual, telefone ou corpo de mensagem.
- **Erros de negócio** com `code` estável; edição concorrente com versão esperada e `409`.

## Foco da revisão

1. **Toque forjado ou fora de contexto.** Outro número, mensagem antiga, texto livre, lote editado
   depois do pedido, pedido expirado ou aprovador trocado: nenhum envio (tarefa 6).
2. **Duplicidade.** Toque repetido, webhook reentregue, dois ticks do worker ou duas instâncias:
   uma decisão e um `pixSend` por item (tarefas 6 e 7).
3. **Resposta perdida da Efí.** O item fica `UNCERTAIN`, é consultado pelo `idEnvio` e só muda com
   prova (tarefas 7 e 8).
4. **Isolamento entre empresas** em colaboradores, lotes, itens e comprovantes (tarefas 3 e 4).
5. **Webhook Pix existente.** Pix recebido continua igual, e Pix enviado não vira baixa de cobrança
   (tarefa 8).

## Mapa de arquivos

**Backend novo** (`api-cobranca/src/disbursements/`):

| Arquivo | Responsabilidade |
| --- | --- |
| `disbursements.module.ts` | Registro do módulo |
| `disbursement-settings.service.ts` | Liberação, versões, prontidão e desligamento |
| `disbursement-recipients.service.ts` | Cadastro e importação de colaboradores |
| `disbursement-batches.service.ts` | Lotes, itens, hash e novo lote a partir de falhas |
| `disbursement-approval.service.ts` | Pedido, decisão, expiração e avisos |
| `efi-disbursement.client.ts` | `pixSend`, consulta por `idEnvio`, saldo e comprovante, com respostas normalizadas |
| `disbursement-sender.service.ts` | Envio, verificação e conclusão do lote |
| `disbursement.worker.ts` | `@Cron` a cada 30 s |
| `disbursements.controller.ts` | Rotas da empresa |
| `disbursements-admin.controller.ts` | Rotas do admin |
| `dto/*.ts` | DTOs |
| `disbursement-reasons.ts` | Códigos da Efí → motivo em PT-BR |
| specs | Testes de cada serviço |

**Backend alterado:**

- `prisma/schema.prisma` e migration `add_employee_disbursements`.
- `src/types/sdk-node-apis-efi.d.ts`: tipos dos métodos usados.
- `src/payment/efi.service.ts`: ramo `SOLICITACAO` no webhook Pix.
- `src/templates/template-contracts.ts`, `template-context.service.ts` e `template-renderer.ts`:
  finalidades, origem, fontes e botões de decisão.
- `src/app.module.ts`.
- Teste novo `test/disbursements.e2e-spec.ts` e script `test:e2e:disbursements`.

**Frontend:**

- Painel admin `src/components/features/financial-activation/DisbursementSettings.tsx`, ao lado de
  `CardPaymentSettings.tsx`.
- Rota da empresa `src/app/(dashboard)/pagamentos-colaboradores/`.
- Item condicional em `src/components/ui/Sidebar.tsx`.
- Tipos e listas de `src/components/features/templates/types.ts`.
- Métodos em `src/lib/api-client.ts`.

**Documentação:**

- Runbook `docs/operations/pagamentos-colaboradores.md`.
- Tabela de módulos do `AGENTS.md`.

## Tarefa 1 — validar a Efí em homologação

**Criar:** `docs/implementation/efi-disbursement-validation.md`, com cenários, respostas resumidas e
conclusões, sem credenciais nem dados pessoais.

- [ ] Confirmar o formato aceito de `idEnvio`; proposta: id do item sem hífens (32 caracteres).
- [ ] Enviar por chave com `favorecido.cpf`, por chave com `favorecido.cnpj` e por `contaBanco`.
  Registrar o formato de `codigoBanco`, `agencia`, `conta` e `tipoConta`.
- [ ] Capturar o payload real do webhook de envio na URL atual (`/webhooks/efi/pix?ignorar=`):
  `REALIZADO`, `NAO_REALIZADO` e devoluções simuladas (R$ 4,00 e R$ 5,00). Conferir qual chave vem
  em `chave`.
- [ ] Registrar as respostas de `pixSend` para 400, 403 (escopo ausente), 404, 409
  `id_envio_duplicado`, 422 e 429 (`Retry-After`), além de `pixSendDetailId` para id inexistente.
- [ ] Verificar se o token OAuth informa os escopos concedidos (`pix.send`) e o nome do escopo de
  saldo. Se não informar, o admin confirma manualmente na liberação.
- [ ] Registrar o formato de `getAccountBalance` e de `pixGetReceipt`.
- [ ] Commit documental.

## Tarefa 2 — schema e configuração do admin

**Modificar:** `prisma/schema.prisma`. **Criar:** migration `add_employee_disbursements`, módulo,
`disbursement-settings.service.ts`, `disbursements-admin.controller.ts` e DTOs.

**Modelos:**

- `DisbursementSettings`: `companyId`, `version`, `enabled`, `approverName`, `approverPhone`,
  `changedByUserId`, `createdAt`. Uma linha por versão, sem update; vale a de maior `version`.
- `DisbursementRecipient`: `companyId`, `name`, `documentType` (`CPF`/`CNPJ`), `document`,
  `pixKey?`, `bankIspb?`, `bankAgency?`, `bankAccount?`, `bankAccountType?`, `active`, `version`.
  Único por `[companyId, document]`.
- `DisbursementBatch`: `companyId`, `reference`, `status`, `totalCents`, `itemCount`,
  `contentHash?`, `issuerIdentityId?`, `currentApprovalId?`, `version`, `createdByUserId`.
- `DisbursementItem`: `batchId`, `companyId`, `recipientId`, foto do favorecido, `amountCents`,
  `status`, `idEnvio` único, `e2eId?`, `failureCode?`, `failureReason?`, `sentAt?`, `settledAt?`.
  Único por `[batchId, recipientId]`.
- `DisbursementApproval`: `batchId`, `companyId`, `requestNumber`, `contentHash`,
  `settingsVersion`, `approverPhoneHash`, `approveLabel`, `rejectLabel`, `intentId?`, `expiresAt`,
  `state` (`AWAITING`/`APPROVED`/`REJECTED`/`EXPIRED`/`INVALIDATED`/`HELD`), `decidedAt?`,
  `decisionMessageId?`, `decisionExternalMessageId?`, `requestedByUserId`, `ackSentAt?`,
  `noticeSentAt?`.

**Rotas** (`JwtAuthGuard` + `PlatformAdminGuard`):

- `GET /admin/disbursements/:companyId/settings`: versão atual, histórico e prontidão.
- `POST /admin/disbursements/:companyId/settings` (`expectedVersion`).

**Prontidão para ligar:**

- perfil financeiro ativo em Fase A, com identidade da empresa, credencial `ACTIVE` não vencida e
  `pixKey`;
- as três finalidades resolvidas pela política de templates;
- botões de decisão mapeados (tarefa 5).

**Desligar** cancela, na mesma transação: lotes `AWAITING_APPROVAL` (pedido `INVALIDATED`) e itens
`PENDING`. Itens `SENDING`, `IN_PROCESSING` e `UNCERTAIN` continuam em verificação.

- [x] Testes: ligar sem prontidão gera 409 com o item faltante; versão divergente gera 409; nova
  versão não apaga a anterior; telefone inválido é recusado; desligar cancela só o que não foi
  enviado; usuário da empresa recebe 403 ou 404.
- [x] Implementar e aplicar a migration só em PostgreSQL descartável. Rodar specs e lint. Commit.

**Registro de execução (15/10/2026):**

- Migration `20261015120000_add_employee_disbursements` gerada por `prisma migrate diff` a partir do
  schema anterior. Só aditiva: 4 enums e 5 tabelas, sem alterar as existentes.
- Testes:
  - `disbursement-settings.service.spec.ts`: 8 testes;
  - `disbursements-admin.controller.spec.ts`: 6 testes (guardas do admin e formato do celular);
  - `test/disbursements.e2e-spec.ts` em PostgreSQL descartável: 4 testes (migration, prontidão,
    dois admins simultâneos, desligamento e item repetido);
  - suíte completa do backend: 123 suítes e 982 testes passando.
- Lint e build sem erros.

**Desvios do plano:**

- A prontidão de templates entra na tarefa 5, porque as finalidades ainda não existem.
- O lote guarda o contador `approvalRequests` em vez de `currentApprovalId`: o pedido atual é o de
  `requestNumber` igual ao contador, sem referência circular.
- O item nasce `PENDING`, sem estado de rascunho. Só são enviados itens de lote `PROCESSING`.
- A troca do celular do aprovador devolve a `DRAFT` os lotes aguardando aprovação e invalida o pedido.
  Desligar continua cancelando.
- O script se chama `test:e2e:disbursements`, no padrão dos demais testes que usam
  `e2e-disposable.cjs`.
- A validação do telefone no DTO só aceita celular brasileiro (`55` + DDD + número).

## Tarefa 3 — colaboradores

**Criar:** `disbursement-recipients.service.ts`, rotas em `disbursements.controller.ts`, DTOs.

**Rotas da empresa** (todas com 404 se desligada ou de outra empresa):

- `GET /disbursements/status`: sempre 200, com `{ enabled, approverName, approverPhoneMasked }`.
- `GET /disbursements/recipients` e `POST /disbursements/recipients`.
- `PUT /disbursements/recipients/:id` (`expectedVersion`).
- `POST /disbursements/recipients/import`: até 500 linhas, numa transação, com erro por linha e sem
  gravação parcial.

**Validação:** CPF e CNPJ com dígito verificador (reutilizar helper existente, se houver). Exatamente
um destino: chave Pix (CPF, CNPJ, e-mail, telefone `+55` ou aleatória) ou dados bancários completos.

- [x] Testes: isolamento A/B (lista, edição e importação); documento duplicado gera 409; importação
  com uma linha inválida não grava nada; funcionalidade desligada gera 404. "Desativado não entra em
  lote novo" é regra do lote e passa para a tarefa 4.
- [x] Implementar. Rodar specs e lint. Commit.

**Registro de execução (15/10/2026):**

- Regras em `disbursement-recipient-rules.ts`, reutilizando `common/debtor-document.ts` para CPF e
  CNPJ.
- Testes:
  - unitários do módulo: 44 (regras 19, serviço 6, controller 2 e configuração ampliada com status e
    404);
  - `test/disbursements.e2e-spec.ts` em PostgreSQL descartável: 9 (4 da tarefa 2 e 5 novos: mesma
    pessoa em duas empresas, edição por outra empresa gera 404, documento duplicado gera 409,
    importação tudo ou nada sem tocar outra empresa, duas edições simultâneas com 409, empresa sem a
    funcionalidade);
  - suíte completa do backend: 126 suítes e 1.011 testes passando.
- Lint e build sem erros.

**Desvios e decisões:**

- A edição usa `PUT /disbursements/recipients/:id` com o cadastro completo, em vez de `PATCH`. A tela
  sempre envia o formulário inteiro, e trocar de chave para conta (ou o contrário) fica sem ambiguidade.
- Importação:
  - linha igual a um colaborador já cadastrado é ignorada e contada como `skipped`;
  - linha com o mesmo documento e outros dados é erro, para a planilha nunca trocar em silêncio onde
    alguém recebe;
  - documento repetido no arquivo também é erro.
- Chave Pix:
  - telefone exige `+55`, para não ser confundido com CPF;
  - chave CPF/CNPJ precisa ser o documento do próprio colaborador.
- Dados bancários: ISPB com 8 dígitos, agência com até 4 dígitos, conta só com números (com o dígito)
  e tipos `cacc`, `svgs`, `slry`, `tran`. Confirmar na homologação (tarefa 1).
- `GET /disbursements/status` mostra o celular mascarado (`(11) •••••-7777`), nunca o número.

## Tarefa 4 — lotes

**Criar:** `disbursement-batches.service.ts`, rotas e DTOs.

**Rotas:**

- `GET /disbursements/batches` (paginado) e `GET /disbursements/batches/:id`, com itens e motivos.
- `POST /disbursements/batches`: referência e itens `{ recipientId, amountCents }`.
- `PUT /disbursements/batches/:id`: só `DRAFT`, com `expectedVersion`.
- `POST /disbursements/batches/:id/cancel`: só `DRAFT` ou `AWAITING_APPROVAL`; o pedido vira
  `INVALIDATED`.
- `POST /disbursements/batches/:id/retry-failed`: novo `DRAFT` com os itens `FAILED` e os dados
  atuais do colaborador.

**Regras:**

- Itens de 1 a 500, sem colaborador repetido, valor maior que zero, total dentro de `Int`.
- Foto do favorecido gravada no item.
- `contentHash` = SHA-256 de referência, conta emissora, total e itens ordenados (destino, documento
  e valor).

- [x] Testes: isolamento A/B; lote fora de `DRAFT` gera 409 na edição; colaborador repetido; hash
  estável na ordem e diferente com qualquer valor alterado; `retry-failed` só com itens `FAILED`.
- [x] Implementar. Rodar specs e lint. Commit.

**Registro de execução (16/10/2026):**

- Serviço `disbursement-batches.service.ts`; `batchContentHash` e `itemSnapshot` ficam exportados
  para a tarefa 6.
- Testes:
  - unitários do módulo: 55 (11 novos: hash e validação dos itens; controller ampliado);
  - PostgreSQL descartável: 16 (7 novos):
    - foto do favorecido não muda com edição posterior do colaborador;
    - outra empresa não vê nem usa lote ou colaborador (404);
    - duas edições simultâneas: 1 vence, 1 recebe 409;
    - lote aguardando aprovação não é editável, e cancelar invalida o pedido;
    - lote em envio não é cancelável;
    - duplo clique em "novo lote com falhas" gera um rascunho, e após um reenvio pago não há segundo;
    - reenvio cancelado libera outro;
  - suíte completa do backend: 127 suítes e 1.023 testes passando.
- Lint e build sem erros.

**Desvios e decisões:**

- **Coluna `retryOfBatchId`:** entrou na migration da tarefa 2, ainda não publicada, em vez de criar
  uma segunda migration.
- **"Novo lote com os itens que falharam":**
  - só a partir de lote `COMPLETED_WITH_FAILURES`;
  - usa os dados atuais do colaborador e deixa de fora os desativados (`skippedInactive`);
  - com um reenvio do mesmo lote ainda aberto, devolve esse rascunho (duplo clique);
  - um reenvio que pode ter pago (`PROCESSING`, `COMPLETED`, `COMPLETED_WITH_FAILURES`) bloqueia
    outro com `BATCH_ALREADY_RETRIED`;
  - só reenvio cancelado, expirado ou recusado libera um novo.
- **Cancelar** não exige versão: a trava do lote e o status (`DRAFT` ou `AWAITING_APPROVAL`) bastam.
- **Itens:**
  - a edição do rascunho substitui todos os itens, com novos ids e `idEnvio` (nunca enviados);
  - colaborador desativado gera 409 `RECIPIENT_INACTIVE`;
  - colaborador de outra empresa gera 404.
- **Hash:** inclui destino, documento e valor de cada item, a referência, a conta emissora e o total.
  O nome do colaborador fica de fora: mudar o nome não muda para onde o dinheiro vai.
- **Para a tarefa 6:** ao pedir aprovação, refazer a foto de cada item com o cadastro atual (todos
  ativos; senão 409). Assim o aprovador autoriza o que está cadastrado naquele momento, e a partir
  dali tudo fica congelado.
- **Lotes iguais criados pela empresa:** sem alerta de duplicidade (decisão do usuário em
  16/10/2026). A proteção é só contra duplicação causada pelo sistema.

## Tarefa 5 — templates de pagamento

**Modificar:**

- `template-contracts.ts`: finalidades `DISBURSEMENT_APPROVAL`, `DISBURSEMENT_EXPIRED` e
  `DISBURSEMENT_FAILED`; origem `DISBURSEMENT`; `disbursementApprovalId` em `TemplateContext`;
  fontes `APPROVER_NAME`, `DISBURSEMENT_REFERENCE`, `DISBURSEMENT_COUNT`, `DISBURSEMENT_TOTAL`,
  `DISBURSEMENT_EXPIRES_AT`, `DISBURSEMENT_FAILURE_COUNT` e `DISBURSEMENT_FAILURES`;
  `decisionButtons?: { approve: number; reject: number }` em `TemplateMapping`.
- `template-context.service.ts`, `template-renderer.ts`, validação do mapeamento e tela de
  mapeamento no frontend.

**Regras:**

- O contexto carrega pedido e lote pelo `companyId`.
- O destinatário é o celular da versão de configuração do pedido. Os avisos usam o aprovador atual.
- `decisionButtons` aponta para dois botões `QUICK_REPLY` distintos do template.
- `DISBURSEMENT_FAILURES` fica numa linha, com limite de tamanho e "e mais N; veja no painel".
- Datas no fuso de São Paulo.
- Finalidades de pagamento não aparecem na régua (`COLLECTION_PURPOSES` inalterado).

- [x] Testes: renderização de cada fonte; contexto de outra empresa recusado; mapeamento com índice
  que não é resposta rápida recusado; régua e ativação inalteradas.
- [x] Implementar. Rodar specs de templates, `npm run test:template-catalog:postgres` e
  `npm run test:template-pending:postgres`. Commit.

**Registro de execução (16/10/2026):**

- Finalidades, fontes, origem `DISBURSEMENT` e `decisionButtons` no backend e no frontend.
- Enum `WhatsappTemplatePurpose` com três valores novos, na migration ainda não publicada.
  PostgreSQL 16 em produção aceita os três `ADD VALUE` na mesma migration.
- Prontidão da tarefa 2 completada: ligar exige os três padrões de template resolvidos para a
  empresa e o pedido de aprovação com os botões de decisão mapeados.
- Editor de mapeamento: escolha opcional de "Resposta que aprova" e "Resposta que recusa" quando o
  template tem duas respostas rápidas ou mais.
- Testes:
  - backend unitário: 127 suítes e 1.036 testes (novos em renderer, contexto e configuração);
  - PostgreSQL descartável:
    - `disbursements.e2e-spec.ts`: 16 (ligar sem templates recusado com motivo);
    - `test:template-catalog:postgres` e `test:template-pending:postgres`: todos passando;
    - `test:e2e:templates`: 5 suítes, 38 testes;
  - frontend:
    - templates: 34 testes (2 novos do editor);
    - suíte completa: 310 testes passando, mas `CardCheckout.test.tsx` não carrega porque
      `payment-token-efi` não está instalado no `node_modules` local (dependência do cartão já
      declarada no `package.json` e no lock);
    - `tsc` acusa só essa ausência.
- Lint do backend e do frontend (templates) e build do backend sem erros. Build do frontend não
  executado pela mesma dependência ausente.

**Desvios e decisões:**

- **`decisionButtons`:** aponta posições **entre as respostas rápidas** (`parsed.quickReplies`), não
  entre todos os botões. O parser só guarda os textos, e o toque é reconhecido pelo texto exato.
  `ParsedTemplate` não mudou.
- **Destinatário:** sempre o aprovador da versão mais recente da configuração. A troca de aprovador
  já invalida pedidos pendentes (tarefa 2), então pedido e avisos usam o mesmo celular.
- **Total:** sai formatado com "R$" (igual a `AMOUNT`). Os textos sugeridos na especificação foram
  corrigidos para não repetir o símbolo.
- **Lista de falhas:** limite de 600 caracteres, com o restante como "e mais N, veja no painel".
- **Para a tarefa 6:**
  - em `template-resume.service.ts`, uma pendência de pedido de aprovação (`origin: 'DISBURSEMENT'`,
    finalidade `DISBURSEMENT_APPROVAL`) deve ser encerrada, não retomada, quando o pedido não
    estiver mais `AWAITING`;
  - avisos de expiração e falha podem ser retomados normalmente.
- **Observado, fora do escopo:** o catálogo da empresa mostra todos os templates liberados a ela.
  A empresa poderia escolher um template de pagamento numa etapa da régua. O envio ficaria pendente
  por falta de contexto (sem dano), mas a lista poderia esconder esses templates.

## Tarefa 6 — pedido de aprovação, decisão e expiração

**Criar:** `disbursement-approval.service.ts` e a parte de decisão e expiração do worker.

**Pedido** (`POST /disbursements/batches/:id/request-approval`, `expectedVersion`):

1. Numa transação com o lote travado:
   - exige `DRAFT`, funcionalidade ligada e prontidão;
   - fotografa a conta emissora;
   - calcula o hash;
   - cria `DisbursementApproval` (`AWAITING`, 24 h, rótulos dos botões do template fixado);
   - move o lote para `AWAITING_APPROVAL`.
2. `prepare` com logicalKey `disbursement-approval:<approvalId>`.
3. `dispatchIntent`.

Template retido ou recusa definitiva marcam o pedido `HELD`, devolvem o lote a `DRAFT` e respondem 409
`DISBURSEMENT_APPROVAL_NOT_SENT`. Resultado incerto mantém o pedido aguardando.

**Decisão:** a cada tick, para pedidos `AWAITING`, procurar `CommunicationMessage` com:

- `direction INBOUND` e `messageType 'button'`;
- `replyToExternalMessageId` igual ao `externalMessageId` da mensagem do pedido;
- mesma conversa e canal;
- `providerTimestamp` anterior a `expiresAt`;
- `content` igual a `approveLabel` ou `rejectLabel`.

Decidir numa transação com o lote travado, gravando só se o pedido ainda estiver `AWAITING`, se for o
atual do lote, se o hash for igual, se a funcionalidade estiver ligada e se o celular do pedido for o
do aprovador atual. Aprovar move o lote para `PROCESSING` (os itens já estão `PENDING`); recusar move
o lote para `REJECTED` e os itens para `CANCELED`. Vale a primeira resposta válida. Ordem de trava:
empresa e depois lote, a mesma da configuração do admin, para evitar deadlock.

**Confirmação ao aprovador:** texto livre pelo `OutboundDispatcherService` (janela de 24 h aberta
pelo toque), com chave `disbursement-ack:<approvalId>`. Toque em pedido expirado, invalidado ou já
decidido recebe uma única resposta de "pedido não vale mais".

**Expiração:** pedido `AWAITING` vencido vira `EXPIRED`, e o lote também. Template
`DISBURSEMENT_EXPIRED` com chave `disbursement-expired:<approvalId>`.

- [x] Testes de recusa (nenhum envio):
  - outra conversa;
  - mensagem `text` com "Aprovar pagamento";
  - citação de pedido anterior;
  - rótulo diferente;
  - toque depois de `expiresAt`;
  - lote editado ou cancelado;
  - aprovador trocado;
  - funcionalidade desligada.
- [x] Testes de aceitação: toque duplo e dois ticks concorrentes geram uma decisão e uma confirmação;
  expiração gera um aviso; template retido devolve o lote a `DRAFT`.
- [x] Implementar. Concorrência em `test/disbursements.e2e-spec.ts` (PostgreSQL descartável). Commit.

**Registro de execução (16/10/2026):**

- `disbursement-approval.service.ts`, `disbursement.worker.ts` (`@Cron` a cada 30 s) e rota
  `POST /disbursements/batches/:id/request-approval`.
- **Ordem de cada tick:** decisão, expiração, pedido perdido, confirmação, aviso de expiração.
  Decidir antes de expirar garante que um toque feito a tempo nunca é expirado.
- Testes no PostgreSQL descartável, com transporte simulado: 31 em `disbursements.e2e-spec.ts`
  (13 novos de aprovação, além dos casos da lista acima):
  - foto refeita ao pedir;
  - outra empresa, versão antiga e colaborador desativado;
  - template retido e envio recusado voltam a rascunho; espera de limite mantém o pedido;
  - aprovar e recusar com uma confirmação;
  - número sem o nono dígito aceito;
  - lote alterado por trás do pedido não paga;
  - expiração com um aviso;
  - pedido sem mensagem volta a rascunho.

  Mais um caso em `template-resume.e2e-spec.ts`: pendência de pedido que não vale mais é encerrada.
- Também rodados e passando: templates de ponta a ponta (4 suítes, 34 testes), catálogo e pendências
  de templates em PostgreSQL, suíte unitária completa (127 suítes, 1.036 testes), lint, tipos e build.

**Defeito encontrado e corrigido:**

- O banco só aceitava pendências de template com origem `COLLECTION`, `ADMIN_REPLY` ou `ACTIVATION`
  (`WhatsappTemplatePendingSend_origin_check`). Um pedido de aprovação retido daria erro 500 em vez de
  virar pendência para o admin.
- Correção na migration nova `20261016120000_disbursement_template_pending_origin`, que amplia a
  regra para `DISBURSEMENT`. As linhas existentes continuam válidas. Ficou separada da migration
  gerada pelo Prisma, porque o Prisma não conhece regras `CHECK`.

**Desvios e decisões:**

- **Validação do toque:**
  - citação da mensagem do pedido, mesmo canal e celular do aprovador da versão de configuração do
    pedido, em vez de "mesma conversa";
  - o celular é aceito com ou sem o nono dígito. O WhatsApp devolve alguns números brasileiros antigos
    sem ele, e o toque cairia em outra conversa, deixando o pedido expirar à toa;
  - a confirmação vai para a conversa de onde veio o toque.
- **Rótulos dos botões:** vêm do template resolvido no pedido. Se o admin trocar o mapeamento
  exatamente entre o pedido e o envio, nenhum toque corresponde, e o pedido expira com o aviso de
  pagamento manual. Nada é pago por engano.
- **Folgas de tempo:**
  - expiração com 2 minutos de folga, para um toque feito antes do prazo e entregue depois pelo
    webhook;
  - pedido sem mensagem preparada (processo perdido no meio) volta a `DRAFT` após 5 minutos.
- **Resultado do envio do pedido:**
  - aguardando limite do canal ou incerto: o pedido continua aberto, porque ainda pode chegar;
  - recusa definitiva ou template retido: `HELD`, e o lote volta a `DRAFT` com 409
    `DISBURSEMENT_APPROVAL_NOT_SENT`.
- **Confirmação:** texto livre via `WhatsappService.enqueueAdminReply`, uma por pedido
  (`ackSentAt` e chave `disbursement-ack:<id>`). É mensagem da plataforma, sem contar uso comercial
  da empresa.
- **Empresa sem prontidão:** recebe "temporariamente indisponível" sem o detalhe técnico. O admin vê
  o detalhe na configuração.

## Tarefa 7 — envio Pix

**Criar:** `efi-disbursement.client.ts`, `disbursement-sender.service.ts`, `disbursement-reasons.ts`
e a parte de envio do worker. **Modificar:** `src/types/sdk-node-apis-efi.d.ts`.

**Cliente Efí:** SDK com certificado da credencial `ACTIVE` da identidade fotografada (padrão
`EfiService.accountForIdentity` e `EfiGatewayClient`). Valor em texto `"123.45"`.
`pagador.chave` = `pixKey` da identidade; `infoPagador` = referência cortada. `favorecido` = chave e
documento, ou `contaBanco`.

**Envio do lote `PROCESSING`:**

1. Conferir que a identidade ativa é a fotografada. Se não for, todos os itens `PENDING` ficam
   `FAILED` com `ISSUER_CHANGED`.
2. Antes do primeiro item, consultar o saldo. Se não cobrir o total, todos ficam `FAILED` com
   `INSUFFICIENT_BALANCE` e os valores no motivo.
3. Por item, em sequência:
   - reservar `PENDING` → `SENDING` com update condicional;
   - chamar `pixSend`, sem transação aberta.

**Resultados do `pixSend`:**

| Resposta | Item | Observação |
| --- | --- | --- |
| 201 | `IN_PROCESSING` | Com `e2eId` |
| 400, 403, 404 ou 422 | `FAILED` | Motivo traduzido; nada debitado |
| 409 `id_envio_duplicado` | `UNCERTAIN` | |
| 429 | Volta a `PENDING` | Pausa o lote até `Retry-After` |
| 5xx, timeout ou rede | `UNCERTAIN` | |
| `SENDING` há mais de 2 min | `UNCERTAIN` | |

**Verificação de `UNCERTAIN`:** `pixSendDetailId` a cada tick, com recuo. `REALIZADO` vira `PAID`;
`NAO_REALIZADO` vira `FAILED`; não encontrado continua `UNCERTAIN`. Rota admin
`POST /admin/disbursements/:companyId/items/:itemId/reconcile` só consulta. Marcar como não processado
exige ação explícita do admin, mais de 24 h sem registro na Efí e auditoria.

**Comprovante:** `GET /disbursements/items/:id/receipt` (só `PAID`, isolado por empresa), via
`pixGetReceipt`.

- [ ] Testes: cada linha da tabela; identidade trocada; saldo insuficiente (nenhum `pixSend`); worker
  desligado no meio (itens restantes `CANCELED`); duas instâncias geram um `pixSend` por item;
  nenhum dado pessoal em log.
- [ ] Implementar. Specs, e2e descartável e lint. Commit.

## Tarefa 8 — webhook de Pix enviado e conclusão do lote

**Modificar:** `src/payment/efi.service.ts` (`handlePixWebhook` e `extractPixEvents`) e
`disbursement-sender.service.ts`.

**Ramo novo:**

- Itens com `tipo === 'SOLICITACAO'` e `gnExtras.idEnvio` vão para
  `DisbursementSenderService.applySendResult`.
- `chave` precisa ser a `pixKey` da identidade fotografada; se não for, `recordWebhookAnomaly`.
- `idEnvio` desconhecido (envio feito fora do CifraMais na mesma conta) vira anomalia e responde 200.
- Transições monotônicas; reentrega é idempotente.
- `PAID` nunca volta. Devolução fica anomalia até a tarefa 1 definir o formato.

**Conclusão:** lote sem itens `PENDING`, `SENDING` ou `IN_PROCESSING` vira `COMPLETED` ou
`COMPLETED_WITH_FAILURES`. Com falhas, template `DISBURSEMENT_FAILED` com chave
`disbursement-failed:<batchId>`. Itens `UNCERTAIN` não entram na lista e aparecem no painel como "em
verificação — não pague manualmente".

- [ ] Testes: payload de cobrança Pix inalterado (specs atuais passando); `REALIZADO` e
  `NAO_REALIZADO` com motivo; reentrega; chave errada; `idEnvio` desconhecido; aviso enviado uma
  vez; lote sem falhas não envia aviso.
- [ ] Implementar. Rodar specs de `payment`, `webhooks` e `disbursements`. Commit.

## Tarefa 9 — telas

**Admin:**

- `DisbursementSettings.tsx`: prontidão com o que falta, aprovador, ligar/desligar com confirmação
  e histórico de versões.
- Lista de itens `UNCERTAIN` com "Consultar na Efí".

**Empresa** (`/pagamentos-colaboradores`; menu só com `GET /disbursements/status` `enabled`):

- **Colaboradores:** lista, cadastro e importação de planilha (CSV com documento, nome e chave),
  com pré-visualização e erro por linha.
- **Lotes:** lista e detalhe.
  - Criar lote digitando ou importando CSV (documento e valor).
  - "Pedir aprovação", com o nome e o celular mascarado do aprovador.
  - Situação de cada item em português e motivos.
  - "Novo lote com os itens que falharam" e comprovante.

Carregando, erro e vazio distintos; 409 recarrega; requisições antigas descartadas.

**Textos:** "Aguardando aprovação no WhatsApp de <nome> até <data>"; "Expirado: faça o pagamento
manualmente"; "Em verificação: não pague manualmente".

- [ ] Testes de componentes (estados, 409, importação com linha inválida, menu oculto quando
  desligado). `npm run lint`, `npx jest --runInBand` e `npm run build`. Commit.

## Tarefa 10 — documentação e fechamento

- [ ] Runbook `docs/operations/pagamentos-colaboradores.md`:
  - cliente inclui os escopos na aplicação Efí e aumenta o limite Pix;
  - admin valida as credenciais de novo;
  - admin cria, importa, mapeia (com botões de decisão), libera e define como padrão os três templates;
  - admin cadastra o aprovador e liga a funcionalidade;
  - admin trata itens em verificação e desliga a funcionalidade.
- [ ] `AGENTS.md`: módulo `disbursements/` na tabela e regra "nenhum Pix sem aprovação válida" na
  seção 4.2.
- [ ] Rodar tudo:
  - backend: `npm test -- --runInBand`, `npx eslint "src/**/*.ts" "test/**/*.ts"`, `npm run build`
    e e2e descartáveis afetados;
  - frontend: lint, jest e build.

  Registrar resultados e pendências: homologação, publicação, templates na Meta, CLT e tarifa Efí.
  Commit.
