# Cartão de crédito — plano de desenvolvimento para revisão

> **Para execução por agente:** usar `superpowers:executing-plans` por tarefa, após revisão da proposta técnica da especificação. Regras de negócio confirmadas; validações Efí e operacionais são a primeira etapa. Acompanhar os passos pelos checkboxes. Implementação autorizada posteriormente pelo usuário e executada localmente. Migração validada somente em banco descartável; não foram feitas chamadas financeiras reais nem publicação.

**Objetivo:** emitir cobranças exclusivas de cartão pela empresa e permitir pagamento no link público em até 6x, com custo Efí repassado ao pagador e preservação integral de Pix/Bolix.

**Arquitetura:** cobrança local na emissão; cotação autoritativa no backend e tokenização no navegador; submissão financeira somente após confirmação. Reutilizar conta emissora, link assinado, comunicação e conciliação existentes, com fluxo financeiro específico de cartão.

**Tecnologias:** Next.js 16, React 19, NestJS 11, Prisma 7/PostgreSQL, BullMQ/Redis, SDK Efí existente e biblioteca frontend `payment-token-efi`.

**Especificação:** [Cartão de crédito — regras, fluxo e decisões complementares](../specs/2026-10-06-cartao-de-credito-design.md).

## Restrições globais

- Opção B: a empresa escolhe cartão na emissão. Escolha entre formas de pagamento pelo pagador está fora do escopo.
- Parcelamento em até 6x; oferecer somente as opções efetivamente permitidas pela Efí para a conta, bandeira e valor.
- O pagador arca somente com os custos de cartão da Efí, incluindo parcelamento; a tarifa CifraMais é descontada da empresa.
- Aplicar multa e juros de atraso quando configurados na fatura.
- Juros por atraso simples, com taxa mensal dividida por 30 e proporcional aos dias de atraso; não aplicar juros compostos.
- Aplicar descontos automáticos pela mesma regra existente de empresa/devedor, respeitando elegibilidade, percentual e prazo. Não criar uma regra independente para cartão.
- Repassar a remuneração CifraMais por split automático, sem fallback para repasse manual.
- Remuneração CifraMais usa os percentuais atuais de taxa no prazo/taxa recuperada somente sobre o principal após descontos. Multa, juros por atraso e acréscimo Efí não compõem sua base.
- Nenhuma alteração na regra financeira de Pix ou Bolix.
- Preservar token assinado de 90 dias e links existentes; GET nunca submete pagamento.
- Conta Efí da empresa; conta emissora da plataforma permanece bloqueada.
- Dados de cartão tokenizados somente no navegador; nenhum PAN/CVV no backend/banco/logs.
- Tests com provedores simulados e banco/Redis descartáveis. Não usar ambiente compartilhado ou VPS.
- Resposta incerta não é reenviada; split configurado não é split recebido.
- Frontend sem Prisma; migrations aditivas; alterações de dependências limitadas à biblioteca necessária à tokenização.

## Foco da revisão

1. Cotação atravessa a meia-noite ou recebe novo valor de dívida: exigir nova confirmação sem submeter preço antigo (tarefas 3 e 5).
2. Duplo clique, duas abas ou reentrega da requisição: apenas uma submissão por cobrança/tentativa (tarefas 4 e 7).
3. Credenciais/conta atuais mudam após emissão: continuar usando a conta emissora fotografada (tarefas 2, 4 e 6).
4. Retorno 200 com recusa/aprovação provisória ou webhook fora de ordem: não pagar indevidamente nem liberar nova tentativa enquanto há resultado incerto (tarefas 4 e 6).
5. Total inclui tarifa Efí: remuneração CifraMais usa base explícita e os demais métodos conservam a base atual (tarefas 3, 6 e 7).

## Mapa de arquivos e responsabilidades

Arquivos novos propostos no backend:

- `src/payment/card-amounts.ts`: principal, encargos, base de remuneração e datas civis.
- `src/payment/efi-card.client.ts`: parcelas/submissão/consulta de cartão e normalização dos valores Efí.
- `src/payment/card-payment.service.ts`: emissão local, cotação, tentativa e idempotência.
- `src/payment/dto/card-payment.dto.ts`: contratos públicos com campos permitidos.
- Specs correspondentes; `test/card-checkout.e2e-spec.ts` para concorrência com infraestrutura descartável.

Frontend novo: `src/app/pagar/[signedToken]/CardCheckout.tsx` e teste correspondente. Reutilizar página pública e módulos existentes.

Não dividir ou reescrever `efi.service.ts` integralmente. Registrar o adaptador de cartão no módulo existente. Os caminhos abaixo são relativos ao respectivo projeto dentro de `cobrapix/`.

## Tarefa 1 — validar cálculo Efí e contratos financeiros

**Arquivos:** especificação acima; criar `docs/implementation/efi-card-validation.md` com cenários, resultados e origem das taxas, sem credenciais ou dados pessoais.

**Entrega:** contrato financeiro verificado que as tarefas seguintes implementam. Esta etapa bloqueia execução das tarefas financeiras enquanto houver ambiguidade.

- [x] Registrar decisões de produto: descontos existentes; split automático; base CifraMais somente sobre o principal após descontos; juros simples com taxa mensal dividida por 30 e proporcional aos dias de atraso. Nenhuma implementação está incluída neste item concluído.
- [x] Conferir SDK instalado e schema de parcelas/submissão de cartão com split, sem atualizar dependências vizinhas.
- [x] Documentar para 1x, 2x e 6x: principal, multa/juros, tarifa de processamento, custo de parcelamento, valor dos itens enviado à API, total, parcelas, líquido da empresa e split.
- [x] Verificar que juros já retornados pela Efí não são acrescentados duas vezes; registrar origem da tarifa contratual e arredondamento.
- [x] Criar fixtures simuladas representativas e testes do adaptador. Homologação externa somente como ação operacional explicitamente autorizada, sem movimentação real nesta demanda.
- [ ] Definir procedimento suportado para estorno de split e política para `approved` versus `paid`, antes da habilitação.
- [x] Revisar e registrar as conclusões em um commit documental quando a execução for autorizada.

## Tarefa 2 — representar cartão, reserva local e capacidade da conta

**Modificar:** `api-cobranca/prisma/schema.prisma`, policies `src/payment/billing-method-policy.ts`, `src/financial-activation/financial-activation.types.ts`, `src/financial-activation/financial-eligibility.service.ts`, `src/payment/payment-charge.service.ts`, `src/payment/payment.service.ts`, `src/payment/payment.module.ts`, DTOs de emissão `src/invoices/dto/invoice.dto.ts` e consumidores necessários de `BillingMethod`.

**Criar:** migration aditiva `add_credit_card_checkout`; modelos `CardPaymentQuote` e `CardPaymentAttempt` na migration/schema. Guardar referências à cobrança/empresa, validade, valores fotografados, idempotência e estado da tentativa. Não guardar dados brutos de cartão.

**Interfaces:** `CardPaymentService.prepareCharge(companyId, invoiceId): Promise<InvoicePaymentPage>` usa perfil ativo e cria reserva local. Consome `PublicPaymentLinkService.createInvoicePaymentPage`. Não chama Efí para debitar.

- [ ] Testar antes da implementação: `CREDIT_CARD` habilitado permite reserva; conta não habilitada bloqueia; fatura de outra empresa retorna 404; fatura encerrada bloqueia; segunda emissão reutiliza reserva compatível.
- [ ] Confirmar falha desses testes pela ausência de suporte; implementar o fluxo mínimo com travas da fatura e fotografia da conta/perfil.
- [ ] Adicionar `CREDIT_CARD` ao enum e modelos específicos sem alterar enum/semântica dos estados globais; preservar campos antigos.
- [ ] Preservar cobranças existentes, credenciais vinculadas e guardas de resultado incerto. Deixar cartão desabilitado inicialmente para todas as empresas.
- [ ] Rodar specs das policies/ativação/reserva; aplicar migration somente em PostgreSQL descartável e testar defaults/relacionamentos entre empresas.
- [ ] Fazer commit da entrega após verificações.

## Tarefa 3 — cotação e cálculo em centavos

**Criar:** `api-cobranca/src/payment/card-amounts.ts`, `card-amounts.spec.ts`, `efi-card.client.ts`, `efi-card.client.spec.ts`, `dto/card-payment.dto.ts`, `card-payment.service.ts` e specs.

**Interfaces:** `calculateCardDebt(input: CardDebtInput): CardDebtAmounts`; `EfiCardClient.quote(accountRef, debtCents, brand): Promise<EfiCardQuote[]>`; `CardPaymentService.quote(token, brand): Promise<CardQuoteResponse>`.

`CardDebtInput`: principal em centavos, vencimento comercial, data da cotação, taxas da fatura e desconto aplicável pela regra existente. `CardDebtAmounts`: principal, desconto, multa, juros, base da dívida e base CifraMais. `EfiCardQuote`: parcelas, valor de submissão, total do pagador, valores das parcelas, custo Efí e evidência/versionamento da tarifa. `CardQuoteResponse`: ID/validade, componentes e opções oferecidas. Fixar tipos no código desta tarefa antes de usá-los nas seguintes.

- [ ] Escrever testes da regra aprovada: sem atraso, dia do vencimento, primeiro dia de atraso, ausência explícita de taxas, fim de mês e mudança de dia civil.
- [ ] Testar desconto herdado da empresa, regra própria do devedor, desconto desabilitado, limite exato de elegibilidade e expiração entre cotação e confirmação. Assertar o mesmo desconto do fluxo existente e nova confirmação quando a elegibilidade mudar.
- [ ] Testar `platformFeeBaseCents = principalCents - discountCents`: principal 10000, desconto 1000, multa/juros 500 e percentual 200 bps produzem base 9000, dívida 9500 e split 180 centavos; alterar encargos/custo Efí não altera o split. Fotografar base e resultado na tentativa.
- [ ] Testar a convenção confirmada: `lateInterestCents = round(principalCents * lateInterestMonthlyBasisPoints * daysLate / 300000)`; dias de atraso zero antes e no vencimento. Principal 10000, multa 200 bps, juros 100 bps/mês e 15 dias de atraso produzem multa 200, juros 50 e dívida 10250 centavos, sem desconto. Testar meses de 28/29/31 dias mantendo divisor 30, taxa zero e arredondamento de meio centavo.
- [ ] Testar tarifa incidindo sobre total aumentado, juros Efí já incluídos, mínimo de parcela, retorno com 12 opções filtrado até 6, arredondamento e configuração contratual ausente.
- [ ] Implementar cotação autoritativa e persistida por 10 min, limitada ao próximo dia civil e prazo final; invalidar por mudança de valor/conta/versão.
- [ ] Não reutilizar o cálculo genérico de Pix/Bolix para alterar sua incidência. Documentar eventual configuração adicional necessária exclusivamente ao cartão.
- [ ] Rodar specs de cálculo/adaptador e os testes atuais de `payment-fees`; fazer commit.

## Tarefa 4 — submissão pública idempotente

**Modificar:** `api-cobranca/src/payment/public-payment.controller.ts`, `payment-link.service.ts`, `payment.module.ts`; completar `card-payment.service.ts`, adaptador e DTOs da tarefa 3.

**Interfaces:** `CardPaymentService.pay(token, input: CardPayInput, idempotencyKey): Promise<CardPayResponse>`. Entrada e rotas conforme especificação; saída contém identificador local e estado, sem token do cartão. `EfiCardClient.submit(accountRef, attempt): Promise<CardSubmissionResult>`; retorno normaliza `charge_id`, estado, total e motivo permitido de recusa.

- [ ] Testar token adulterado/expirado, cobrança de Pix/Bolix, conta incorreta, preço enviado no body, parcelas 0/7, cotação inválida e fatura cancelada após cotação: zero submissões.
- [ ] Testar duas requisições concorrentes, chave idempotente repetida e chave repetida com payload diferente; assertar uma chamada Efí e conflito para payload incompatível.
- [ ] Persistir tentativa e reserva antes da chamada externa; usar `metadata.custom_id` determinístico e URL de notificação vinculada à conta emissora.
- [ ] Implementar submissão em um passo após confirmação, com split automático calculado sobre a base aprovada; testar valor e conta beneficiária CifraMais no payload. Erro de split bloqueia submissão, sem repasse manual como fallback. Não manter transação de banco aberta durante chamada de rede.
- [ ] Testar 200/`unpaid`, 200/`approved`, `waiting`, timeout e retorno malformado. Resultado incerto preserva reserva e exige consulta; nenhuma reemissão automática.
- [ ] Testar ação explícita após recusa comprovada; reutilizar retry apenas nas condições definidas na especificação. Mudança do total exige novo ciclo confirmado e encerramento comprovado da transação anterior.
- [ ] Aplicar limite de tentativas e proteção de origem às mutações públicas; respostas e logs sem segredos. Rodar specs do controlador/serviço; fazer commit.

## Tarefa 5 — checkout, emissão e comunicação

**Modificar frontend:** `src/app/pagar/[signedToken]/page.tsx`, `load-payment.ts`, `PaymentPageClient.tsx`, `src/app/(dashboard)/cobrancas/page.tsx`, `configuracoes/cobranca/page.tsx`, `devedores-recorrentes/page.tsx`, `src/lib/billing-fees.ts` e tipos/seletores necessários.

**Criar frontend:** `CardCheckout.tsx`, `CardCheckout.test.tsx`. Adicionar somente `payment-token-efi` ao frontend para tokenização; ler guias locais do Next.js antes de implementar.

**Modificar backend:** integração de emissão em `src/invoices/invoices.service.ts`, `src/queue/workers/message.worker.ts`, `src/templates/template-context.service.ts`, `template-send-preparer.service.ts`, `template-selection.ts` e contratos/DTOs usados pela seleção de métodos. Acrescentar configuração específica de template de cartão apenas onde necessária ao padrão atual.

**Interfaces:** `CardCheckout` recebe token público e resumo de cartão; consome quote/pay da tarefa 4 e a consulta pública. A página server-side deve passar o token explicitamente ao componente que precisa submeter; ele não é credencial de sessão.

- [ ] Testar resumo discriminando dívida, desconto aplicável pela regra existente, multa, juros, acréscimo Efí, parcelas e total; tarifa CifraMais não aparece como acréscimo do pagador.
- [ ] Testar alteração de parcelas/bandeira, cotação vencida, recusa, processamento, API indisponível e script Efí bloqueado. Mudança de valores exige nova confirmação; nova leitura nunca debita.
- [ ] Tokenizar no browser com `reuse:false`, tratar fingerprint e coletar documento/endereço/dados exigidos que estiverem ausentes; não incluir campos de cartão em analytics/session replay.
- [ ] Testar seleção explícita de cartão na emissão, envio de link sem instrumento Pix/boleto, ausência de template compatível gerando pendência e ausência de fallback silencioso.
- [ ] Manter recorrência apenas comercial; cada nova fatura exige pagamento pelo link, sem cartão salvo ou débito automático.
- [ ] Rodar testes focados da página, parser, selectors, comunicação e templates; verificar layout móvel e lint; fazer commit.

## Tarefa 6 — confirmação, conciliação e eventos posteriores

**Modificar:** `api-cobranca/src/payment/efi.service.ts`, `efi-charge-normalizer.ts`, `payment-charge.service.ts`, `payment-notifications.service.ts`, `src/webhooks/webhooks.controller.ts`, `src/settlements/settlement-ledger.ts` e `settlements.service.ts`; testes correspondentes.

**Interfaces:** consulta e webhook localizam a tentativa pelo `charge_id`/`custom_id` e conta emissora; conciliação do cartão usa `platformFeeBaseCents` fotografado. O comportamento de `recordSettlement` para PIX/BOLIX permanece o atual.

- [ ] Testar notificações consultadas pela conta correta, recebidas antes da resposta do pay, repetidas e fora de ordem; assertar uma baixa/um lançamento financeiro por evidência.
- [ ] `approved`/`waiting` preservam processamento; `paid` permite baixa. Confirmação manual/contestação/identificador ou valor divergente vão para revisão, sem inventar recebimento.
- [ ] Testar total do pagador maior que a dívida: conciliação reutiliza base CifraMais fotografada como principal após descontos, excluindo multa, juros e custo Efí. No exemplo de base 9000 e 200 bps, split esperado permanece 180 centavos após a confirmação. Comparar com Pix/Bolix para provar bases inalteradas.
- [ ] Conciliar resultado incerto por consulta, identificador e conta; apenas liberar nova tentativa com prova conclusiva. Credenciais atuais não substituem conta emissora antiga.
- [ ] Registrar separadamente dívida quitada, tarifa efetiva e split recebido. Devoluções/contestação geram eventos e lançamentos de correção imutáveis, com revisão quando não há prova de valor.
- [ ] Não criar estorno automático de marketplace não suportado; apresentar a pendência operacional ao admin.
- [ ] Rodar specs de pagamento/conciliação/ledger/notificações; fazer commit.

## Tarefa 7 — regressão e preparação de liberação

**Criar:** `api-cobranca/test/card-checkout.e2e-spec.ts`; completar runner descartável existente se necessário. Atualizar `docs/implementation/efi-card-validation.md` e runbook de ativação para capacidade de cartão.

- [ ] Testar em PostgreSQL/Redis descartáveis: empresa A/B, concorrência real, idempotência, cancelamento versus confirmação, cotação vencida e resposta Efí perdida.
- [ ] Reexecutar fluxos atuais de Pix/Bolix e comparar tarifas, valores, emissão, links, baixa e comunicação; não basta testar apenas o cartão.
- [ ] Backend: `npm test -- --runInBand`, `npm run build` e ESLint sem `--fix`; registrar falhas preexistentes separadamente, sem alegar checks aprovados.
- [ ] Integração: `node test/e2e-disposable.cjs card-payment.e2e-spec.ts payment-issuance-recovery.e2e-spec.ts` em `api-cobranca/`, conferindo a configuração do runner antes.
- [ ] Frontend: `npx jest --runInBand`, `npm run lint`, `npm run build`; registrar resultados e limitações.
- [ ] Planejar backend/migration antes do frontend, com cartão desabilitado até os dois estarem compatíveis. Habilitar por empresa somente após capacidade, tarifas, split e procedimento de estorno validados.
- [ ] Documentar reversão por desabilitação de novas emissões; continuar consultando/processando tentativas e pagamentos existentes. Não apagar reservas nem interromper webhooks.
- [ ] Entregar alterações e evidências para revisão. Deploy, VPS e chamadas reais são ações posteriores que exigem pedido explícito, conforme `AGENTS.md`.

## Critério final de aceite

Empresa emite para cartão; link permite somente cartão; pagador escolhe opção válida até 6x, vê o total discriminado e confirma uma única tentativa. A cobrança respeita encargos existentes, repassa apenas custo Efí e concilia a remuneração CifraMais sobre a base aprovada. Resultados incertos e aprovação provisória não provocam duplicidade. Pix/Bolix passam nas regressões sem mudança financeira. Pendências da especificação foram fechadas antes da implementação financeira; habilitação operacional permanece separada da entrega do código.


## Registro de execução — 07/10/2026

Implementação local entregue com schema/migração aditiva, cálculo em centavos, cotação/submissão Efí, link público com tokenização, idempotência/resultado incerto, worker de conciliação, comissão sobre principal descontado, configuração administrativa e integração à emissão/comunicação. Templates de cartão usam link e possuem seleção própria. Os itens acima permanecem como checklist detalhado original; esta seção registra o resultado efetivo, sem declarar homologação externa realizada.

Diferenças confirmadas no código atual: as antigas tarifas prazo/recuperada não existem no schema atual; configurações versionadas de cartão registram os dois percentuais sem alterar Pix/Bolix. O banco exige que cada método pertença ao perfil financeiro: habilitar/desabilitar cria perfil sucessor na mesma conta, preservando o histórico. O usuário confirmou processamento uniforme entre bandeiras; configurações divergentes são recusadas para proteger o líquido da empresa. O contrato e as condições reais ainda precisam de evidência operacional antes da habilitação.

Revisão independente encontrou CORS de idempotência, resposta atrasada de recusa, vínculo da tarifa à bandeira e sinalização de divergências. Os quatro achados foram corrigidos e aceitos na rechecagem. Testes reproduziram a regressão APPROVED → DECLINED antes da correção; verificação final cobre preservação da reserva.

Verificação e procedimentos de liberação: [operação de cartão](../../operations/efi-credit-card.md). Sem deploy, PR ou transações reais.

Resultados finais: backend 121 suítes / 968 testes; frontend 56 suítes / 310 testes; integração descartável 2 suítes / 19 testes, com todas as migrations aplicadas. Backend build passou; frontend build Webpack passou (Turbopack bloqueado pela abertura de porta interna no ambiente). ESLint dos arquivos backend alterados/novos passou; frontend sem erros, apenas aviso existente de `useReactTable`. Revisão independente e rechecagem concluídas. Nenhuma alteração de regra fora do escopo.
