# Templates Meta e liberação por empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** importar os templates aprovados da Meta pelo Datafy e permitir que apenas empresas explicitamente autorizadas os utilizem, com variáveis configuradas pelo admin e retomada manual de mensagens bloqueadas.

**Architecture:** catálogo global sincronizado no PostgreSQL, revisões imutáveis de mapeamento, liberações e padrões por empresa. A política é aplicada na seleção e novamente no dispatcher existente. Pendências e autorizações administrativas integram-se às intenções persistentes, preservando deduplicação, criptografia e tratamento de resultados incertos.

**Tech Stack:** NestJS 11, Prisma 7/PostgreSQL 16, BullMQ/Redis 7, Datafy, Next.js 16/React 19, Jest/Testing Library e Supertest. Reutilizar dependências existentes.

**Spec:** `docs/superpowers/specs/2026-09-27-whatsapp-meta-catalog-company-grants-design.md`, aprovada em 27/09/2026. Ler junto deste plano.

**Base:** `4070b82`; mudanças posteriores exigem conferir os pontos de integração antes de executar. Este documento planeja o trabalho; nenhum checkbox representa implementação concluída.

## Global Constraints

- "O transporte continua exclusivamente pelo **Datafy**, inclusive na consulta do catálogo e no recebimento de eventos."
- "Uma nova empresa ou um template recém-importado começa sem liberações."
- "A empresa apenas visualiza e escolhe templates WhatsApp."
- "Não há substituição automática do template. A cobrança financeira continua existindo."
- "Corrigir uma pendência não dispara o estoque de mensagens automaticamente."
- "`ACCEPTED` não pode ser retomada." `SENDING` e `UNCERTAIN` também não autorizam reenvio por este fluxo.
- "O e-mail continua usando `GlobalEmailTemplate` e suas preferências."
- "Preservar IDs das etapas, ordem, atrasos acumulados e tentativas existentes."
- "Não criar outro transporte nem uma segunda fila independente para o mesmo envio."
- "Nenhuma etapa que exponha um template a empresas deve ser publicada isoladamente antes da proteção efetiva no backend e no worker."
- Reconciliação periódica proposta: 15 minutos. Janela para texto livre: 24 horas desde a última mensagem recebida. Nenhum novo envio reabre essa janela.
- Prisma permanece exclusivamente no backend. Testes com escrita usam PostgreSQL/Redis locais descartáveis, nunca os valores de conexão do `.env` compartilhado ou da VPS.

## Review Focus

1. Mesmo nome em idiomas/WABAs diferentes: não conflitar IDs, eventos ou permissões; teste nas tarefas 2 e 3.
2. Paginação interrompida e webhook concorrente: não excluir catálogo nem restaurar aprovação antiga; teste na tarefa 3.
3. Chat com duas empresas e frontend antigo mandando parâmetros: não enviar com contexto errado nem aceitar substituições livres; teste na tarefa 11.
4. Revogar e conceder novamente durante espera/retry, ou receber aceitação após timeout: não retomar silenciosamente nem duplicar; testes nas tarefas 6, 7 e 9.
5. Régua antiga com EMAIL, tentativas e atrasos relativos: preservar conteúdo efetivo e calendário, inclusive quando WhatsApp fica bloqueado; testes nas tarefas 1 e 8.

---

## 1. Contexto para quem vai implementar

Empresa é o cliente da CifraMais, dono da cobrança; devedor é o destinatário. Um número/WABA atende todas as empresas. Aprovação da Meta, mapeamento válido e liberação administrativa são três condições distintas.

Hoje `TemplatesService` cria seis modelos internos e combina-os com preferências da empresa. O sincronizador atualiza modelos conhecidos, mas não importa automaticamente os novos. `CollectionRuleStep.templateId` aponta para WhatsApp mesmo nas etapas EMAIL. O envio passa por `OutboundDispatcherService` e `CommunicationOutboundIntent`, com filas recuperáveis e estados que distinguem falha conhecida de resultado incerto.

O código contém seleção alternativa de templates, fallback para e-mail, parâmetros de Inbox fornecidos pelo cliente e avisos de onboarding escolhidos por env. Todos precisam convergir para o novo contrato. A entrega não modifica a emissão Efí ou o split.

A primeira versão suporta BODY textual posicional, FOOTER textual opcional e, opcionalmente, um botão URL dinâmico compatível com o pagamento. Template aprovado de outro formato aparece no admin com motivo de incompatibilidade. Não transformar conteúdo externo para fazê-lo parecer suportado.

## 2. Estrutura e contratos que orientam as tarefas

### Organização dos arquivos

Todos os caminhos deste plano são relativos à raiz do repositório. Arquivos marcados como novos ainda serão criados.

| Unidade | Arquivos principais | Responsabilidade |
| --- | --- | --- |
| Domínio compartilhado | `api-cobranca/src/templates/template-contracts.ts` (novo) | Tipos de seleção, mapeamento, versões, decisões e erros. |
| Normalização | `api-cobranca/src/templates/template-components.ts` (novo) | Validar componentes externos, posições e impressão de conteúdo. |
| Renderização | `api-cobranca/src/templates/template-renderer.ts`, `template-context.service.ts` e `template-rendering.module.ts` (novos) | Converter fontes autorizadas em parâmetros e prévia; carregar contexto real sem depender do catálogo HTTP. |
| Política | `api-cobranca/src/templates/template-policy.service.ts`, `template-policy.module.ts` (novos) | Resolver seleção e verificar versões/liberação dentro da transação. |
| Catálogo | `api-cobranca/src/templates/template-catalog-sync.service.ts`, `template-mapping.service.ts` (novos) | Importação, reconciliação, revisões e prévia administrativa. |
| Liberações | `api-cobranca/src/templates/company-template-access.service.ts` (novo) | Alterar permissões/padrões com auditoria e controle de concorrência. |
| Pendências | `api-cobranca/src/communications/template-pending.service.ts`, `template-resume.service.ts` (novos) | Bloqueios persistentes e autorização idempotente de retomada. |
| Integração de envio | `outbound-intent.service.ts`, `outbound-dispatcher.service.ts`, `message.worker.ts` existentes | Preservar um único ciclo real de transmissão. |
| Admin HTTP | `api-cobranca/src/templates/admin-templates.controller.ts`, `api-cobranca/src/communications/template-pending.controller.ts` (novos) | Operações administrativas e DTOs próprios. |
| Frontend | `front-cobranca/src/components/features/templates/` (novo) | Componentes de catálogo, mapa, permissões e pendências. |
| Migração operacional | `api-cobranca/src/scripts/transition-whatsapp-templates.ts` e runbook (novos) | Diagnóstico, retirada controlada do catálogo antigo e conferências. |

`TemplatePolicyModule` depende de Prisma e das funções puras, sem importar `WhatsappModule` ou `QueueModule`. `TemplatesModule` passa a usar diretamente `WhatsappTransportModule` para consultar o catálogo. Remover sua dependência de `WhatsappModule`; dispatcher e produtores importam a política, evitando um novo ciclo de injeção.

`TemplateRenderingModule` importa apenas `PrismaModule` e `PaymentModule`, exportando `TemplateContextService`; não importa `TemplatesModule`. Retomada pertence a `OutboundIntentModule`, que importa política/renderização e contém as reservas/pendências. `TemplatesModule` importa esses módulos e fornece o preparador de envios. O mecanismo atual de recuperação agenda as intenções. Não injetar `TemplatesModule`, `WhatsappModule` ou `QueueModule` de volta em `OutboundIntentModule`. Links existentes são resolvidos sem emitir cobrança.

### Tipos centrais

Definir em `template-contracts.ts`; interfaces HTTP são DTOs validados que representam esses contratos, não tipos Prisma expostos diretamente.

```ts
type TemplatePurpose = 'EMISSION' | 'BEFORE_DUE' | 'DUE_TODAY'
  | 'FIRST_OVERDUE' | 'RECURRING_OVERDUE' | 'CRITICAL_OVERDUE'
  | 'ACTIVATION_NOTICE' | 'ACTIVATION_REMINDER';
type TemplateSelection =
  | { mode: 'EXPLICIT'; templateId: string }
  | { mode: 'DEFAULT'; purpose: TemplatePurpose }
  | { mode: 'UNCONFIGURED' };
type TemplateContext = {
  companyId: string; debtorId?: string; invoiceId?: string;
  activationId?: string;
};
type TemplateSource = 'DEBTOR_NAME' | 'COMPANY_NAME' | 'AMOUNT'
  | 'DUE_DATE' | 'PAYMENT_LINK' | 'PIX_COPY_PASTE' | 'BOLETO_LINE'
  | 'BOLETO_LINK' | 'BOLETO_PDF' | 'REPRESENTATIVE_NAME';
type TemplateBinding =
  | { kind: 'SOURCE'; source: TemplateSource }
  | { kind: 'LITERAL'; value: string };
type TemplateMapping = {
  body: Record<string, TemplateBinding>;
  paymentButton?: { index: 0; source: 'PAYMENT_URL_SUFFIX' };
};
type TemplateSnapshot = {
  templateId: string; providerRevision: number; mappingRevision: number;
  policyVersion: number; grantVersion: number;
};
type TemplateBlockCode = 'DEFAULT_MISSING' | 'NOT_GRANTED' | 'NOT_APPROVED'
  | 'UNSUPPORTED' | 'REVIEW_REQUIRED' | 'VALUE_MISSING'
  | 'VERSION_CHANGED' | 'CONTEXT_CHANGED' | 'LEGACY_PAYLOAD' | 'SELECTION_MISSING';
type ParsedTemplate = {
  body: string; positions: number[]; footer: string | null;
  paymentButton: { index: 0; label: string; url: string } | null;
  fingerprint: string;
};
type ParseResult =
  | { supported: true; template: ParsedTemplate }
  | { supported: false; reason: string };
type ReadyTemplate = {
  snapshot: TemplateSnapshot; name: string; language: string;
  parsed: ParsedTemplate; mapping: TemplateMapping;
};
type TemplateDecision =
  | { allowed: true; template: ReadyTemplate }
  | { allowed: false; code: TemplateBlockCode };
type RenderValues = Partial<Record<TemplateSource, string>>;
type RenderResult =
  | { ok: true; body: string; bodyParameters: string[];
      paymentButtonSuffix?: string }
  | { ok: false; code: 'VALUE_MISSING' | 'UNSUPPORTED'; field: string };
```

Chaves de `body` são posições decimais (`"1"`, `"2"`), não nomes de propriedades do banco. `UNCONFIGURED` representa etapa legada/rascunho e resolve como `SELECTION_MISSING`; não é seleção válida para habilitar envio. `policyVersion` avança quando muda a elegibilidade do template, sem avançar por mera atualização de horário/qualidade. `grantVersion` avança a cada mudança efetiva de permissão. Revisões de conteúdo e de mapeamento são distintas; mudar/reverter uma permissão não restaura o número anterior.

### Contrato de envio e retomada

Novo `TemplateSendRequest`, no mesmo arquivo: `{ logicalKey: string; origin: 'COLLECTION' | 'ADMIN_REPLY' | 'ACTIVATION'; context: TemplateContext; selection: TemplateSelection; ruleStepId?: string; conversationId?: string; replyToExternalMessageId?: string }`. Identidade do destinatário vem do contexto autorizado, não de parâmetros livres do navegador.

Adicionar aos dados persistidos da intenção `logicalKey`, `generation`, `templateSnapshot`, `templateContextFingerprint` e contexto necessário para revalidar. Valores renderizados continuam no payload cifrado existente. O fingerprint inclui identidade do destinatário, vínculos, valores utilizados e elegibilidade relevante; não inclui horário da consulta nem campos sem efeito sobre a mensagem. Usar unicidade `(logicalKey, generation)` e a chave idempotente já existente; geração inicial preserva a chave antiga. Uma sucessora explicitamente autorizada usa `<logicalKey>#resume:<reviewId>`, respeitando o limite da coluna ou utilizando representação hash estável quando necessário.

`PendingInput`: `{ request: TemplateSendRequest; code: TemplateBlockCode; intentId?: string; snapshot?: TemplateSnapshot }`. `PendingRef`: `{ id: string; version: number; state: 'BLOCKED' | 'RESUMED' | 'CLOSED'; currentIntentId: string | null }`. `ResumeItem`: `{ pendingId: string; replacementTemplateId?: string }`.

`ResumeReview`: `{ id: string; expiresAt: string; items: Array<{ pendingId: string; companyId: string; invoiceId: string | null; templateId: string | null; templateName: string | null; action: 'RESUME' | 'CLOSE' | 'KEEP_BLOCKED'; reason: string | null; previewBody: string | null }> }`. `previewBody` é renderizado para a resposta autenticada ao admin; não é persistido em claro no registro da revisão. `ResumeResult`: `{ reviewId: string; intentIds: string[]; closedPendingIds: string[] }`.

Prévia de retomada dura 15 minutos e contém até 50 itens: limites operacionais desta implementação. Persistir internamente versões e fingerprint dos dados/contexto avaliados, sem texto ou destinatário em claro no registro da revisão. Confirmação exige `reviewId` e `idempotencyId` UUID. Uma tentativa repetida retorna o resultado já gravado; reutilizar a chave com outro conteúdo gera conflito.

### Ordem e comandos

Executar as tarefas 1–10 antes de integrar as telas 11–14; a 15 fecha migração e publicação. As subtarefas de UI podem ser desenvolvidas sobre contratos concluídos, mas a publicação é conjunta.

Nos comandos abaixo, `npm --prefix api-cobranca test -- ...` executa Jest unitário; `npm --prefix front-cobranca exec -- jest ...` usa Jest do frontend. Para scripts de integração, entrar em `api-cobranca` e executar `node test/<arquivo>.cjs` ou `node test/e2e-disposable.cjs <spec>`. A falha inicial deve corresponder à regra ausente, não a banco indisponível ou erro de configuração do teste.

## Tarefa 1 — Separar as etapas EMAIL do catálogo WhatsApp

**Arquivos:** modificar `api-cobranca/prisma/schema.prisma`, `api-cobranca/src/billing/billing.controller.ts`, `billing.service.ts` e `collection-profile.service.ts` da mesma pasta, `api-cobranca/src/email/email-templates.service.ts`. Criar `api-cobranca/prisma/migrations/20260927140000_collection_rule_email_templates/migration.sql` e `api-cobranca/test/template-email-migration-postgres.cjs`. Atualizar `api-cobranca/test/collection-rules-postgres.cjs` e testes unitários correspondentes.

**Interfaces:** adicionar `CollectionRuleStep.emailTemplateId` → `GlobalEmailTemplate`; `templateId` passa a representar somente WHATSAPP. Adicionar `EmailTemplatesService.resolveForRule(companyId: string, templateId: string | null): Promise<ResolvedEmailTemplate>`; ID explícito inválido é erro, `null` conserva o padrão de e-mail existente. DTOs e resposta de régua expõem `emailTemplateId` separadamente.

- [ ] Escrever teste de migração em PostgreSQL descartável, seguindo a proteção por nome/label do runner atual. Criar uma etapa EMAIL com preferência personalizada e uma etapa WhatsApp com tentativa `SENT`. Asserções principais:

  ```js
  assert.equal(after.emailStep.emailTemplateId, before.effectiveEmailTemplateId);
  assert.equal(after.emailStep.templateId, null);
  assert.deepEqual(after.attempts, before.attempts);
  assert.deepEqual(after.stepIdsAndDelays, before.stepIdsAndDelays);
  assert.equal(after.renderedEmail, before.renderedEmail);
  ```

  Incluir rollback com slug sem correspondência. Fixture deve registrar o template efetivamente resolvido antes da migração, não supor que todo ID legado representa e-mail ativo.
- [ ] Executar `node test/template-email-migration-postgres.cjs` em `api-cobranca`; comprovar falha por coluna/conversão ausente.
- [ ] Implementar FK, índice e backfill transacional por slug. Manter seleção padrão (`null`) quando essa já era a semântica. Se uma referência legada depende de definição padrão ainda não persistida, o diagnóstico lista a dependência; preparar o catálogo EMAIL existente antes da conversão, sem fabricar conteúdo por SQL. Interromper em referência ambígua/não mapeável. Depois do backfill, aplicar CHECK de coerência entre canal e as duas FKs; nenhuma exclusão de etapa. Atualizar os resolutores e a criação dos quatro perfis padrão sem buscar templates WhatsApp para EMAIL.
- [ ] Rodar novamente o runner e `npm --prefix api-cobranca test -- --runInBand --testPathPatterns='billing|collection-profile|email-templates'`. Esperado: testes passam, histórico preservado e nenhum acesso WhatsApp necessário para resolver EMAIL.
- [ ] Commit: `refactor: separate email collection rule templates`.

## Tarefa 2 — Modelar catálogo externo e normalizar componentes

**Arquivos:** criar `api-cobranca/src/templates/template-contracts.ts`, `template-components.ts`, `template-components.spec.ts`; modificar schema; criar `api-cobranca/prisma/migrations/20260927150000_whatsapp_template_catalog_access/migration.sql`. Teste de estrutura em `api-cobranca/test/template-catalog-postgres.cjs` (novo).

**Interfaces:** `parseTemplate(input: { components: unknown; parameterFormat?: string; language: string; category: string; paymentBaseUrl: string }): ParseResult`. Criar tabelas `WhatsappTemplateMappingRevision`, `CompanyWhatsappTemplateGrant`, `CompanyWhatsappTemplateDefault`, `WhatsappTemplateAudit` e `WhatsappTemplateSyncState`.

- [ ] Escrever testes `positional_body_and_payment_button`, `named_parameters_are_unsupported`, `same_name_different_account_or_language` e `unknown_component_is_not_dropped`. Usar amostras mínimas declaradas no próprio teste:

  ```ts
  expect(parsed).toMatchObject({ supported: true,
    template: { positions: [1, 2], footer: 'CifraMais' } });
  expect(named.supported).toBe(false);
  expect(unknownHeader.supported).toBe(false);
  expect(reorderedProviderObject.template.fingerprint)
    .toBe(parsed.template.fingerprint);
  ```

- [ ] Executar `npm --prefix api-cobranca test -- --runInBand --testPathPatterns=template-components`; esperar falha pela função ausente.
- [ ] Evoluir `GlobalMessageTemplate`: `origin` (`LEGACY_INTERNAL`/`META_IMPORTED`), `providerAccountId`, `providerRevision`, `policyVersion`, `mappingRevision`, `providerFingerprint`, `parameterFormat`, `archivedAt`, `supportReason`. Manter campos legados para histórico. Usar unicidade por WABA + ID externo e busca secundária por WABA/nome/idioma; não adotar o slug comercial como identidade. Templates importados recebem slug técnico determinístico. O ID externo é obrigatório para uma nova importação; item incompleto gera diagnóstico.
- [ ] Criar revisões de mapeamento únicas `(templateId, revision)`, contendo fingerprint/revisão do provedor, componentes usados, mapa e autoria. Grant único `(companyId, templateId)` com estado/versionamento. Default único `(companyId, purpose)` com versão. Auditoria permite `companyId` nulo para operações de catálogo, sem guardar valores renderizados. Estado de sync é único por WABA e armazena lease, pedido de reconciliação, última conclusão e erro seguro. Implementar parser estrito com variáveis repetidas, posições ordenadas e sem lacunas, rodapé sem variáveis e botão único em índice 0. `{{1}}` do botão não é `{{1}}` do corpo; validar URL-base exatamente contra o domínio/caminho configurado, sem buscar a URL.
- [ ] Rodar os testes e `node test/template-catalog-postgres.cjs`; conferir unicidade e FKs, inclusive duas WABAs/idiomas e registros legados sem identidade. Rodar `npm --prefix api-cobranca run prisma:generate` e build. Commit: `feat: model imported WhatsApp template catalog`.

## Tarefa 3 — Importar, reconciliar e processar eventos

**Arquivos:** criar `api-cobranca/src/templates/template-catalog-sync.service.ts` e `.spec.ts`; modificar `templates.module.ts`, `templates.service.ts`, `template-provider-state.ts` e `.spec.ts`; modificar `api-cobranca/src/whatsapp/transport/whatsapp-transport.ts`, `datafy.transport.ts` e `.spec.ts`; modificar `api-cobranca/src/webhooks/datafy-event.types.ts`, `datafy-event-processor.service.ts` e testes existentes. Ampliar `api-cobranca/test/template-catalog-postgres.cjs`.

**Interfaces:** `TemplateCatalogSyncService.sync(reason: 'MANUAL' | 'PERIODIC' | 'EVENT'): Promise<{ imported: number; updated: number; unavailable: number; completed: boolean }>`; `requestSync(tx: Prisma.TransactionClient, providerAccountId: string): Promise<void>`. Evento normalizado carrega a WABA verificada; `applyTemplateEvent` continua dentro da transação do webhook.

- [ ] Cobrir `imports_unknown_approved_without_grant`, `partial_scan_never_removes`, `late_poll_cannot_restore_after_rejection`, `deleted_template_is_unavailable`, `unknown_event_requests_sync`. Asserções:

  ```ts
  expect(result.imported).toBe(1);
  expect(await grantsForImportedTemplate()).toHaveLength(0);
  expect(afterFailedSecondPage.archivedAt).toBeNull();
  expect(afterConcurrentWebhook.metaStatus).toBe('REJECTED');
  expect(afterApprovedEvent.metaReviewRequired).toBe(true);
  ```

  Os helpers de consulta desse teste operam somente sobre fixtures da WABA de teste.
- [ ] Rodar testes de sync, provider-state e transport; registrar os casos que ainda falham.
- [ ] Implementar leitura paginada pelo Datafy, incluindo `parameter_format` quando o contrato permitir. Validar `/me` contra a WABA/número configurados antes de aceitar importação. Importar novos aprovados e acompanhar todos os estados dos já importados. Usar lease no banco para exclusão entre processos; timer de 15 minutos para sync completo e de 10 segundos para pedidos pendentes do webhook. Renovar lease durante paginação; só concluir ausência de um item quando a varredura completa ainda for dona do lease.
- [ ] Na aplicação de resultados, usar versões capturadas antes da consulta; não sobrescrever campos alterados por webhook posterior. Conflito agenda nova leitura e mantém a restrição. Mudanças de conteúdo/categoria criam revisão pendente e incrementam versão de política; `APPROVED` não aprova o mapeamento. Eventos desconhecidos apenas solicitam sync durável. Não fazer HTTP dentro da transação de eventos nem seguir `paging.next`.
- [ ] Rodar `npm --prefix api-cobranca test -- --runInBand --testPathPatterns='template-catalog-sync|template-provider-state|datafy.transport|datafy-event'` e o runner PostgreSQL. Resultado: importação idempotente, ordenação e rollback comprovados. Commit: `feat: sync approved templates through Datafy`.

## Tarefa 4 — Mapeamento, prévia e contexto confiável

**Arquivos:** criar `api-cobranca/src/templates/template-renderer.ts`, `.spec.ts`, `template-context.service.ts`, `.spec.ts`, `template-rendering.module.ts`, `template-mapping.service.ts`, `.spec.ts`; integrar providers em `templates.module.ts` respeitando a separação de módulos descrita acima. Reutilizar `api-cobranca/src/payment/payment-link.service.ts` e dados de pagamento existentes, sem reemitir cobranças.

**Interfaces:** `renderTemplate(parsed: ParsedTemplate, mapping: TemplateMapping, values: RenderValues, paymentUrl?: string): RenderResult`; `TemplateContextService.load(context: TemplateContext, origin: TemplateSendRequest['origin'], mapping: TemplateMapping): Promise<{ values: RenderValues; recipient: string; paymentUrl?: string; contextFingerprint: string }>`; `TemplateMappingService.save(templateId: string, expectedProviderRevision: number, expectedMappingRevision: number, mapping: TemplateMapping, actorUserId: string): Promise<{ mappingRevision: number }>` e `preview(templateId: string, mapping: TemplateMapping): Promise<RenderResult>`.

- [ ] Escrever testes de BODY repetido, índices independentes de botão, parâmetro ausente, data civil brasileira, literal, contexto cruzado e URL inválida:

  ```ts
  expect(rendered).toMatchObject({ ok: true,
    bodyParameters: ['Maria Exemplo', 'R$ 150,00'],
    paymentButtonSuffix: 'token-da-fatura' });
  expect(missing).toMatchObject({ ok: false, code: 'VALUE_MISSING' });
  expect(values.DUE_DATE).toBe('05/10/2026');
  expect(wrongInvoiceCompany).toBeInstanceOf(NotFoundException);
  ```

- [ ] Executar os três arquivos novos com Jest e confirmar falhas pelas regras ausentes.
- [ ] Implementar fontes fechadas e tamanho/quantidade de parâmetros conforme contrato validado do Datafy. Carregar devedor/fatura/ativação sempre por empresa; exigir fatura apenas para fontes dependentes dela. O representante vem da ativação validada. A prévia administrativa usa dados sintéticos e nunca envia mensagem. Salvar uma revisão imutável e auditoria em transação com comparação das revisões do provedor e do mapeamento (0 se ainda não houver mapa). Testar duas edições do mesmo mapa: uma vence e outra recebe 409, mesmo se a Meta não mudou. Validar fontes e mapa antes de liberar a revisão.
- [ ] Testar que a URL é o link gerado para aquela fatura, não outra URL enviada pelo navegador; lidar com vírgula monetária e espaço de moeda sem alterar o significado. Rodar testes e build. Commit: `feat: map and preview imported template variables`.

## Tarefa 5 — Liberações, padrões e política comum

**Arquivos:** criar `api-cobranca/src/templates/template-policy.service.ts`, `.spec.ts`, `template-policy.module.ts`, `company-template-access.service.ts`, `.spec.ts`. Ampliar testes PostgreSQL da tarefa 2. Integrar módulos consumidores sem novos ciclos.

**Interfaces:** `TemplatePolicyService.resolve(tx: Prisma.TransactionClient, companyId: string, selection: TemplateSelection): Promise<TemplateDecision>`; `assertPinned(tx: Prisma.TransactionClient, companyId: string, snapshot: TemplateSnapshot): Promise<void>`; erro tipado `TemplatePolicyError` com `code: TemplateBlockCode`.

`CompanyTemplateAccessService.setGrant(companyId: string, templateId: string, enabled: boolean, expectedVersion: number, actorUserId: string): Promise<{ version: number }>`; `setDefault(companyId: string, purpose: TemplatePurpose, templateId: string, expectedVersion: number, actorUserId: string): Promise<{ version: number }>`; versão 0 representa registro ainda inexistente.

- [ ] Testar negação por ausência de grant, isolamento A/B, escolha explícita sem fallback e revogação/reconcessão:

  ```ts
  expect(decisionForB).toEqual({ allowed: false, code: 'NOT_GRANTED' });
  expect(explicitRevoked).toEqual({ allowed: false, code: 'NOT_GRANTED' });
  expect(missingDefault).toEqual({ allowed: false, code: 'DEFAULT_MISSING' });
  await expect(policy.assertPinned(tx, companyA, oldSnapshot))
    .rejects.toMatchObject({ code: 'VERSION_CHANGED' });
  ```

- [ ] Rodar os testes e provar a falha inicial; depois implementar política sem acesso HTTP. `ReadyTemplate` usa a revisão efetivamente aprovada pelo admin. Mapas inválidos, formatos incompatíveis ou origem legada não são elegíveis.
- [ ] Salvar alteração e auditoria na mesma transação; atualização concorrente por `expectedVersion` retorna conflito. Para grant novo só aceitar template atualmente utilizável; revogar é permitido mesmo se ficou indisponível. Padrão exige grant ativo da mesma empresa. Atualização sem mudança não incrementa versão. Preferências antigas nunca concedem permissão.
- [ ] Padronizar locks: templates ordenados por ID, grants ordenados, chave lógica do envio, intenção. Alterações de catálogo/grant e autorização final usam os mesmos locks/versões. Rejeitar transação que tente restaurar versão antiga. Comprovar em PostgreSQL rollback da auditoria e concorrência de duas alterações. Commit: `feat: enforce company template grants and defaults`.

## Tarefa 6 — Persistir bloqueios e ligar gerações à mesma comunicação

**Arquivos:** modificar schema; criar `api-cobranca/prisma/migrations/20260927160000_whatsapp_template_pending_sends/migration.sql`, `api-cobranca/src/communications/template-pending.service.ts`, `.spec.ts` e `api-cobranca/test/template-pending-postgres.cjs`. Modificar `api-cobranca/src/communications/outbound-intent.service.ts`, `.spec.ts`, `outbound-intent.module.ts` e DTOs da consulta administrativa de intenções.

**Interfaces:** `TemplatePendingService.block(tx: Prisma.TransactionClient, input: PendingInput): Promise<PendingRef>`; `findByLogicalKey(tx: Prisma.TransactionClient, logicalKey: string): Promise<PendingRef | null>`; `reconcileInvalidSnapshots(limit: number): Promise<number>`. `OutboundIntentService.reserveInTransaction(tx: Prisma.TransactionClient, input: ReserveOutboundIntentInput): Promise<OutboundReservation>` compartilha o corpo transacional de `reserve`, para que retomada e reserva façam um único commit.

- [ ] Escrever testes de bloqueio anterior à intenção, deduplicação, rollback e recuperação que ignora bloqueados:

  ```ts
  expect(new Set(concurrentBlocks.map(row => row.id)).size).toBe(1);
  expect((await intents.recover()).some(row => row.id === blockedIntentId)).toBe(false);
  expect(await countPendingAfterRollback()).toBe(0);
  expect(await countAuditsAfterRollback()).toBe(0);
  ```

- [ ] Rodar Jest de `template-pending` e o runner PostgreSQL; confirmar falha por ausência do modelo/estado, sem usar infraestrutura compartilhada.
- [ ] Adicionar `BLOCKED` à intenção e à tentativa de régua, além de `logicalKey`, `generation`, snapshot, `templateContextFingerprint` e resultado de transmissão conhecido (`NOT_SENT`/`ACCEPTED`/`UNCERTAIN`) na intenção. Acrescentar `WhatsappTemplatePendingSend`, único por `logicalKey`, com empresa/contexto, seleção, motivo, versão, estado, intenção atual e datas; request contém apenas identificadores, nunca corpo/telefone em claro. Pendência pode existir sem intenção. Seu histórico fica na auditoria, sem apagar o registro após retomada.
- [ ] Criar `WhatsappTemplateResumeReview` com ator, validade, itens/versionamento, confirmação e resultado, e unicidade da chave idempotente de confirmação. Criar unicidade `(logicalKey, generation)` nas intenções e índice parcial que impede duas intenções concorrentes elegíveis/aceitas/incertas da mesma chave (`PENDING`, `SENDING`, `ACCEPTED`, `UNCERTAIN`). Campos nulos dos envios não-template legados continuam permitidos. Usar lock transacional da chave lógica também quando ainda não existe linha, evitando corrida de primeira criação.
- [ ] `block` só altera intenção comprovadamente não transmitida, com atualização condicional. Não transformar um `SENDING` de outro worker em `BLOCKED`: sua versão será rejeitada pelo autorizador ou seguirá a triagem de resultado incerto. Tentativa passa a `BLOCKED`, sem excluir sua chave única. Implementar reconciliação de snapshots inválidos para intenções `PENDING`, em lotes paginados de até 100, sem deixar itens válidos no início da consulta impedir progresso. Isso faz a pendência aparecer mesmo antes do horário agendado. Testar concorrência, repetição sem duplicar contadores e preservação de `ACCEPTED`/`UNCERTAIN`. Commit: `feat: persist template send holds`.

## Tarefa 7 — Validar a permissão na autorização final de transmissão

**Arquivos:** modificar `api-cobranca/src/whatsapp/outbound-dispatcher.service.ts`, `.spec.ts`, `whatsapp.module.ts`, `api-cobranca/src/communications/outbound-intent.service.ts`, `.spec.ts`, `api-cobranca/src/queue/queue.controller.ts` e `queue.module.ts`. Criar `api-cobranca/src/queue/queue.controller.spec.ts` se ainda ausente. Ampliar `api-cobranca/test/outbound-dispatch-postgres.cjs`.

**Interfaces:** adicionar a `OutboundIntentService.execute` um callback opcional final `authorize: (tx: Prisma.TransactionClient, intent: CommunicationOutboundIntent) => Promise<void>`, invocado dentro da transação que autoriza/reclama o envio. Intenção nova com snapshot de template exige esse callback; texto livre conserva o fluxo próprio. `DispatchInput` recebe snapshot, fingerprint de contexto e identidade lógica; payload legado de template não obtém autorização implícita.

- [ ] Testar `regrant_does_not_release_old_snapshot`, `revocation_committed_before_claim_blocks`, `admin_reply_still_needs_grant`, `accepted_after_timeout_is_not_retried` e `queue_retry_cannot_resume_hold`:

  ```ts
  expect(datafy.sendTemplate).not.toHaveBeenCalled(); // revogação anterior ao claim
  expect(await intentState(oldIntentId)).toBe('BLOCKED');
  expect(await intentState(acceptedLateId)).toBe('ACCEPTED');
  expect(await retryBlockedJob()).toMatchObject({ status: 409 });
  expect(await retryAsCompany()).toMatchObject({ status: 403 });
  ```

- [ ] Rodar testes afetados e comprovar as falhas; acrescentar barreiras de transação no teste PostgreSQL para ordenar revogação e claim, sem depender de `sleep` arbitrário.
- [ ] Integrar `assertPinned` e a consulta de pendência com os locks da tarefa 5. Autorizar/reclamar a intenção e registrar a versão na mesma transação; nenhuma chamada externa mantém transação aberta. Essa confirmação define o início do envio em andamento: revogação anterior bloqueia, posterior não promete recolher a mensagem. Preservar as verificações atuais de fatura, consentimento, supressão, canal, quota e validade do texto livre imediatamente antes da transmissão. Comparar dados utilizados/identidade com o fingerprint preparado; mudança relevante gera `CONTEXT_CHANGED`, sem reescrever payload em silêncio. Cobrir alteração de valor e de telefone entre preparação e envio.
- [ ] Converter negativa de template em bloqueio durável, não em `FAILED` genérico ou retry automático. Falha conhecida do provedor por template indisponível solicita reconciliação e registra pendência; timeout/aceitação ambígua continua `UNCERTAIN`, sem autorização de sucessora. Códigos do provedor precisam ser classificados por contrato, sem inferir apenas por texto da mensagem. Preservar aceitação tardia, rollback de reserva de quota e leases.
- [ ] Antes de recuperar/enfileirar trabalho, executar a reconciliação de snapshots da tarefa 6; a validação transacional continua sendo a garantia final. Proteger estatísticas globais/retry por `PlatformAdminGuard`; mesmo admin recebe 409 quando a intenção está bloqueada. Rodar testes unitários, runner PostgreSQL e teste de recuperação Redis existente. Commit: `fix: enforce template policy at final dispatch`.

## Tarefa 8 — Migrar cobrança, régua e avisos para seleção autorizada

**Arquivos:** criar `api-cobranca/src/templates/template-send-preparer.service.ts`, `.spec.ts`; modificar `api-cobranca/src/billing/billing.service.ts`, `billing.controller.ts`, `collection-profile.service.ts` e testes da pasta; modificar `api-cobranca/src/queue/message.queue.ts`, `workers/message.worker.ts` e testes; modificar `api-cobranca/src/efi-onboarding/central-onboarding-notifications.ts` e criar `api-cobranca/src/efi-onboarding/central-onboarding-notifications.spec.ts`; modificar `api-cobranca/src/whatsapp/whatsapp.service.ts`, `api-cobranca/src/templates/templates.service.ts` e módulos consumidores. Acrescentar schema/migration `api-cobranca/prisma/migrations/20260927170000_whatsapp_rule_selection/migration.sql`.

**Interfaces:** `TemplateSendPreparerService.prepare(request: TemplateSendRequest): Promise<{ status: 'QUEUED'; intentId: string } | { status: 'BLOCKED'; pendingId: string }>` combina política, contexto, renderização e reserva sem transmitir. Definir `CollectionRuleStep.whatsappSelectionMode` (`EXPLICIT`/`DEFAULT`/`UNCONFIGURED`) e `whatsappPurpose` nullable. A resposta/DTO da etapa usa `whatsappSelection: TemplateSelection` em WHATSAPP e `emailTemplateId` em EMAIL; não aceitar ambos.

- [ ] Testar `missing_default_keeps_invoice_and_blocks_only_whatsapp`, `explicit_template_never_falls_back`, `blocked_step_preserves_next_due_day`, `initial_charge_requires_emission_default`, `activation_uses_own_default`:

  ```ts
  expect(result.status).toBe('BLOCKED');
  expect(invoiceAfter).toEqual(invoiceBefore);
  expect(emailFallback).not.toHaveBeenCalled();
  expect(nextEmailDueDayAfter).toBe(nextEmailDueDayBefore);
  expect(activationRequest.selection).toEqual({ mode: 'DEFAULT', purpose: 'ACTIVATION_NOTICE' });
  ```

- [ ] Rodar testes de billing, perfis, worker e onboarding. Implementar seleção de cobrança inicial por `EMISSION`; régua conserva a finalidade comercial da etapa, sem tentar `vencimento-hoje` ou o primeiro template disponível. Avisos de ativação usam `ACTIVATION_NOTICE`/`ACTIVATION_REMINDER`, com representante e contexto próprios. Remover dependência de `EFI_ONBOARDING_*_TEMPLATE` para decidir o envio novo; se continuarem no env por compatibilidade, não podem sobrepor a permissão.
- [ ] Na migration de seleção, deixar EMAIL sem finalidade/modo WhatsApp; para WhatsApp existente, registrar `UNCONFIGURED` e conservar o ID antigo até a transição operacional. Novas etapas válidas têm modo/finalidade coerentes; CHECK impede `DEFAULT` sem finalidade ou `EXPLICIT` sem template. A migration não concede permissões nem apaga IDs de etapas. Rodar o teste de preservação de calendário da tarefa 1 junto do teste de perfis.
- [ ] Preparar/reservar antes de colocar na fila; jobs novos transportam ID da intenção. Repetição do produtor retorna intenção/pendência existente pela chave lógica. Fixar template/snapshot da mensagem preparada; mudar um default vale somente para futuras preparações. Jobs antigos com nome/parâmetros recebem `LEGACY_PAYLOAD`, sem transmitir. Não chamar fallback EMAIL em qualquer `TemplatePolicyError`; outras falhas técnicas mantêm o comportamento contratado previamente.
- [ ] Atualizar perfis padrão para criar etapas WhatsApp por finalidade mesmo sem template liberado. `UNCONFIGURED` fica visível como pendência, sem alterar `delayDays` ou `isActive` para fazer a etapa desaparecer. Preservar soma de atrasos para os canais seguintes. Não apagar/recriar etapas com tentativas: permitir atualizar apenas sua seleção de template mediante ID estável e validação, sem reescrever histórico. Toda troca deixa mensagens preparadas intactas até revisão explícita.
- [ ] Retirar `ensureGlobalCatalog` WhatsApp e a busca por preferências no caminho de envio. Revisar `api-cobranca/prisma/seed.ts` e `api-cobranca/src/templates/template-catalog.ts` para não reintroduzir catálogo ativo; preservar exclusivamente constantes de finalidade que ainda sejam úteis. Rodar suites afetadas e teste PostgreSQL de perfis. Commit: `refactor: prepare collection messages from company template policy`.

## Tarefa 9 — Autorizar retomadas com prévia, versões e idempotência

**Arquivos:** criar `api-cobranca/src/communications/template-resume.service.ts`, `.spec.ts`; modificar `outbound-intent.module.ts`, `template-pending.service.ts`, consultas de tentativas e atualizações de aceitação no dispatcher. Ampliar `api-cobranca/test/template-pending-postgres.cjs`; criar `api-cobranca/test/template-resume.e2e-spec.ts`.

**Interfaces:** `TemplateResumeService.preview(items: ResumeItem[], actorUserId: string): Promise<ResumeReview>`; `confirm(reviewId: string, idempotencyId: string, actorUserId: string): Promise<ResumeResult>`. A confirmação reutiliza `reserveInTransaction`, não chama `sendTemplate` nem publica na fila antes do commit.

- [ ] Testar `paid_invoice_closes_without_send`, `same_confirmation_returns_same_successor`, `changed_mapping_requires_new_preview`, `redis_loss_after_commit_recovers_once` e `uncertain_cannot_resume`:

  ```ts
  expect(firstResult).toEqual(repeatedResult);
  expect(new Set(concurrentResults.flatMap(r => r.intentIds)).size).toBe(1);
  expect(await acceptedOrUncertainSuccessors()).toHaveLength(0);
  expect(await confirmStaleReview()).toMatchObject({ status: 409 });
  expect(datafySendCallsAfterRecovery).toBe(1);
  ```

- [ ] Rodar Jest e o runner isolado; na integração Redis simular perda somente da fila criada pelo teste, sem limpar instâncias externas.
- [ ] Gerar prévia de até 50 itens com validade de 15 minutos, contexto resolvido, revisões e fingerprint dos dados relevantes. Cobranças definitivamente pagas/canceladas são propostas para encerramento. Falta de permissão/mapa mantém bloqueio. Pausa temporária/quota/horário gera espera aplicável, sem forçar horário pelo admin. Para atendimento sem fatura e ativação, aplicar elegibilidade da respectiva origem. Item `SENDING`, `ACCEPTED` ou `UNCERTAIN` nunca entra na lista reenviável.
- [ ] Confirmar com locks ordenados, conferindo revisão ainda válida e não consumida. Se algum dado relevante mudou desde a prévia, retornar 409 sem efeitos parciais. Criar sucessora apenas quando a anterior estiver comprovadamente `NOT_SENT`, ou não existir intenção; geração aumenta uma vez. Guardar autorização, auditoria, resultado e estado da pendência na mesma transação. Preservar payload/estado da tentativa original e vincular a sucessora. Requisição repetida após timeout do cliente retorna resultado persistido.
- [ ] Fazer produtores e `attemptSeries` reconhecerem pendência `RESUMED` e retornarem sua intenção atual, sem recriar a geração 0. Rebloqueio reabre a mesma pendência com versão nova. Recuperação agenda só as intenções autorizadas `PENDING`; aceitação atualiza a tentativa original sem criar outra pela mesma chave. Rodar testes e `node test/e2e-disposable.cjs template-resume.e2e-spec.ts`. Commit: `feat: review and resume blocked template sends`.

## Tarefa 10 — Publicar APIs administrativas e empresariais

**Arquivos:** criar `api-cobranca/src/templates/admin-templates.controller.ts`, `dto/template-mapping.dto.ts`, `dto/company-template-access.dto.ts`; modificar `templates.controller.ts`, `templates.service.ts`, `templates.module.ts`. Criar `api-cobranca/src/communications/template-pending.controller.ts`, `dto/template-resume.dto.ts` e `api-cobranca/test/template-access.e2e-spec.ts`; modificar `communications.module.ts`/`outbound-intent.module.ts` conforme propriedade dos controllers.

**Interfaces HTTP:** DTOs usam UUIDs, enums fechados, limites de strings/arrays e rejeição de campos desconhecidos. Contexto da empresa vem do JWT nos endpoints empresariais. Catálogo e pendências usam `CatalogPage<T> = { items: T[]; nextCursor: string | null }`, com `limit` de 1–100, padrão 25. Seletores carregam as páginas ou oferecem busca paginada; não tratam a primeira página como catálogo completo.

| Método/rota | Contrato |
| --- | --- |
| `GET /admin/whatsapp-templates` | Catálogo completo, filtro por status/suporte; padrão `APPROVED`. |
| `POST /admin/whatsapp-templates/sync` | Retorna o resultado de `sync('MANUAL')`; conflito 409 se sync já em andamento. |
| `PUT /admin/whatsapp-templates/:id/mapping` | `{ expectedProviderRevision, expectedMappingRevision, mapping }` → revisão salva. |
| `POST /admin/whatsapp-templates/:id/preview` | `{ mapping }` → prévia sintética/diagnóstico, sem envio. |
| `GET /admin/whatsapp-templates/companies/:companyId` | Grants, versões, defaults e disponibilidade efetiva da empresa. |
| `PUT /admin/whatsapp-templates/companies/:companyId/grants/:templateId` | `{ enabled, expectedVersion }`. |
| `PUT /admin/whatsapp-templates/companies/:companyId/defaults/:purpose` | `{ templateId, expectedVersion }`. |
| `GET /templates` e `GET /templates/:id` | Somente WhatsApp disponível para a empresa autenticada; sem personalizações editáveis. |
| `GET /templates/:id/preview` | Prévia sintética somente se o template estiver disponível para a empresa. |
| `GET /communications/admin/template-pending` | Pendências globais filtráveis por empresa, template e motivo. |
| `GET /communications/template-pending` | Pendências somente da empresa autenticada. |
| `POST /communications/admin/template-pending/reviews` | `{ items: ResumeItem[] }` → `ResumeReview`. |
| `POST /communications/admin/template-pending/reviews/:id/confirm` | `{ idempotencyId }` → `ResumeResult`. |

`GET /templates` e catálogo admin devolvem itens com ID, nome, idioma, conteúdo/rodapé/botão aprovados, status, compatibilidade e revisão. Só o admin recebe mapa completo, distribuição de grants e diagnósticos globais. API da empresa devolve somente o necessário à leitura e seleção. Rotas estáticas são registradas antes de parâmetros genéricos.

- [ ] Criar e2e A/B/admin com JWT real e provider falso. Incluir:

  ```ts
  expect(listB.body.items.some(t => t.id === templateOnlyA)).toBe(false);
  expect(await statusOfForeignPreview()).toBe(404);
  expect(await statusOfGrantAsCompany()).toBe(403);
  expect(await statusOfLegacyCreateAsAdmin()).toBe(410);
  expect(provider.createTemplate).not.toHaveBeenCalled();
  ```

- [ ] Executar `node test/e2e-disposable.cjs template-access.e2e-spec.ts` e verificar falhas de contrato.
- [ ] Implementar controllers com `JwtAuthGuard` e `PlatformAdminGuard` nas rotas globais. Empresa nunca informa `companyId` para obter outro catálogo. Remover criação/submissão/edição de WhatsApp por rotas antigas: retornar 410 com código `TEMPLATE_AUTHORING_MOVED_TO_META`, sem chamar transporte. Redirecionar internamente a antiga sincronização/revisão somente se conseguir respeitar o novo DTO; caso contrário, responder 410 com instrução para atualizar o painel. Não alterar endpoints de e-mail.
- [ ] Retornar bloqueios e conflitos de forma estruturada; auditar ator no servidor, ignorando/recusando `actorUserId` vindo do cliente. Testar vazamento por ID, filtro e paginação, inclusive padrões/grants de outra empresa. Rodar e2e e build. Commit: `feat: expose scoped template administration APIs`.

## Tarefa 11 — Aplicar contexto e mapeamento no Inbox

**Arquivos:** modificar `api-cobranca/src/communications/communications.service.ts`, `.spec.ts`, `communications.controller.ts`, `dto/template-reply.dto.ts`, `api-cobranca/src/whatsapp/whatsapp.service.ts`; modificar `front-cobranca/src/components/features/CommunicationsHistory.tsx`, `communications/AdminConversationContext.tsx` e testes respectivos; modificar `front-cobranca/src/lib/api-client.ts`. Ampliar `api-cobranca/test/template-access.e2e-spec.ts`.

**Interfaces:** conservar rota `POST /communications/admin/conversations/:id/template-replies`, mas DTO passa a `{ idempotencyId: string; templateId: string; context: MessageContextDto }`; contexto obrigatório com empresa, parâmetros livres proibidos. Adicionar `GET /communications/admin/conversations/:id/template-options?companyId=...&invoiceId=...&debtorId=...`: validar contexto antes de listar e indicar fontes ausentes. Frontend usa `getConversationTemplateOptions(conversationId, context)` e `replyWithTemplate(conversationId, dto)`.

- [ ] Testar mesmo chat com A/B, troca de contexto durante consulta, janela expirando na fila e parâmetros de cliente antigo:

  ```ts
  expect(optionsForB.some(t => t.id === onlyA)).toBe(false);
  expect(replyWithClientParameters.status).toBe(400);
  expect(replyWithoutCompany.status).toBe(400);
  expect(freeTextAfterWindow.providerCalls).toBe(0);
  expect(templateReplyAfterWindow.providerCalls).toBe(1);
  ```

- [ ] Rodar unitários/e2e e testes Testing Library do componente. Revalidar o contexto pela relação da conversa com mensagens/devedor/fatura; não aceitar empresa arbitrária só porque o ator é admin. Permitir resposta geral em texto livre sem forçar fatura; templates sempre têm empresa. Template com dado de cobrança exige fatura correta mesmo sem botão.
- [ ] Preparar resposta pelo serviço da tarefa 8. Reutilizar idempotência e fila administrativa; não enviar valores digitados manualmente nos parâmetros. A UI escolhe contexto antes do template, limpa seleção e prévia ao mudar de empresa e descarta resposta HTTP antiga via abort/identidade da requisição. Mostrar motivo quando não há template utilizável. Texto livre conserva edição dentro da janela e checagem final no backend.
- [ ] Comprovar na UI que escolher um template não reabre a janela. Rodar `npm --prefix front-cobranca exec -- jest --runInBand --testPathPatterns='AdminConversationContext|CommunicationsHistory'`, backend afetado e e2e. Commit: `feat: scope inbox templates to the selected company`.

## Tarefa 12 — Catálogo e liberações no painel do administrador

**Arquivos:** modificar `front-cobranca/src/app/(dashboard)/admin/templates/page.tsx` e `page.test.tsx`; criar `front-cobranca/src/components/features/templates/WhatsappCatalog.tsx`, `TemplateMappingEditor.tsx`, `CompanyTemplateGrants.tsx`, `types.ts` e respectivos testes em `__tests__/`; modificar `front-cobranca/src/lib/api-client.ts` e criar `front-cobranca/src/lib/__tests__/api-client-templates.test.ts`.

**Interfaces:** componentes recebem o cliente tipado da API existente e callbacks de atualização; não acessam Prisma ou Datafy. Métodos do cliente: `getAdminWhatsappTemplates(query)`, `syncWhatsappTemplates()`, `saveWhatsappTemplateMapping(id, dto)`, `previewWhatsappTemplate(id, dto)`, `getCompanyWhatsappTemplates(companyId)`, `setCompanyWhatsappTemplateGrant(companyId, templateId, dto)`, `setCompanyWhatsappTemplateDefault(companyId, purpose, dto)`; payloads/respostas correspondem à tarefa 10. `types.ts` define os DTOs de apresentação, sem reutilizar `SaveMessageTemplateInput` antigo.

- [ ] Escrever testes por comportamento com Testing Library, incluindo aprovado incompatível e conflito de versão:

  ```tsx
  expect(screen.getByText('Formato não suportado')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Liberar para empresa' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Enviar para Meta' })).not.toBeInTheDocument();
  expect(screen.getByText('A configuração mudou. Atualize a prévia.')).toBeVisible();
  ```

- [ ] Rodar os testes novos e comprovar que a tela antiga não satisfaz o fluxo.
- [ ] Implementar catálogo com aprovados como filtro inicial, idioma, categoria, status, suporte, revisão necessária e última sincronização. Oferecer filtro de indisponíveis para acompanhar referências históricas. Ações: sincronizar, configurar variáveis, visualizar prévia e abrir disponibilidade por empresa. Preservar a aba/formulários de e-mail. A página WhatsApp não cria, edita nem submete conteúdo à Meta.
- [ ] Editor mostra conteúdo aprovado somente leitura, posição/fonte de cada variável e resultado fictício. Tela de grants permite conceder/revogar e configurar padrão por finalidade; explica os envios afetados e que corrigir disponibilidade não retoma pendências. Tratar 409 recarregando estado sem sobrescrever mudança de outro administrador. Paginar empresas/catalogo, sem trazer todos os clientes em um payload ilimitado.
- [ ] Rodar Jest de componentes/página/cliente e `npm --prefix front-cobranca run build`. Commit: `feat: administer imported WhatsApp templates and grants`.

## Tarefa 13 — Templates empresariais somente leitura e régua por canal

**Arquivos:** modificar `front-cobranca/src/app/(dashboard)/configuracoes/templates/page.tsx`, `__tests__/page.test.tsx`, `front-cobranca/src/app/(dashboard)/configuracoes/regua/page.tsx`, `__tests__/page.test.tsx`, `front-cobranca/src/lib/api-client.ts`. Criar `front-cobranca/src/components/features/templates/CompanyWhatsappTemplates.tsx` e teste.

**Interfaces:** `getTemplates(query)` agora retorna uma `CatalogPage` com os itens autorizados de WhatsApp; `getEmailTemplates()` conserva os tipos e preferências de e-mail. Tipo de etapa no cliente tem seleção discriminada por `channel`, com os campos da tarefa 8. Atualização de template WhatsApp não possui método editável exposto ao componente empresarial. Atualizar todos os consumidores antigos que esperavam um array simples, inclusive o Inbox.

- [ ] Escrever testes de nenhuma liberação, seletor diferente para EMAIL, etapa revogada e ausência de personalização:

  ```tsx
  expect(screen.getByText('Nenhum template liberado para sua empresa.')).toBeVisible();
  expect(screen.queryByLabelText('Saudação WhatsApp')).not.toBeInTheDocument();
  expect(savedEmailStep).toMatchObject({ channel: 'EMAIL', emailTemplateId: emailId });
  expect(savedWhatsappStep).toMatchObject({ channel: 'WHATSAPP',
    whatsappSelection: { mode: 'DEFAULT', purpose: 'BEFORE_DUE' } });
  ```

- [ ] Rodar testes das duas páginas; depois implementar lista, detalhes e prévia somente leitura. Não misturar catálogo administrativo no cache da empresa. Invalidar dados ao trocar sessão/empresa.
- [ ] Régua permite padrão da finalidade ou escolha explícita entre liberados. Opção indisponível aparece como pendência referenciada na etapa, sem inserir template não autorizado no seletor. Manter etapas antigas/IDs/dias ao salvar outras configurações e bloquear habilitação sem seleção válida. Distinguir "nenhum template liberado" de falha HTTP; não mostrar lista vazia como se fosse sucesso quando API falhar.
- [ ] Preservar personalizações EMAIL e asserções de renderização prévias à mudança. Rodar Jest dessas páginas, testes de isolamento da API e build. Commit: `feat: restrict company template selection by channel and grant`.

## Tarefa 14 — Revisão de pendências no admin e indicação para empresas

**Arquivos:** criar `front-cobranca/src/components/features/templates/TemplatePendingSends.tsx`, `TemplateResumeReview.tsx` e testes; integrar em `front-cobranca/src/app/(dashboard)/admin/templates/page.tsx` e `front-cobranca/src/components/features/CommunicationsHistory.tsx`; modificar `front-cobranca/src/lib/api-client.ts` e testes. Manter autorização de acesso já usada nas páginas administrativas.

**Interfaces:** cliente oferece `getAdminTemplatePending(query)`, `getCompanyTemplatePending(query)`, `previewTemplateResume(items)` e `confirmTemplateResume(reviewId, idempotencyId)`, com os tipos das tarefas 9/10. A empresa recebe motivos/estado apenas de seus itens e não vê botões de retomada.

- [ ] Testar que corrigir um grant não confirma retomada, duplo clique usa a mesma chave e conflito invalida a prévia:

  ```tsx
  expect(api.confirmTemplateResume).not.toHaveBeenCalled(); // apenas corrigiu o mapa
  expect(new Set(confirmCalls.map(call => call[1])).size).toBe(1);
  expect(screen.getByText('A pendência mudou. Revise novamente.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Autorizar retomada' })).not.toBeInTheDocument(); // empresa
  ```

- [ ] Rodar os testes; implementar listagem com empresa/template/motivo e filtros. A prévia separa elegíveis, encerráveis e ainda bloqueados. Troca de template é explícita e limitada aos liberados, mostrando o resultado antes de confirmar. Não pré-selecionar todas as pendências de todas as empresas.
- [ ] Após confirmação, mostrar "Retomada autorizada"/"Aguardando envio", sem afirmar entrega. Timeout conserva o mesmo idempotencyId para consultar/repetir a confirmação. Atualização de status vem das intenções/webhooks. Cobrança já paga aparece encerrada sem mensagem. Não mostrar corpos/telefones de outra empresa nos erros.
- [ ] Rodar testes de componentes e cenário e2e de retomada. Commit: `feat: review blocked WhatsApp sends in admin`.

## Tarefa 15 — Ensaiar a transição e fechar o deploy

**Arquivos:** criar `api-cobranca/src/scripts/transition-whatsapp-templates.ts`, `api-cobranca/src/templates/template-transition.service.ts`, `.spec.ts`, `api-cobranca/test/template-transition-postgres.cjs`, `api-cobranca/test/template-catalog-flow.e2e-spec.ts` e `docs/operations/whatsapp-template-catalog.md`. Atualizar `api-cobranca/src/whatsapp/transport/README.md`, `infra/interserver/DATAFY.md` e `infra/interserver/api.env.example` para refletir variáveis de onboarding descontinuadas e operação atual. Se o runbook precisar viajar no tarball, incluir explicitamente seu caminho em `infra/interserver/package.ps1`.

**Interfaces:** `TemplateTransitionService.preflight(): Promise<{ canApply: boolean; blockers: string[]; counts: Record<string, number> }>` e `apply(): Promise<{ archivedTemplates: number; blockedSends: number; preservedUncertain: number }>`; CLI `--preflight` é somente leitura e funciona no schema anterior esperado, `--apply` exige as novas migrations e canal pausado, `--verify` confirma invariantes sem modificar dados. Bootstrap mínimo sem cron, workers ou `AppModule`.

- [ ] Criar ensaio com template interno, referência EMAIL, dois idiomas, etapa tentada, intenção `PENDING`, `ACCEPTED` e `UNCERTAIN`. Testar:

  ```js
  assert.equal(after.activeLegacyWhatsappTemplates, 0);
  assert.equal(after.automaticGrants, 0);
  assert.deepEqual(after.financialRows, before.financialRows);
  assert.deepEqual(after.acceptedAndUncertain, before.acceptedAndUncertain);
  assert.equal(secondApply.archivedTemplates, 0);
  assert.equal(secondApply.blockedSends, 0);
  ```

- [ ] Rodar teste de transição e confirmar as falhas. Implementar preflight com consultas compatíveis com o banco anterior, sem imprimir env/conteúdo de mensagens. Conferir a migration anterior `20260927130000_collection_rules_global_templates`, dependências EMAIL e intenções em andamento. Para definições EMAIL conhecidas ainda não persistidas, a listagem existente `GET /email/templates` chama `EmailTemplatesService.findAll(companyId)` e prepara esse catálogo. Usar esse caminho na API anterior, conferir o conteúdo efetivo e repetir preflight antes de parar a API e fazer o backup final. Slug desconhecido/ambíguo continua bloqueando; não concluir conversão aproximada.
- [ ] `--apply` arquiva os templates internos e marca WhatsApp legado como `UNCONFIGURED`, conservando referências históricas e finalidade reconhecida. Não cria grants/defaults. Intenções antigas comprovadamente não enviadas viram pendências; aceitas/incertas permanecem intactas. Recusar operação enquanto houver envio em andamento; aguardar o ciclo de lease/triagem em vez de alterar `SENDING`. A conversão deve ser idempotente e auditável, sem exclusão geral do banco/Redis. Defaults novos não soltam jobs antigos.
- [ ] Executar testes integrados e regressão, uma vez após fechar as alterações; repetir somente se houver mudança/falha relevante. Comandos de fechamento:

  ```powershell
  npm --prefix api-cobranca test -- --runInBand
  npm --prefix api-cobranca run build
  npm --prefix api-cobranca exec -- eslint "src/**/*.ts" "test/**/*.ts"
  npm --prefix front-cobranca exec -- jest --runInBand
  npm --prefix front-cobranca run build
  npm --prefix front-cobranca run lint
  ```

  Em `api-cobranca`, executar os runners PostgreSQL de e-mail, catálogo, pendências e transição, depois `node test/e2e-disposable.cjs template-access.e2e-spec.ts template-resume.e2e-spec.ts template-catalog-flow.e2e-spec.ts datafy-communications.e2e-spec.ts`. O runner injeta PostgreSQL/Redis novos; impedir chamadas reais de Datafy/Efí/Resend por mocks de transporte. Atualizar testes antigos cujas expectativas legitimamente mudaram, preservando isolamento, histórico e entrega incerta. Lint do backend é chamado sem `--fix` para a conferência final não alterar arquivos.
- [ ] Validar o fluxo completo com A/B: admin importa → mapeia → libera só A → A escolhe na régua → B recebe negativa → revogação bloqueia → correção sozinha não envia → admin revisa → fatura paga não envia → fatura elegível produz uma transmissão. Testar restauração e repetição da migração. Fazer busca dos antigos caminhos de submissão/semeadura/fallback para garantir que nenhum permanece ativo.
- [ ] Escrever runbook com os passos abaixo, comandos exatos, saída esperada e condição de parada. Usar os scripts existentes de pacote/Compose/backup; distinguir PowerShell local do shell Ubuntu remoto. Não executar o deploy ao escrever o plano.

### Conteúdo obrigatório do runbook da tarefa 15

1. Conferir branch/commit final e testes; gerar pacote por `infra/interserver/package.ps1`, contendo migrations/scripts e `RELEASE`. Nenhum `.env`, certificado ou frontend no pacote. Enviar para pasta nova na VPS e comparar SHA256 entre Windows e Linux.
2. Desativar o canal central WhatsApp pelo controle administrativo existente (`PlatformIntegrationState`, integração interna ainda chamada `META`). Conferir que não surgem novos envios, aguardar os em andamento e preservar o acesso SSH atual. Não alterar certificados, DNS ou configurações Efí para esta feature.
3. Build da imagem nova, validação do env e execução isolada de `node dist/scripts/transition-whatsapp-templates.js --preflight`. O relatório é diagnóstico, sem escrita. Concluir as dependências identificadas antes das migrations. O script não inicia a API.
4. Parar a API antiga para impedir cron/produtores durante a troca. Criar backup consistente com `backup.sh`, incluir secrets/env e anexos cifrados conforme os procedimentos existentes, verificar hashes, restaurar em banco isolado e copiar uma cópia protegida para fora da VPS. Conferir que o backup corresponde ao instante anterior às migrations.
5. Executar `prisma migrate status`, `prisma migrate deploy` e `prisma migrate status` usando `compose.sh run --rm --no-deps api`. Usar nomes/saídas observados, não assumir número fixo de migrations. Qualquer erro interrompe a sequência; não usar `migrate dev`, reset ou seed amplo na VPS.
6. Executar `node dist/scripts/transition-whatsapp-templates.js --apply` e `--verify` no container de comando. Esperado: catálogo interno arquivado, e-mail íntegro, zero grants automáticos, jobs antigos impedidos, históricos preservados. Guardar somente relatório sem dados sensíveis.
7. Subir API nova, verificar saúde e recarregar Nginx conforme o procedimento existente. Publicar frontend correspondente em `main`/domínio principal da Vercel. Continuar com WhatsApp pausado enquanto testa telas e isolamento.
8. Fazer consulta real de catálogo pelo Datafy, sem envio. Registrar apenas metadados necessários: template aprovado, idioma, formato de parâmetros e componentes. Conferir que a implementação interpreta o template real; se for incompatível, mostrar diagnóstico em vez de alterar texto no código. Teste de autenticação sozinho não comprova esse contrato.
9. Mapear variáveis, conferir prévia, liberar empresas de teste e padrões, ajustar régua e revisar pendências legadas. Antes de habilitar o canal, verificar que não existe trabalho legado reenviável. Realizar um envio explicitamente acionado para destinatário controlado e conferir aceitação/status/webhook; nenhuma cobrança ou mensagem real é disparada automaticamente pelo runbook.
10. Acompanhar erros e pendências por códigos/IDs, última reconciliação, fila e conflitos. Em falha, pausar WhatsApp primeiro. Não voltar só a imagem quando houver schema/payload novos. Restauração requer janela controlada; se houve transmissão, conciliar IDs aceitos/incertos para que o backup não ressuscite envios. O guia deve separar correção adiante, reversão antes de qualquer envio e recuperação após envio.

- [ ] Commit final de documentação/testes: `test: verify template catalog rollout and recovery`. Revisar o diff completo, registrar testes executados e limitações reais. Não marcar publicação concluída sem evidência da VPS e da Vercel.

## Cobertura da especificação e conclusão

| Exigência da especificação | Tarefas que a entregam |
| --- | --- |
| Catálogo Meta via Datafy e sincronização | 2, 3, 10, 12 |
| Mapeamento, prévia e formatos suportados | 2, 4, 12 |
| Grants e padrões por empresa | 5, 10, 12, 13 |
| Régua e preservação do e-mail | 1, 8, 13, 15 |
| Bloqueio efetivo sem fallback | 6, 7, 8 |
| Retomada manual sem duplicação | 6, 7, 9, 14 |
| Inbox, empresa explícita e janela de 24h | 7, 11 |
| Dados atuais, histórico e publicação | 1, 6, 8, 15 |

Uma etapa está pronta quando seus testes demonstram o comportamento, não apenas quando a tela existe. A feature está pronta para publicação quando todo o fluxo passa com duas empresas e não restam caminhos de envio que dispensem a nova autorização. O deploy e o teste real do provedor são verificações operacionais separadas da conclusão do código.

## Handoff de execução

O plano deve ser revisado antes de implementar. Métodos possíveis: execução direta nesta conversa, com revisão independente ao final, ou execução por subagentes com revisão a cada tarefa. Para este plano, recomenda-se subagentes por tarefa com integração sequencial e interfaces compartilhadas, devido às mudanças de permissão e estado de envio; isso consome mais contexto. Não delegar tarefas que alteram schema, contratos ou dispatcher simultaneamente sem dependências concluídas.
