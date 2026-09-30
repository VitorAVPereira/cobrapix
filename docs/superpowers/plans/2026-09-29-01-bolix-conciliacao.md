# Bolix e conciliação — plano de implementação

> Para execução por agente: usar `superpowers:executing-plans` por tarefa. Este documento é planejamento; não autoriza emissão real ou execução em produção. Delegação somente quando autorizada. Acompanhar os passos pelos checkboxes.

**Objetivo:** explicar os erros de emissão, distinguir rejeição de resultado incerto e recuperar cobranças existentes sem duplicação.

**Arquitetura:** manter a reserva idempotente de `PaymentCharge` e a conta emissora histórica. Separar classificação de falha, normalização da resposta e aplicação transacional do resultado. A conciliação consulta a Efí; não chama a criação de cobrança.

**Tecnologias:** NestJS, TypeScript, Prisma/PostgreSQL, SDK Efí, Jest e frontend Next.js.

**Especificação:** [contexto e decisões](../specs/2026-09-29-correcoes-testes-producao-design.md).

## Restrições globais

- Aplicam-se integralmente as nove restrições da especificação.
- `unverifiedStepsAcknowledged` continua sendo ciência auditada, não erro nem validação bem-sucedida de split.
- `Invoice.PENDING` pode representar fatura aguardando pagamento; `PaymentCharge.ACTIVE` representa instrumento emitido. Não confundir com `PaymentCharge.PENDING`, cuja emissão ainda não foi concluída localmente.
- Falha genérica, timeout, resposta incompleta, ausência de ID ou falha de persistência após envio não provam que a Efí deixou de criar a cobrança.
- Nenhuma troca automática de BOLIX por boleto tradicional ou PIX.
- Não introduzir migração neste plano por padrão: aproveitar `PaymentChargeStatusHistory.sanitizedDetails` para os diagnósticos. Se o contrato exigir nova estrutura, justificar e revisar uma migration aditiva antes de executá-la.

## Pontos de revisão

1. A Efí aceitou a emissão, mas a conexão caiu antes da resposta — F2/F4: permanecer incerta, sem segundo POST.
2. O webhook confirmou pagamento enquanto a conciliação consultava um estado anterior — F3/F4: nunca voltar de pago para ativo/pendente.
3. O administrador trocou a conta do cliente depois da emissão — F3: consulta continua na identidade emissora original.
4. Dois cliques tentam recuperar ou associar a mesma cobrança — F3/F4: uma associação e um histórico coerente, sem duplicação.
5. R$ 3,00 e R$ 5,00 aparecem pendentes, mas o motivo original não foi preservado — F1/F5: mostrar limite da evidência; não atribuir causa a valor mínimo sem comprovação.

## F1. Produzir diagnóstico somente leitura das duas ocorrências

**Arquivos:** consultar `api-cobranca/src/payment/payment-admin.controller.ts`, `efi.service.ts`, `payment.service.ts`, `payment-charge.service.ts`; atualizar ao final `docs/operations/financial-activation.md` com o procedimento reproduzível, sem dados de clientes.

**Entrada:** prefixos `dfcfed91` e `06c5f13e`, empresa e conta emissora correspondentes. **Saída:** ficha de diagnóstico por emissão, em registro operacional protegido; não commitar exportação de produção.

- [ ] Resolver os IDs completos e registrar somente: empresa, fatura, tentativa, estado local, horários com fuso, modalidade, valor em centavos, identidade/versão emissora, existência de referência externa e códigos sanitizados do histórico.
- [ ] Correlacionar logs de emissão, job e histórico. Se o código antigo perdeu o erro original, registrar explicitamente “motivo original não preservado”.
- [ ] Consultar a Efí usando a conta que emitiu, por referência persistida. Sem referência, conferir o painel da conta e solicitar localização à Efí se necessário; não emitir para testar a hipótese.
- [ ] Verificar existência, identificador, valor, modalidade retornada, status, boleto, Pix e configuração de split observável. Não declarar split recebido apenas porque a emissão existe.
- [ ] Classificar cada caso: rejeição comprovada; emissão existente recuperável; divergência de modalidade; resultado ainda incerto. A ausência visual no painel, isoladamente, não comprova que a requisição nunca foi aceita.

**Aceite:** o relatório distingue fatos de hipóteses e informa a próxima ação sem pedir repetição da emissão. A implementação das melhorias pode prosseguir se o diagnóstico externo ainda estiver pendente.

## F2. Classificar e registrar falhas sem expor dados sensíveis

**Criar:** `api-cobranca/src/payment/efi-issuance-error.ts` e `efi-issuance-error.spec.ts`.

**Modificar:** `efi.service.ts`, `payment.service.ts`, `payment-charge.service.ts`; ampliar `efi.service.spec.ts`, `payment.service.spec.ts` e `payment-charge.service.spec.ts`.

**Contrato proposto:** `classifyEfiIssuanceError(error: unknown, stage: IssuanceStage): IssuanceFailure`. Estágios: `PRE_SUBMISSION`, `PROVIDER_REQUEST`, `PROVIDER_RESPONSE`, `LOCAL_PERSISTENCE`. Resultado com `kind: 'REJECTED' | 'UNCERTAIN'`, `code`, `stage`, `httpStatus: number | null`, `providerCode: string | null` e mensagem local segura. Não devolver o objeto original.

- [x] Inspecionar a versão instalada do SDK e capturar o formato de erro por fixtures sintéticas: rejeição estruturada, autenticação, validação, timeout, reset de conexão, resposta malformada e erro local depois da resposta. Não pressupor que uma propriedade `status` sempre seja HTTP.
- [x] Escrever testes que exijam: rejeição comprovada retorna `REJECTED`; timeout/5xx desconhecido/erro sem formato conhecido retornam `UNCERTAIN`; falha de persistência após aceitação também permanece incerta; resposta não vaza certificado, Authorization, payload ou dados do pagador.
- [ ] Executar `npm test -- --runInBand efi-issuance-error` em `api-cobranca` e confirmar falha pelos comportamentos novos.
- [x] Implementar o classificador por evidência. Uma rejeição precisa provar que a criação foi recusada na etapa relevante. Não tratar todo HTTP 4xx como autorização genérica para repetir operações de múltiplas etapas.
- [x] Substituir o descarte indiscriminado do erro em `runIssuanceRequest`. Preservar `EFI_SUBMISSION_UNCERTAIN` para resultados incertos, adicionando código distinto para rejeição comprovada. Manter resposta HTTP coerente com erro de negócio versus dependência indisponível.
- [x] Registrar diagnóstico sanitizado no histórico da tentativa, dentro da transação que altera seu estado. Rejeição comprovada pode terminar em `FAILED`; incerteza preserva a reserva em `PENDING`. Quando apenas o diagnóstico mudar, registrar o evento sem simular uma nova emissão.
- [x] Manter a possibilidade de corrigir um dado e solicitar nova tentativa pelo fluxo existente após rejeição comprovada. Não criar retry automático de emissão no catch.
- [x] Executar `npm test -- --runInBand efi-issuance-error payment.service payment-charge.service` e os testes Efí afetados. Commit sugerido: `fix: distinguir rejeicao de emissao incerta na Efi`.

**Aceite:** um erro conhecido aparece com causa útil; uma falha ambígua continua protegida contra duplicidade e tem diagnóstico rastreável.

## F3. Recuperar emissão confirmada e ainda pagável

**Criar:** `api-cobranca/src/payment/efi-charge-normalizer.ts` e `efi-charge-normalizer.spec.ts`.

**Modificar:** `efi.service.ts`, `payment-charge.service.ts`, `payment.service.ts`, `payment-reconciliation.spec.ts`, `efi-boleto-mode.spec.ts`; registrar providers no `payment.module.ts` apenas se a implementação exigir injeção nova.

**Contratos propostos:**

- `normalizeEfiChargeDetail(raw: unknown): EfiChargeObservation`: extrai referência externa, `custom_id`, status, valor, modalidade, instrumentos e datas da resposta de consulta. Campos ausentes permanecem ausentes; não usar conversões que transformem valor inválido em zero.
- `PaymentChargeService.confirmIssuance(companyId, chargeId, observation): Promise<'ACTIVE' | 'ALREADY_FINALIZED'>`: confirma dados normalizados com locks, histórico e atualização de fatura na mesma transação.
- `reconcileCharge(companyId, chargeId, actorId)`: manter `status` da resposta existente e acrescentar `reasonCode` e `recommendedAction` quando necessário. Estados não recuperáveis continuam `REVIEW_REQUIRED`.

- [x] Criar fixtures sintéticas separadas para resposta de criação e resposta de consulta. Elas possuem estruturas diferentes; não reutilizar cegamente o parser da criação para o detalhe.
- [x] Acrescentar testes: Bolix existente em estado pagável, boleto sem Pix quando foi solicitado Bolix, referência/valor/conta incorretos, consulta indisponível, estado desconhecido, já pago e já cancelado. Conferir que nenhum cenário de conciliação chama `createOneStepCharge`.
- [ ] Rodar `npm test -- --runInBand payment-reconciliation efi-boleto-mode efi-charge-normalizer` e registrar a falha esperada para recuperação de emissão pagável.
- [x] Normalizar o detalhe e conferir referência, identidade emissora, valor, vínculo interno e modalidade antes de disponibilizar instrumentos. Se dados necessários não forem comprováveis, manter revisão com motivo específico.
- [x] No estado emitido e pagável, completar os campos de `Invoice` e `PaymentCharge`, persistir `ACTIVE`, `issuedAt` e histórico atomicamente. Aproveitar a mesma operação de persistência para confirmação normal após emissão, movendo para ela as gravações hoje separadas da fatura e preservando os contratos existentes de PIX e boleto. A referência externa já recebida deve continuar recuperável se a confirmação completa falhar.
- [x] Sob lock, reler o estado local e não sobrepor liquidação/cancelamento já aplicados por webhook. Preservar taxas, snapshot de split, vínculo e identidade histórica. Pagamento encontrado na consulta utiliza a rotina idempotente de baixa existente.
- [x] Persistir a divergência de modalidade com descrição compreensível. Não distribuir instrumentos incorretos nem declarar uma emissão compatível apenas porque existe `charge_id`.
- [x] Executar os testes focados e preparar o teste transacional da F4. Commit sugerido: `fix: recuperar emissao confirmada durante conciliacao`.

**Aceite:** uma emissão existente com identificação e instrumentos válidos sai da pendência sem novo POST financeiro; o pagamento já confirmado não é revertido por uma consulta concorrente.

## F4. Tratar ausência de referência e provar concorrência

**Modificar:** `payment-admin.controller.ts`, `efi.service.ts`, testes de conciliação e controller. **Criar:** `api-cobranca/test/payment-issuance-recovery.e2e-spec.ts`.

**Contrato proposto:** operação administrativa `POST /admin/payment-charges/:companyId/:chargeId/reconcile-reference`, corpo `{ providerChargeId: string, evidenceReference: string }`. É uma associação verificada por consulta, não um campo que força sucesso. Usar JWT, `PlatformAdminGuard`, validação do DTO e auditoria existente. Criar DTO em `api-cobranca/src/payment/dto/reconcile-reference.dto.ts`.

- [x] Para tentativa sem identificador, devolver `MISSING_PROVIDER_REFERENCE` e orientar localização da emissão na conta original. Não prometer busca por `custom_id` até confirmar que a API oferece esse recurso.
- [x] Implementar a associação administrativa somente quando o ID foi localizado. Antes de gravar, consultar por esse ID com a conta original e exigir correspondência de `metadata.custom_id` com a tentativa, valor, ambiente e modalidade. Se a Efí não retornar prova suficiente do vínculo, recusar associação automática e manter revisão.
- [ ] Auditar autor, tentativa, referência externa consultada, referência da evidência e resultado. Não registrar screenshot, documento ou payload sensível no JSON do evento.
- [ ] Criar teste real em PostgreSQL descartável: duas emissões concorrentes para a mesma fatura produzem uma única reserva/chamada externa; duas associações concorrentes não vinculam o mesmo ID a faturas diferentes.
- [ ] Injetar falha entre gravação de instrumentos e transição; conferir rollback local, preservação da referência já conhecida e recuperação por consulta posterior.
- [ ] Executar conciliação simultânea a webhook de pagamento; conferir estado final pago, sem cobrança/baixa/lançamento duplicado. Simular SDK localmente, sem credenciais reais.
- [ ] Executar, em `api-cobranca`, `node test/e2e-disposable.cjs payment-issuance-recovery.e2e-spec.ts`. O runner deve criar seu próprio PostgreSQL e Redis e passar todos os cenários.
- [x] Documentar que uma tentativa ainda incerta, sem referência nem prova do resultado, permanece bloqueada até evidência suficiente da Efí. Não oferecer botão genérico “tentar novamente”. Commit sugerido: `fix: verificar referencias de emissao e concorrencia`.

**Aceite:** existe caminho auditável para vincular uma emissão localizada e existe comportamento explícito para casos que o sistema ainda não consegue comprovar.

## F5. Tornar a operação compreensível no administrador

**Modificar:** `api-cobranca/src/payment/payment-admin.controller.ts`; `front-cobranca/src/components/features/financial-activation/OperationsPanel.tsx`, `FinancialHistoryPanel.tsx` e respectivos testes; `docs/operations/financial-activation.md`.

**Contrato:** conservar os campos atuais de `attention`; acrescentar classificação, código seguro, estágio e ações disponíveis. Incluir rejeições recentes diagnosticadas, limitadas às últimas 100 tentativas dos últimos 30 dias; pendências ainda abertas não expiram por essa janela. Não confundir esse painel com a conciliação dos repasses.

- [x] Exibir rótulos distintos: “Emissão rejeitada”, “Confirmação da emissão pendente”, “Modalidade diferente da solicitada”, “Emitida — aguardando pagamento” e “Referência da Efí necessária”.
- [x] Mostrar motivo conhecido, horário/fuso, último resultado de consulta e ação permitida. Registros antigos sem diagnóstico devem dizer “Motivo original não registrado”.
- [x] Expor a associação da F4 somente para referência ausente. Após consulta bem-sucedida, atualizar a tela; resultado `REVIEW_REQUIRED` não deve virar aviso verde de sucesso.
- [x] No histórico da ativação, substituir o JSON como explicação principal por “Você confirmou que emissão e split do Bolix ainda precisam de comprovação em uma operação real”. Manter versão e detalhe técnico consultáveis.
- [x] Testar seleção de ação por motivo, erro ao consultar, duplo clique, vínculo recusado e ausência de informações sensíveis. Executar em `front-cobranca`: `npx jest --runInBand OperationsPanel FinancialHistoryPanel`.
- [x] Atualizar runbook com árvore de decisão rejeição/certeza/modalidade e diferenciação entre emissão, pagamento e split. Commit sugerido: `fix: esclarecer pendencias de emissao no painel admin`.

## Validação final desta frente

- [x] Em `api-cobranca`: `npm test -- --runInBand`, `npm run build` e ESLint sem `--fix` nos arquivos alterados.
- [x] Em `front-cobranca`: testes afetados, `npm run build` e lint dos arquivos alterados.
- [ ] Executar o E2E descartável da F4 uma vez após a versão final, repetindo somente se houver alteração relevante ou falha.
- [ ] Reavaliar as duas ocorrências reais sem reemissão automática. Documentar resolvida ou dependente de confirmação externa, com evidência correspondente.

## Registro de execução (29/09/2026, branch `fix/bolix-conciliacao`)

**Causa provável encontrada no código (fato do código; falta a confirmação na produção):**
`buildBoletoCustomer` enviava `phone_number` com o telefone do devedor como está
gravado para o WhatsApp (`+55DDDNÚMERO` → 12–13 dígitos). A Efí valida esse campo
com `^[1-9]{2}9?[0-9]{8}$` (DDD + número, sem o 55) e responde `validation_error`
antes de criar a cobrança. Todo devedor cadastrado pelo fluxo atual cai nesse
caso, independentemente do valor, o que é compatível com as duas ocorrências. O
teste existente usava `+5511999999999` mas não conferia o telefone. O endereço
também caía em placeholders (`Nao informado`, CEP `00000000`) quando o cadastro
da empresa estava incompleto. O valor mínimo (R$ 3,00/R$ 5,00) continua sem
evidência como causa.

**Desvios do plano:**
- F4: a API de Cobranças oferece `GET /v1/charges` com filtro `custom_id`
  (SDK 1.2.28, `listCharges`). Em vez do endpoint manual `reconcile-reference`,
  a conciliação localiza a cobrança pelo `custom_id` na conta emissora, confirma
  pelo detalhe (`custom_id` e valor) antes de gravar a referência, e só declara
  ausência para tentativa aberta com mais de 30 minutos quando a Efí responde.
- Pix `ATIVA` sem confirmação local continua em revisão
  (`PIX_SPLIT_LINK_UNVERIFIED`): o detalhe da CobV não comprova o vínculo do split.
- Testes da F2/F3 foram escritos junto com a implementação; a falha prévia não
  foi registrada (itens 54 e 77 abertos).
- Auditoria da conciliação: autor/horário em `AuditLog`, motivo em
  `PaymentChargeStatusHistory`; a referência consultada fica na própria tentativa.

**Validação:** `api-cobranca` 796 testes, build e ESLint dos arquivos alterados;
`front-cobranca` 201 testes, build e ESLint dos arquivos alterados. O E2E
`test/payment-issuance-recovery.e2e-spec.ts` foi escrito e tipado, mas **não
executado** (Docker Desktop parado nesta máquina).

**Pendente:** F1 na produção (runbook, seção 5.5), deploy, conciliação das duas
tentativas pelo painel e nova emissão controlada.
