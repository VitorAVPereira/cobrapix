# Régua com templates automáticos: plano de execução (20/10/2026)

Especificação: [régua de cobrança com templates automáticos](../specs/2026-10-20-regua-templates-automaticos-design.md). Um PR por fase, publicado nesta ordem.

## Registro de execução

- [x] Fase 0: especificação e plano.
- [x] Fase 1: os 18 templates globais e a grade no admin (não muda envios).
  - Desvio: os padrões por finalidade de cada empresa continuam na tela do admin até a Fase 2, porque ainda controlam os envios; a grade nova entra ao lado deles e os substitui na Fase 2.
- [x] Fase 2: novas regras de envio no backend.
  - Desvio: perfis com envios deixam de ficar travados; etapa já enviada mantém dia e canal e, removida, é desativada (antes só o template podia mudar, e ele deixou de existir).
  - Desvio: as fases vão num único PR; a ordem segura de publicação está no runbook (backend após a rodada das 17:00, 18 templates e preflight antes das 09:00).
  - A mensagem de emissão sai nos canais marcados no cadastro (WhatsApp por padrão); sem resposta (telas antigas), vale o padrão atual da empresa/cliente.
- [ ] Fase 3: tela de templates da empresa e pedido ao suporte.
- [ ] Fase 4: nova régua e "Enviar cobrança agora" no cadastro.

## Regras de envio (o coração da mudança)

### 1. Emissão: só a pedido, no cadastro
- O formulário da fatura e a importação ganham **"Enviar cobrança agora"**, com os canais WhatsApp e E-mail.
  - A opção vem marcada conforme o padrão atual da empresa ou do cliente (`autoGenerateFirstCharge`, em Configurações → Geral e no cliente).
  - O canal WhatsApp vem marcado por padrão, como hoje.
- Sem pedido no cadastro, não há mensagem de emissão. A cobrança Efí continua sendo gerada como hoje; só a mensagem deixa de sair.
- Recorrentes:
  - a fatura gerada automaticamente segue o padrão da empresa ou do cliente, porque não passa por formulário;
  - o envio manual de faturas selecionadas continua existindo e conta como emissão.
- As etapas "Inicial" (dia acumulado ≤ -30) deixam de ser executadas pela régua. Ficam no banco só como histórico.

### 2. Momento: calculado na hora do envio, pelo estado real da fatura
Uma função única, `collectionMoment(...)`, em `templates/template-selection.ts`, substitui o uso de `purposeForScheduleDay` na cobrança. Ela recebe o dia real do envio em relação ao vencimento (no fuso de São Paulo), se a fatura é recorrente (`Invoice.recurringInvoiceId`) e se a fatura já teve uma mensagem de atraso recebida.

| Situação no dia do envio | Momento (template) |
| --- | --- |
| Mensagem pedida no cadastro | Emissão |
| Antes do vencimento | Lembrete |
| No dia do vencimento | Vence hoje |
| Vencida e fatura **recorrente** | Atraso recorrente (todas as mensagens) |
| Vencida, avulsa, sem atraso recebido antes | Primeiro atraso |
| Vencida, avulsa, com atraso já recebido | Atraso crítico (repete nas etapas seguintes) |

- **"Atraso recebido"** é uma `CollectionAttempt` de data posterior ao vencimento com status diferente de `FAILED` e `BLOCKED`. Assim, uma falha ou uma mensagem retida não "gasta" o Primeiro atraso.
- O momento usa o **dia real do envio**, não o dia da etapa. Um lembrete que esperou as 24 h e acabou saindo no dia do vencimento usa "Vence hoje", e o texto nunca fica errado.

### 3. Contatos da régua e intervalo de 24 h
- **Contato.** As etapas do mesmo dia (WhatsApp + E-mail) formam um contato e saem juntas na mesma rodada.
  - Hoje o motor devolve uma etapa por rodada; passa a devolver as etapas do contato: `getNextStep` vira `getNextContact` em `collection-rule-engine.ts:87`.
- **Qual contato sai.** Em cada rodada (09:00 e 17:00), entre os contatos com data ≤ hoje e ainda não enviados, só o **mais recente** é considerado.
  - Os mais antigos são marcados como pulados, com motivo registrado, e não saem mais.
  - Isso substitui o comportamento atual de mandar etapas atrasadas uma a uma.
- **Lembrete anterior ao cadastro.** Um contato antes do vencimento com data anterior ao dia do cadastro da fatura é ignorado, porque o cliente já foi avisado na emissão ou a data já passou.
- **24 h.** Se a última mensagem da fatura (emissão ou contato) foi há menos de 24 h, o contato espera para uma próxima rodada.
  - "Última mensagem" é a tentativa mais recente que não falhou: `CollectionAttempt`, a intenção ou pendência da emissão no WhatsApp, ou o log `EMAIL_QUEUED` da emissão.
  - Exemplo: emissão em 20/10 às 15h, vencimento em 23/10 e lembrete em 21/10. O lembrete sai na rodada das 17h de 21/10. Se ainda não pudesse sair até 23/10 e houver contato no vencimento, sai só o do vencimento.
- **Registro do pulo.** A migration aditiva acrescenta o valor `SKIPPED` em `CollectionAttemptStatus` e grava o motivo em `errorDetails` e em `CollectionLog`. A deduplicação por `@@unique([companyId, invoiceId, ruleStepId, channel])` continua valendo.

### 4. Qual template é usado
1. O sob medida da etapa para a forma de pagamento, se o admin ligou um.
2. O global de (momento, forma de pagamento).
3. Se não houver nenhum dos dois, a mensagem fica **pendente** pelo fluxo atual (`TemplatePendingService.block`). Nunca se troca por outro template.

- O e-mail usa o modelo do momento (slugs atuais: `cobranca-emissao`, `pre-vencimento`, `vencimento-hoje`, `atraso-primeiro-aviso`, `atraso-recorrente`, `atraso-critico`). Se a empresa desativou aquele modelo, o e-mail é pulado e registrado.
- Os propósitos de ativação e de pagamentos a colaboradores continuam no padrão por empresa, sem mudança.

## Fases (um PR por fase, nesta ordem de publicação)

### Fase 0: documentação
- Especificação em `docs/superpowers/specs/2026-10-2x-regua-templates-automaticos-design.md`, com as regras acima e exemplos.
- Plano de execução em `docs/superpowers/plans/`.

### Fase 1: os 18 templates globais (sem mudar o envio)
- **Migration aditiva** com o modelo `CollectionTemplateSlot`: `purpose`, `billingMethod` (PIX, BOLIX ou CREDIT_CARD), `templateId?`, `version`, `updatedById`, e `@@unique([purpose, billingMethod])`.
- **Rotas de admin** em `/admin/whatsapp-templates/collection-slots`:
  - GET lista os 18 com status;
  - PUT grava com versão esperada e responde `409` se a versão mudou;
  - valida a prontidão (`readiness` em `template-policy.service.ts:126`) e a compatibilidade com a forma de pagamento (`methodCanFill` em `template-renderer.ts:197`);
  - registra auditoria em `WhatsappTemplateAudit`.
- **Tela `admin/templates`.** Uma grade 6 × 3 "Templates da régua" substitui o "Padrão por finalidade" de cobrança.
- O admin preenche os 18 antes da Fase 2.

### Fase 2: novas regras de envio (backend)
- **Seleção automática** em `template-contracts.ts:38`:
  - o modo novo é `{ mode: 'AUTOMATIC'; purpose; billingMethod; ruleStepId? }`;
  - `TemplatePolicyService.resolve` resolve primeiro o sob medida e depois o global, com o mesmo `evaluate`;
  - código de bloqueio novo: `COLLECTION_TEMPLATE_MISSING`.
- **Templates sob medida.** Migration aditiva com o modelo `CollectionStepTemplateOverride`: `ruleStepId`, `billingMethod`, `templateId`, `requestId?`, `createdById`, e `@@unique([ruleStepId, billingMethod])`. Só o admin grava.
- **Motor da régua** (`collection-rule-engine.ts`): `getNextContact` com as regras 2 e 3. Etapas com dia acumulado ≤ -30 ficam fora.
- **`billing.service.ts`** (`queueBillingForCompany`, perto da linha 520):
  - envia todos os canais do contato;
  - calcula o momento com `collectionMoment`;
  - marca os contatos pulados;
  - aplica o intervalo de 24 h.
- **Emissão:**
  - `CreateInvoiceDto` e o fluxo de importação ganham `sendNow?: { channels: ('WHATSAPP'|'EMAIL')[] } | false`, com padrão pelo `autoGenerateFirstCharge`;
  - `queueInitialChargeJobs` (`invoices.service.ts:1895`) recebe os canais;
  - `message.worker.ts` (`prepareInitialWhatsapp` em ~777 e `queueInitialEmail` em ~650) deixa de olhar a etapa Inicial e usa `AUTOMATIC(EMISSION, método)`.
- **Retomada:** `template-resume.service.ts:411` passa a usar a mesma resolução automática.
- **Etapas** (`setSteps` em `collection-profile.service.ts:409`):
  - WhatsApp é gravado como `DEFAULT` com o momento estimado pelo dia, o que mantém os CHECKs atuais;
  - os campos de template enviados pelo cliente são ignorados, para o frontend antigo continuar funcionando na transição;
  - `presentSteps` mostra o momento estimado e o status dos templates.
- **Preflight.** O script `collection-templates:preflight` recusa a publicação se algum dos 18 não estiver pronto.

### Fase 3: tela de templates da empresa e pedido ao suporte
- **Prévia reutilizável.** `ChargeMessagePreview` (`components/landing/previews.tsx:16`) vira `WhatsappMessagePreview` em `components/features/templates/`:
  - recebe `body`, `footer`, `time` e `buttons[]`;
  - tem estilos próprios;
  - a landing passa a reutilizá-lo.
- **Rota** `GET /templates/collection`: lista os 18 com conteúdo e prévia com dados fictícios (`companyPreview`, em `template-catalog-query.service.ts:335`), mais os sob medida da empresa.
- **Tela `configuracoes/templates`, aba WhatsApp:**
  - grade compacta 6 momentos × 3 formas;
  - ao clicar, a prévia aparece ao lado (embaixo no celular), com a legenda de quando aquele momento é usado (as regras acima em linguagem simples);
  - seção "Personalizados da sua empresa".
  - A aba de e-mail continua com saudação, instruções e assinatura.
- **Pedido ao suporte:**
  - Migration aditiva com o modelo `TemplateRequest`: `companyId`, `requestedById`, `ruleStepId?`, `purpose`, `billingMethod`, `message`, `status` (`OPEN`, `IN_PROGRESS`, `DONE`, `REJECTED`), `adminNote?`, `version`.
  - Empresa: `POST /templates/requests` e `GET /templates/requests`, com o `companyId` do JWT.
  - E-mail ao admin para `PLATFORM_ALERT_EMAIL` pelo `ResendMailerService`.
  - Botão "Solicitar template personalizado" na tela de templates e em cada etapa da régua.
  - Admin: aba "Solicitações" em `admin/templates`, com mudança de status e o atalho para ligar o template sob medida à etapa.

### Fase 4: nova tela da régua e opção no cadastro
- Quebrar `regua/page.tsx` em `components/features/regua/`: perfis, linha do tempo e editor de etapas.
- **Cards por dia** com caixas de WhatsApp e E-mail; o backend continua com uma etapa por canal.
- No card aparece o momento estimado ("Lembrete", "Vence hoje", "Após o vencimento: Primeiro atraso / Atraso crítico, ou Atraso recorrente para recorrentes"), com "Ver mensagem" (prévia nas 3 formas) e o selo "Personalizado pelo suporte".
- **Removidos da régua:** "Contato inicial", seleção de template, templates por forma de pagamento e modelo de e-mail.
- Um texto fixo explica a regra das 24 h e a de "só a mais recente".
- Atalhos de dia (-3, 0, +1, +3, +7, +15, +30), dia livre e horário em "Opções avançadas".
- Etapa já usada: "Esta etapa já foi enviada; só é possível desativar".
- **Formulário da fatura** (`cobrancas`) e importação: "Enviar cobrança agora" com os canais.

## Arquivos principais
- **Backend:**
  - `prisma/schema.prisma`, com 4 migrations aditivas: slots, overrides, requests e `SKIPPED`;
  - em `templates/`: `template-contracts.ts`, `template-policy.service.ts`, `template-selection.ts`, `template-resume.service.ts`, `admin-templates.controller.ts`, `templates.controller.ts`, `template-catalog-query.service.ts`;
  - em `billing/`: `collection-rule-engine.ts`, `billing.service.ts`, `collection-profile.service.ts`;
  - `queue/workers/message.worker.ts`;
  - `invoices/` (DTO, service e importação);
  - `email/email-templates.service.ts`.
- **Frontend:**
  - `configuracoes/templates/`;
  - `configuracoes/regua/` e `components/features/regua/*`;
  - `admin/templates/`;
  - o formulário de cobrança e a importação;
  - `components/features/templates/WhatsappMessagePreview.tsx`;
  - `components/landing/previews.tsx`;
  - `lib/api-client.ts`.
- **Documentação:** especificação, plano e atualização de `docs/operations/whatsapp-template-catalog.md`.

## Riscos e cuidados
- **Ordem de publicação:**
  1. Fase 1.
  2. O admin preenche os 18.
  3. Preflight.
  4. Fase 2.
  5. Fases 3 e 4 (o frontend na Vercel depois do backend).
- **Mudança de comportamento visível ao cliente:**
  - etapas atrasadas não saem mais em fila, só a mais recente;
  - a emissão depende do pedido no cadastro;
  - existe o intervalo de 24 h.
  - Tudo isso entra no texto da régua e nas notas de publicação.
- Um template ausente nunca perde mensagem: ela fica pendente e o admin retoma.
- O histórico e a deduplicação por `ruleStepId` são mantidos. Contatos pulados ficam registrados com o motivo.
- **Concorrência.** O motor roda com o advisory lock atual (`runScheduledBilling`), e o envio manual "Executar agora" usa o mesmo caminho. A regra das 24 h é verificada dentro da mesma transação que cria a `CollectionAttempt`, para não sair em dobro.
- Template sob medida ligado a uma etapa: se a empresa remover a etapa, ele some junto, e a tela avisa antes.

## Verificação
- **Unitários de `collectionMoment`:**
  - lembrete, vence hoje e vencida;
  - recorrente sempre "Atraso recorrente";
  - avulsa: Primeiro atraso → Crítico;
  - falha e retenção não contam como atraso recebido.
- **Unitários de `getNextContact`:**
  - contato com dois canais;
  - só o mais recente, com os anteriores marcados `SKIPPED`;
  - lembrete anterior ao cadastro ignorado;
  - 24 h com o exemplo 20/10 → 21/10 → 23/10;
  - lembrete adiado para o vencimento usa "Vence hoje";
  - etapas Inicial ignoradas.
- **Unitários de resolução:**
  - os 18 pares;
  - prioridade do sob medida;
  - falta de template → pendente;
  - BOLETO → pendente;
  - sem troca de template.
- **Unitários de e-mail e de emissão:**
  - e-mail pelo momento e modelo desativado → pulado;
  - emissão só com o pedido no cadastro e nos canais escolhidos;
  - pedido ao suporte isolado por empresa (404).
- **Integração em banco descartável:**
  - `test:collection-rules:postgres`, com os novos modelos, `SKIPPED` e o intervalo de 24 h com datas reais;
  - `test:e2e:templates`, com os e2e de emissão, cartão e retomada ajustados.
- **Frontend (Jest):**
  - grade e prévia;
  - formulário de suporte;
  - régua nova;
  - "Enviar cobrança agora" no formulário.
- **No navegador, com ambiente descartável:**
  - admin preenche os 18;
  - cadastro de fatura com e sem envio;
  - "Executar agora" com WhatsApp simulado em faturas Pix, Bolix, Cartão e recorrente;
  - conferir o template de cada momento e o intervalo de 24 h, avançando a data nas faturas de teste;
  - pedido ao suporte visível no admin.
