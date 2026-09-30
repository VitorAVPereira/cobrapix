# Templates de emissão por régua e forma de pagamento — plano de implementação

> Para execução por agente: usar `superpowers:executing-plans` por tarefa. Este documento é planejamento; não autoriza envio real, emissão real nem execução em produção. Acompanhar os passos pelos checkboxes.

**Objetivo:** a primeira mensagem da cobrança, no WhatsApp e no e-mail, usar o template escolhido na etapa "Inicial" da régua do cliente, sem segundo envio pelo agendador, escolher automaticamente o template de Pix ou de BOLIX conforme a forma de pagamento da cobrança e aceitar o template BOLIX com os botões "Copiar código Pix", "Copiar código do boleto" e "Abrir link de pagamento".

**Arquitetura:** as etapas "Inicial" de WhatsApp e de e-mail passam a ser a primeira mensagem de cada canal, com a tentativa da etapa (`CollectionAttempt`) como trava contra um segundo envio. Cada etapa de WhatsApp ganha templates opcionais por forma de pagamento (`PIX`, `BOLETO`, `BOLIX`); sem escolha específica vale a escolha atual da etapa. O botão de boleto segue o mesmo desenho do botão Pix já entregue (commit `f278689`).

**Tecnologias:** NestJS, Prisma/PostgreSQL, BullMQ, Next.js, Jest, infraestrutura descartável (`test/e2e-disposable.cjs`).

## Decisões do responsável (30/09/2026)

| # | Decisão |
| --- | --- |
| D1 | A etapa "Inicial" de WhatsApp do perfil do cliente define o template da primeira mensagem e conta como enviada; o agendador não a repete. Perfil sem essa etapa continua no padrão "Emissão da cobrança" da empresa. |
| D2 | O template por forma de pagamento é escolhido **na etapa da régua**: cada etapa de WhatsApp pode ter um template para Pix, outro para Boleto e outro para BOLIX; o padrão é "o mesmo para todas". |
| D3 | O botão "Abrir link de pagamento" é um botão de link comum para `<FRONTEND_URL>/pagar/{{1}}` (página de pagamento CifraMais). Já é suportado; não usa o link da Efí. |
| D4 | O e-mail segue a regra da D1: a etapa "Inicial" de e-mail define o template do primeiro e-mail e conta como enviada; sem ela, vale o template de e-mail padrão usado hoje. |

## Diagnóstico (conferido no código em 30/09/2026)

**Problema 1 — emissão sempre com o primeiro template.** A primeira mensagem é preparada em `api-cobranca/src/queue/workers/message.worker.ts` (`prepareInitialWhatsapp`) sempre com `{ mode: 'DEFAULT', purpose: 'EMISSION' }`: o padrão de Emissão definido pelo admin em **Disponibilidade por empresa**. O perfil da régua do devedor não é lido. A etapa "Inicial" (dia -30 acumulado, exibida como "A partir de 30 dias antes do vencimento") só é executada pelo agendador das 9h/17h (`BillingService.queueBillingForCompany` → `CollectionRuleEngine.getNextStep`). Por isso:

- o template escolhido na régua para a emissão nunca vai na primeira mensagem;
- **hipótese a confirmar (F0):** para faturas que vencem em até 30 dias, o agendador envia a etapa Inicial depois da primeira mensagem. O devedor recebe duas mensagens de emissão, uma com cada template. Nenhum teste cobre essa combinação, e `collectionLogs` é carregado no agendador mas não é usado para evitar o segundo envio.

**Mesmo problema no e-mail.** O primeiro e-mail é montado em `message.worker.ts` com `findActiveOrDefault(companyId, null)` (template de e-mail padrão), sem ler a etapa Inicial de e-mail. O job não leva `ruleStepId` (chave `email:<empresa>:<fatura>:test:<e-mail>`) e não cria tentativa. O agendador depois envia a etapa Inicial de e-mail (`resolveForRule` com o `emailTemplateId` da etapa) para faturas que vencem em até 30 dias. Os perfis padrão têm essa etapa, então a duplicidade pode atingir todas as empresas que usam e-mail. O registro `EMAIL_QUEUED` só é gravado pela primeira cobrança e serve para reconhecer as faturas antigas.

**Problema 2 — Pix e BOLIX na mesma etapa.** A escolha da etapa é uma só (`templateId` ou padrão da finalidade), independente da forma de pagamento. Um template com botão de boleto usado numa cobrança Pix fica pendente (`VALUE_MISSING`); um template só de Pix numa cobrança BOLIX sai sem os dados do boleto.

**Dados da Efí para BOLIX** (já gravados na fatura por `PaymentChargeService`):

| Resposta Efí | Campo da fatura | Fonte do template |
| --- | --- | --- |
| `data.barcode` | `boletoLinhaDigitavel` | `BOLETO_LINE` |
| `data.pix.qrcode` | `efiPixCopiaECola` / `pixPayload` | `PIX_COPY_PASTE` |
| `data.billet_link` ou `data.link` | `boletoLink` | `BOLETO_LINK` |
| `data.pdf.charge` | `boletoPdf` | `BOLETO_PDF` |

**Limites da Meta para o template BOLIX:** o texto dos botões de pagamento é fixado pela Meta. O botão Pix aparece como "Copiar código Pix", não "Pagar via PIX"; o de boleto usa o texto da Meta para "Copy Boleto code". Até três botões de pagamento por mensagem, combináveis com botão de link e respostas rápidas. O código enviado no botão de boleto é a linha digitável só com números (47 dígitos); a Efí devolve com pontos e espaços. O WhatsApp não desativa o botão quando o código vence.

## Restrições globais

- Nunca trocar template automaticamente: sem template disponível para a forma de pagamento, a mensagem fica pendente com o motivo, como hoje.
- Reenviar mensagem nunca cria cobrança; nenhuma fase chama a Efí.
- `ACCEPTED`, `SENDING` e `UNCERTAIN` nunca são reenviados.
- Isolamento: templates por forma de pagamento só podem ser templates liberados à própria empresa; ID de outra empresa ou não liberado responde como hoje (400 na régua, pendência no envio).
- Migration só aditiva, testada em PostgreSQL descartável. Backend antes do frontend; backend novo com frontend antigo não pode apagar escolhas por forma de pagamento.
- Testes que escrevem em banco usam só a infraestrutura descartável. Provedores simulados.

## Pontos de revisão

1. Fatura emitida antes da mudança, com a primeira mensagem já enviada e a etapa Inicial ainda não executada → F1: o agendador não envia a Inicial.
2. Job inicial reentregue e agendador rodando ao mesmo tempo na mesma fatura → F1: a tentativa da etapa é a trava; uma única mensagem.
3. Cobrança substituída de BOLIX para Pix entre agendar e transmitir → F2: `CONTEXT_CHANGED` retém; na retomada o template é escolhido de novo pela forma atual.
4. Etapa Inicial com template de Pix, mas a empresa só emite BOLIX → F2/F3: a régua mostra que BOLIX usa o template base; se ele exige dados que BOLIX não tem, aviso na régua e pendência no envio, nunca troca.
5. Primeira cobrança automática desligada para o devedor → F1: nada muda; a Inicial continua indo pelo agendador a partir de 30 dias antes do vencimento.
6. Perfil com tentativas registradas → F2: a troca de templates por forma de pagamento é permitida no lugar, como a troca de template hoje.
7. Etapa Inicial de e-mail com template desativado → F6: o primeiro e-mail não sai e o motivo fica no histórico; nunca cai no template padrão (mesma regra do agendador).
8. Fatura com primeiro e-mail enviado antes da mudança → F6: o agendador reconhece o `EMAIL_QUEUED` e não envia a etapa Inicial de e-mail.
9. Devedor sem e-mail → F6: nada muda; a tentativa da etapa não é criada, como hoje.

## F0. Confirmar o diagnóstico em produção (somente leitura)

Não rodar nada na VPS sem pedido. As consultas abaixo não leem conteúdo de mensagem nem telefone; o responsável as executa ou autoriza a execução.

- [ ] Padrões da empresa e template usado em cada mensagem de uma fatura de teste:

```sql
SELECT d.purpose, t."metaTemplateName"
FROM "CompanyWhatsappTemplateDefault" d
LEFT JOIN "GlobalMessageTemplate" t ON t.id = d."templateId"
WHERE d."companyId" = '<empresa>';

SELECT i."logicalKey", i.state, i."createdAt", t."metaTemplateName"
FROM "CommunicationOutboundIntent" i
LEFT JOIN "GlobalMessageTemplate" t ON t.id = i."templateSnapshot"->>'templateId'
WHERE i."invoiceId" = '<fatura>'
ORDER BY i."createdAt";
```

- [ ] E-mails e tentativas da mesma fatura:

```sql
SELECT l."actionType", l.status, l."createdAt"
FROM "CollectionLog" l
WHERE l."invoiceId" = '<fatura>' AND l."actionType" LIKE 'EMAIL%'
ORDER BY l."createdAt";

SELECT a.channel, a.status, a."ruleStepId", a."createdAt"
FROM "CollectionAttempt" a
WHERE a."invoiceId" = '<fatura>'
ORDER BY a."createdAt";
```

- [ ] Esperado: `collection:<empresa>:<fatura>:initial:WHATSAPP` com o padrão de Emissão. Registrar se também existe `collection:<empresa>:<fatura>:<etapa>:WHATSAPP` com o template da régua (duplicidade confirmada) e quantas faturas pendentes estão nessa situação (contagem, sem dados pessoais). No e-mail, duplicidade é `EMAIL_QUEUED` seguido de tentativa `EMAIL` da etapa Inicial.
- [ ] Após publicar o botão Pix (`f278689`), sincronizar o catálogo e confirmar que `emissao_pix` aparece suportado (`supportReason` nulo). Se aparecer "tipo não informado", o Datafy não repassa `payment_setting` e F4 precisa ser revista antes de começar.

**Aceite:** fatos e hipóteses separados; a duplicidade é confirmada ou descartada com contagem.

## F1. Primeira mensagem pela etapa Inicial da régua

**Modificar:** `api-cobranca/src/queue/workers/message.worker.ts` (`prepareInitialWhatsapp`, `loadInitialChargeInvoice`), `api-cobranca/src/billing/collection-rule-engine.ts`, `api-cobranca/src/billing/billing.service.ts` (`queueBillingForCompany`), `api-cobranca/src/templates/template-selection.ts`. Testes: `message.worker.spec.ts`, `collection-rule-engine.spec.ts` (novo), `billing.service.spec.ts`, e2e novo `api-cobranca/test/emission-template-selection.e2e-spec.ts` (usa `test/support/template-e2e.ts`).

**Contrato proposto:**

- `EMISSION_SCHEDULE_DAY = -30` em `template-selection.ts`, usado por `purposeForScheduleDay` e pela régua; nenhum outro número mágico.
- `initialRuleStep(steps, channel)`: etapa ativa daquele canal cujo dia acumulado é `<= EMISSION_SCHEDULE_DAY`, ou `null`.
- Primeira mensagem: com etapa Inicial de WhatsApp, usa a seleção dela (F2 acrescenta a forma de pagamento) e envia `ruleStepId` no pedido; sem ela, `{ mode: 'DEFAULT', purpose: 'EMISSION' }`. A chave lógica continua `…:initial:WHATSAPP` (pendências antigas continuam válidas).

- [x] Testes que falham antes: perfil com Inicial `EXPLICIT` (template B) e padrão de Emissão = A → a primeira mensagem usa B; perfil sem Inicial → A; o agendador, depois da primeira mensagem, não prepara a Inicial; fatura antiga (primeira mensagem sem tentativa registrada) também não é repetida; job inicial e agendador concorrentes produzem uma intenção.
- [x] Carregar as etapas ativas do perfil do devedor em `loadInitialChargeInvoice` e resolver a Inicial.
- [x] Trava: antes de preparar, criar a tentativa `QUEUED` da etapa Inicial se ausente (mesma rotina `createQueuedAttempt` do agendador). Se já existir, o envio automático não prepara nada e registra o motivo no histórico; o envio selecionado manualmente (`source: 'SELECTED'`) continua sendo uma comunicação própria.
- [x] No agendador, considerar cumprida a etapa Inicial de WhatsApp quando já existe primeira mensagem da fatura (intenção com a chave `…:initial:WHATSAPP` em qualquer estado diferente de `FAILED`). Isso cobre as faturas emitidas antes da mudança sem escrever dados antigos.
- [x] A janela de horário da etapa Inicial não atrasa a primeira mensagem (comportamento atual da emissão). Registrar no relato se o responsável quiser outra regra.
- [x] Ajustar o texto da régua (`front-cobranca/src/app/(dashboard)/configuracoes/regua/page.tsx`): etapa Inicial "Na emissão da cobrança", com a observação de que, sem primeira cobrança automática, ela sai a partir de 30 dias antes do vencimento.
- [x] `npm test -- --runInBand collection-rule-engine billing.service message.worker` e o e2e novo. Commit sugerido: `fix: primeira mensagem segue a etapa inicial da regua`.

**Aceite:** a primeira mensagem usa o template da etapa Inicial; nenhuma fatura recebe duas mensagens de emissão; perfis sem Inicial não mudam.

## F2. Template por forma de pagamento na etapa (backend)

**Migration aditiva:** `api-cobranca/prisma/migrations/<timestamp>_rule_step_method_templates/migration.sql`: em `CollectionRuleStep`, colunas `pixTemplateId`, `boletoTemplateId`, `bolixTemplateId` (nulas, FK para `GlobalMessageTemplate` com `ON DELETE RESTRICT`), índices e CHECK que as mantém nulas em etapas de e-mail. Sem backfill: nulo significa "o mesmo da etapa".

**Modificar:** `schema.prisma`, `template-selection.ts` (`ruleStepSelection`), `collection-profile.service.ts` (`selectionColumns`, `validateSteps`, `presentSteps`, `updateSelectionsInPlace`), `billing.controller.ts` (`RuleStepDto`), `billing.service.ts`, `message.worker.ts`, `api-cobranca/src/communications/template-resume.service.ts` (`selectionFor`), `template-renderer.ts` (compatibilidade). Testes: `collection-profile.service.spec.ts`, `template-resume` specs, `npm run test:collection-rules:postgres` (migration, CHECK e FK) e o e2e da F1.

**Contrato proposto:**

- DTO da etapa: `whatsappMethodTemplates?: { PIX?: uuid | null; BOLETO?: uuid | null; BOLIX?: uuid | null }`. Campo ausente preserva o valor atual (compatibilidade com o frontend antigo); `null` limpa. Resposta da régua devolve o mesmo objeto e, por forma, `{ ready, code }`, como `whatsappStatus`.
- `ruleStepSelection(step, billingMethod?)`: com template da forma de pagamento → `{ mode: 'EXPLICIT', templateId }`; senão a seleção atual da etapa. `TemplateSelection` não muda, então pendências e retomadas guardam o mesmo formato.
- Forma de pagamento da mensagem: a da cobrança ativa (`PaymentCharge.billingMethod`) no momento da preparação; sem cobrança ativa, a mesma resolução usada hoje na primeira cobrança (`resolveInvoiceBillingType`).
- `templateDataNeeds(parsed, mapping)`: `{ pix, boleto }` conforme botões e fontes (`PIX_COPY_PASTE`; `BOLETO_LINE`, `BOLETO_LINK`, `BOLETO_PDF`, botão de boleto da F4). Pix fornece só Pix; Boleto só boleto; BOLIX os dois.

- [x] Testes que falham antes: etapa com base A e BOLIX = B → cobrança BOLIX usa B, Pix usa A; template de outra empresa ou não liberado → 400 ao salvar; template que exige boleto escolhido para Pix → 400 com mensagem clara; frontend antigo (sem o campo) não apaga escolhas; perfil com tentativas aceita a troca no lugar; retomada de pendência escolhe pela forma atual.
- [x] Criar a migration, gerar o client e cobrir no runner `test:collection-rules:postgres`.
- [x] Aplicar `ruleStepSelection(step, method)` nos três produtores: primeira mensagem (F1), agendador e retomada.
- [x] Na apresentação da régua, avisar quando a escolha base exige dados que alguma forma não tem ("Boleto: este template precisa do Pix"). Aviso, não bloqueio, porque a empresa pode não usar aquela forma.
- [x] `npm test -- --runInBand collection-profile billing template-resume`, runner PostgreSQL e e2e. Commit sugerido: `feat: template de whatsapp por forma de pagamento na regua`.

**Aceite:** a mesma etapa envia o template de Pix para cobranças Pix e o de BOLIX para cobranças BOLIX, sem troca automática e com pendência explicada quando falta configuração.

## F3. Régua: escolha por forma de pagamento (frontend)

**Modificar:** `front-cobranca/src/app/(dashboard)/configuracoes/regua/page.tsx`, tipos em `front-cobranca/src/lib/api-client.ts` e testes da régua (`__tests__` da página).

- [x] Em cada etapa de WhatsApp: opção "Usar templates diferentes por forma de pagamento". Ao marcar, três seletores (Pix, Boleto, BOLIX) com "Igual à etapa" ou um template liberado compatível, e o status de cada um. Ao desmarcar, envia `null` para as três.
- [x] Mostrar o aviso de compatibilidade da F2 e o texto novo da etapa Inicial (F1). Linha do tempo exibe os nomes por forma quando houver.
- [x] Estados de carregando/erro distintos; `409`/erro de validação recarregam em vez de sobrescrever, como hoje.
- [x] Testes: marcar, escolher BOLIX e salvar envia `whatsappMethodTemplates`; desmarcar limpa; template incompatível não aparece na lista da forma; perfil antigo sem o campo abre como "o mesmo para todas". `npx jest --runInBand`, `npm run lint`, `npm run build`. Commit sugerido: `feat: regua escolhe template por forma de pagamento`.

**Aceite:** a empresa configura, na etapa Inicial, um template para Pix e outro para BOLIX e vê o status de cada um.

## F4. Botão "Copiar código do boleto"

Mesmo desenho do botão Pix (`f278689`): o código aprovado na Meta é exemplo; cada envio leva a linha digitável da própria cobrança.

**Modificar:** `template-components.ts` (aceitar `PAYMENT_REQUEST` com `payment_setting.type = 'boleto'`, no máximo um), `template-contracts.ts` (`ParsedTemplate.boletoButton`, `TemplateMapping.boletoButton: { index, source: 'BOLETO_LINE' }`, `RenderResult.boletoButtonCode`), `template-renderer.ts` (validação do vínculo, `mappingSources`, render), `template-reservation.ts`, `outbound-dispatcher.service.ts` (`DispatchInput.boletoButton` e componente `sub_type: 'payment_request'` com `payment_setting: { type: 'boleto', boleto: { digitable_line } }`), `template-catalog-query.service.ts` (`content.boletoButton`). Frontend: `types.ts`, `TemplateMappingEditor.tsx`, `WhatsappCatalog.tsx`, `CompanyWhatsappTemplates.tsx`. Docs: `api-cobranca/src/whatsapp/transport/README.md`, `docs/operations/whatsapp-template-catalog.md`, `AGENTS.md` (seção 4.3).

- [x] Testes que falham antes: template com Pix + boleto + link `/pagar/{{1}}` + resposta rápida é suportado com os três índices; `payment_link` e dois botões de boleto continuam recusados; linha "00190.00009 01234.567004 00000.001234 1 98760000015000" vira 47 dígitos; valor sem 47 dígitos → `UNSUPPORTED` (`BOLETO_LINE`); fatura sem linha → `VALUE_MISSING`; troca de linha entre preparar e transmitir muda a impressão digital; o envio monta os três componentes nos índices aprovados.
- [x] Catálogo simulado do e2e (`test/support/template-e2e.ts`): template `emissao_bolix` com os três botões; o fluxo importa, exige o vínculo, envia uma vez com Pix, linha digitável e token do link, e retém a cobrança Pix (sem boleto) com `VALUE_MISSING`.
- [x] `npm test -- --runInBand src/templates src/whatsapp`, `npm run test:e2e:templates`, testes do frontend. Commit sugerido: `feat: botao copiar codigo do boleto em templates`.

**Aceite:** o template BOLIX aparece suportado e cada envio leva o Pix, a linha e o link da própria cobrança.

## F5. Homologação com template real (ação humana)

Depois da publicação (backend antes do frontend) e com o canal liberado pelo responsável:

- [ ] Criar na Meta o template BOLIX (categoria Utility, variáveis nomeadas) com: botão de pagamento Pix, botão de pagamento boleto, botão de link "Abrir link de pagamento" para `https://<domínio do front>/pagar/{{1}}` e, se quiser, a resposta rápida "Preciso de ajuda".
- [ ] Aguardar a aprovação, **Sincronizar catálogo**, conferir "suportado", configurar variáveis, liberar para a empresa de teste.
- [ ] Na régua da empresa de teste: etapa Inicial com Pix = `emissao_pix` e BOLIX = template BOLIX.
- [ ] Emitir uma cobrança Pix e uma BOLIX para um telefone controlado. Conferir no WhatsApp os três botões e a página `/pagar`. Conferir que não chega segunda mensagem nem segundo e-mail de emissão às 9h/17h, e que o e-mail usa o template da etapa Inicial de e-mail.
- [ ] Registrar resultado, IDs das intenções e horários ao fim deste plano, sem dados pessoais.

## F6. Primeiro e-mail pela etapa Inicial da régua

Mesma regra da F1 (D4), reaproveitando `initialRuleStep(steps, 'EMAIL')`. Depende da F1; entra na mesma publicação do backend. O e-mail não tem template por forma de pagamento (a F2 é só WhatsApp); o conteúdo continua trazendo Pix, linha digitável e link conforme a cobrança, como hoje.

**Modificar:** `api-cobranca/src/queue/workers/message.worker.ts` (bloco `EMAIL` de `processInitialChargeJob`), `api-cobranca/src/billing/billing.service.ts` (etapas `EMAIL` em `queueBillingForCompany`), `api-cobranca/src/billing/collection-rule-engine.ts`. Testes: `message.worker.spec.ts`, `billing.service.spec.ts`, `collection-rule-engine.spec.ts` e o e2e da F1 com um devedor com e-mail (Resend simulado).

**Contrato proposto:**

- Com etapa Inicial de e-mail: template por `resolveForRule(companyId, step.emailTemplateId)` (`null` = padrão de e-mail, como na régua) e job com `ruleStepId` da etapa. A tentativa passa a ser registrada por `EmailService.send`/`markAttemptAsFailed`, como nos e-mails da régua. A chave do job fica igual à do agendador para a mesma etapa (`email:<empresa>:<fatura>:<etapa>:<e-mail>`), o que também evita um job duplicado na fila.
- Sem etapa Inicial de e-mail: `findActiveOrDefault(companyId, null)`, sem `ruleStepId`, como hoje.
- Template da etapa desativado: o primeiro e-mail não sai, fica registrado `EMAIL_SKIPPED` com o motivo e não há troca pelo padrão.

- [x] Testes que falham antes: etapa Inicial de e-mail com template X → o primeiro e-mail usa X e leva `ruleStepId`; perfil sem Inicial de e-mail → template padrão, sem `ruleStepId`; template X desativado → nenhum e-mail e registro do motivo; o agendador não envia a Inicial de e-mail depois do primeiro e-mail; fatura antiga com `EMAIL_QUEUED` e sem tentativa também não é repetida; job inicial e agendador concorrentes produzem um e-mail.
- [x] Trava: criar a tentativa `QUEUED` da etapa Inicial de e-mail antes de enfileirar (mesma rotina `createQueuedAttempt`). Se já existir, o envio automático não enfileira e registra o motivo; o envio selecionado manualmente (`source: 'SELECTED'`) continua sendo uma comunicação própria, como no WhatsApp.
- [x] No agendador, considerar cumprida a etapa Inicial de e-mail quando a fatura já tem `EMAIL_QUEUED` (gravado só pela primeira cobrança). Isso cobre faturas antigas sem escrever dados.
- [x] O texto da etapa Inicial na régua (F1) vale para os dois canais.
- [x] `npm test -- --runInBand message.worker billing.service collection-rule-engine` e o e2e. Commit sugerido: `fix: primeiro email segue a etapa inicial da regua`.

**Aceite:** o primeiro e-mail usa o template da etapa Inicial de e-mail; nenhuma fatura recebe dois e-mails de emissão; perfis sem essa etapa não mudam.

## Futuro (fora deste plano): nota fiscal anexada ao template

Pedido registrado para especificação própria em `docs/superpowers/specs/`. Pontos que a especificação precisa decidir:

- **Formato:** cabeçalho de documento (HEADER `DOCUMENT`), hoje recusado pelo leitor de templates. Um template com nota fiscal é outro template aprovado na Meta.
- **Cadastro:** upload do PDF na criação da cobrança ou da fatura: tamanho máximo, só PDF, uma nota por fatura, substituição e exclusão auditadas.
- **Armazenamento:** cifrado, isolado por empresa, com retenção definida (dado fiscal e pessoal, LGPD). Nunca em URL pública.
- **Envio:** upload da mídia no Datafy no momento da transmissão (cota de upload 60/min), parâmetro `document` com `id` e nome do arquivo. Definir o tratamento de upload incerto sem reenviar a mensagem.
- **Escolha:** fatura sem nota com template que exige nota → pendência. Decidir se a escolha "com nota / sem nota" entra na etapa, como a forma de pagamento.
- **E-mail:** decidir se a nota também vai anexada no e-mail.

## Ordem de publicação

1. F1 + F6 + F2 + F4 (backend, com migration aditiva): `prisma migrate deploy`; o frontend antigo continua funcionando porque os campos novos são opcionais.
2. F3 (frontend).
3. F5 (homologação) e registro.

Commit, merge, deploy e "funcionando em produção" são etapas diferentes; nenhuma é declarada sem evidência.

## Registro de execução (30/09/2026)

Branch `feat/templates-emissao-forma-pagamento`, a partir do `main` (`64416c0`). Nada commitado, publicado ou executado em produção.

**Feito:** F1, F2, F3, F4 e F6. **Pendente:** F0 (consultas em produção, pelo responsável ou com autorização) e F5 (template real na Meta e envio controlado).

**Verificação**

- Backend: 925 testes (116 suítes); lint dos arquivos alterados; `npm run build` sem erros.
- PostgreSQL descartável: `test:collection-rules:postgres` com 44 migrations, incluindo a nova (`20260930120000_rule_step_method_templates`): CHECK de canal, chave estrangeira, liberação, compatibilidade e cliente antigo preservando a escolha.
- E2E descartável: `test:e2e:templates` (17 testes, com o novo `emission-template-selection.e2e-spec.ts`) e `template-resume.e2e-spec.ts` (4). O novo e2e passa pela fila real da primeira cobrança: cobrança BOLIX sai com `emissao_bolix` (Pix, linha digitável em 47 dígitos e link), cobrança Pix com `emissao_pix`, a tentativa da etapa Inicial fica `SENT` e o agendador não gera segunda mensagem.
- Frontend: 293 testes, lint (só o aviso conhecido de `useReactTable`), build.
- Navegador (ambiente descartável, dados sintéticos): régua em 1366 px e 375 px com a opção por forma de pagamento no Contato inicial; sem rolagem horizontal.

**Desvios e decisões técnicas**

- F1/F6: a etapa Inicial fica cumprida por qualquer primeira mensagem da fatura, inclusive uma que falhou (`FAILED`), e não só pelas não falhas. Assim as faturas antigas seguem a mesma regra das novas, em que a tentativa registrada já bloqueia o reenvio.
- F1: a primeira mensagem passa a registrar a tentativa da etapa (enviada ou falha). A falha técnica dela **não** dispara o e-mail de fallback das etapas da régua, que a primeira mensagem nunca teve (`emailFallback: false` para as chaves `initial`/`selected-*`).
- F1/F6: só o envio que registrou a etapa leva `ruleStepId`. Um envio selecionado manualmente depois disso é comunicação própria e não altera a tentativa. Se a preparação falha, a etapa volta para a régua (tentativa `QUEUED` removida).
- F6: sem pedido, os envios automáticos não incluem e-mail (canal padrão WhatsApp); a regra vale quando o e-mail é enviado na primeira cobrança (envio selecionado).
- F2: os templates por forma de pagamento são três colunas na etapa (`pixTemplateId`, `boletoTemplateId`, `bolixTemplateId`), e não uma tabela nova. A retomada de pendência escolhe pela forma da cobrança `ACTIVE` no momento.
- F3: as listas por forma filtram pelos botões visíveis à empresa; variáveis de corpo que leem Pix ou boleto são validadas no servidor (400 com a forma de pagamento na mensagem).
- `createQueuedFallbackAttempt` do worker foi renomeado para `createQueuedAttempt`, porque passou a servir também à etapa Inicial.

**Cobertura parcial**

- Concorrência entre o job inicial e o agendador: coberta pela trava da tentativa (teste unitário com duplicidade), não por execução simultânea real.
- Troca da linha digitável entre preparar e transmitir: coberta pelo mesmo mecanismo da impressão digital do Pix (fonte incluída no contexto), sem teste específico de boleto.
