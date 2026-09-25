# Execução da etapa 7 — conciliação (Fase A: conta própria do cliente)

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, etapa 7 e seções 8.3, 8.5 e 8.6. Registro anterior: etapa 6.

## Escopo

Na conta própria do cliente, o dinheiro não passa pela CifraMais:

- o pagador paga na conta Efí do cliente;
- a Efí desconta a tarifa;
- o split envia a remuneração da CifraMais.

Por isso, na Fase A a conciliação cobre só:

- a comprovação da remuneração recebida por split;
- as divergências de pagamento;
- as devoluções.

Nada é retido nem repassado pela CifraMais, então não existem "disponível para repasse", "reservado" ou "repassado". Seguindo a regra da etapa ("para conta própria, não criar obrigação artificial de repasse"), ficam para a **Fase B** (conta CifraMais):

- lotes de repasse manual;
- destinos e comprovantes de transferência em armazenamento privado;
- saldo devedor compensado em repasses.

Telas: etapa 8. Esta etapa entrega o backend e a API administrativa.

## Decisões

- Ruling: **lançamentos financeiros** (`FinancialLedgerEntry`).
  - São somente inclusão (trigger bloqueia UPDATE/DELETE) e têm valor com sinal do lado do cliente: pagamento (+), tarifa Efí (−), remuneração CifraMais (−), devolução (−), estorno da remuneração (+).
  - Cada lançamento guarda fonte (`PROVIDER_WEBHOOK`, `PROVIDER_RECONCILIATION`, `ADMIN`, `SYSTEM`) e referência (endToEndId, id do evento da Efí, id da devolução).
  - São gerados **na mesma transação e sob o mesmo lock da cobrança** que já registra pagamento e devoluções. O sistema compara o estado da cobrança com a soma dos lançamentos e grava só a diferença, com chave idempotente `tipo:cobrança:sequência`. Notificação repetida não grava nada.
  - Tarifa Efí estimada vira lançamento `estimated`; quando a efetiva chega, entra a diferença, sem editar o anterior.
- Ruling: **conciliação por cobrança** (`PaymentSettlement`), criada quando a cobrança é paga.
  - Situação: `DIVERGENT` se há divergência aberta; senão `AWAITING_EVIDENCE` se a remuneração ainda não foi comprovada; senão `RECONCILED`.
  - Cobrança sem remuneração CifraMais não precisa de comprovação.
- Ruling: **comprovação da remuneração** (`PlatformFeeEvidence`).
  - O administrador informa a referência do extrato, o valor recebido e as cobranças cobertas. O total esperado é calculado no servidor.
  - Valor igual: as cobranças ficam conciliadas. Valor diferente: `MISMATCH` e uma divergência por cobrança.
  - As cobranças são travadas com `FOR UPDATE` em ordem e gravadas com CAS de versão, e só aceitam comprovação quando aguardam.
  - A mesma referência com a mesma seleção é repetição idempotente; qualquer outro uso responde `EVIDENCE_REFERENCE_REUSED`.
  - A evidência é imutável e não mistura ambientes (produção, homologação, legado).
  - Não se depende de `GET /v2/gn/split/config/:id`.
- Ruling: **divergências** (`SettlementDivergence`). Cada tipo tem decisões permitidas e o que cada decisão exige:

  | Divergência | Decisões (exigência) |
  | --- | --- |
  | Pago abaixo do valor (`PAYMENT_BELOW_CHARGE`) | aceitar como quitação (motivo) ou emitir complementar (vencimento) |
  | Pago acima do esperado (`PAYMENT_ABOVE_EXPECTED`) | aceitar (motivo) ou devolução registrada (referência) |
  | Pagamento em duplicidade (`DUPLICATE_PAYMENT`) | devolução registrada (referência) ou manter como crédito (motivo) |
  | Comprovação diferente / remuneração alterada após comprovação | aceitar diferença (motivo) ou ajuste acertado (referência) |
  | Estorno de remuneração devido (`PLATFORM_FEE_REVERSAL_DUE`) | estorno pago (referência) ou dispensado (motivo) |

  - A decisão é única: repetir a mesma decisão é idempotente, e decidir diferente responde `DIVERGENCE_ALREADY_RESOLVED`. Um trigger impede alterar divergência resolvida.
  - Tudo vai para o `AuditLog`.
- Ruling: o limite de "pago acima do esperado" é valor + multa + juros por dia de atraso (taxa mensal ÷ 30), arredondado para cima e contado a partir do dia seguinte ao vencimento. É uma heurística: acima dela vai para revisão, e nada é bloqueado.
- Ruling: **duplicidade**. Um Pix com outro endToEndId numa cobrança já paga vira lançamento `DUPLICATE_PAYMENT`, fora dos valores da cobrança, com divergência "crédito a devolver". A conciliação manual também trata cada recebimento Pix como um pagamento. Notificações de Cobranças não são tratadas como duplicidade, porque `paid` e `settled` podem ser o mesmo pagamento.
- Ruling: **cobrança complementar**. O saldo vira uma **fatura nova ligada à original** (`Invoice.complementsInvoiceId`, única), com o mesmo devedor, meio e termos, em rascunho, emitida pelo fluxo normal. O plano diz "na mesma fatura", mas uma fatura com duas cobranças depois de paga quebraria o ciclo atual da fatura. **Pede confirmação.**
- Ruling: **devoluções**.
  - Geram lançamento de devolução, e o pagamento original nunca é apagado.
  - O limite passou a ser o valor pago (com multa e juros), não o valor original.
  - Opção por empresa `refundPlatformFeeOnRefund` (padrão desligada, `PUT /admin/companies/:id/settlement-options`). Ligada, gera estorno proporcional da remuneração (inteiros, sem ponto flutuante, limitado à remuneração) e divergência "estorno devido", porque a CifraMais já recebeu pelo split e acerta fora do sistema.
- Ruling: triggers garantem no banco que conciliação, lançamento e divergência pertencem à empresa e à cobrança corretas.

## API administrativa (PLATFORM_ADMIN)

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/admin/settlements?companyId&status&page&pageSize` | lista com totais por cobrança e divergências abertas |
| GET | `/admin/settlements/summary?companyId` | recebido, tarifa Efí (estimada), remuneração a comprovar ("saldo a conciliar"), comprovada, devoluções, estornos, duplicidades, divergências abertas |
| GET | `/admin/settlements/:id` | detalhe com lançamentos, divergências e evidência |
| POST | `/admin/settlements/platform-fee-evidence` | comprovação da remuneração |
| POST | `/admin/settlements/divergences/:id/resolve` | decisão |
| PUT | `/admin/companies/:id/settlement-options` | estorno da remuneração em devolução |

## Verificação

- `test/settlements-postgres.cjs` (novo) passa com 7 cenários:
  1. Três notificações simultâneas liquidam uma vez; os lançamentos são idempotentes e somente inclusão; a tarifa efetiva entra como diferença.
  2. Duplicidade fica fora dos valores da cobrança e é decidida uma vez, com referência.
  3. Pagamento abaixo gera a fatura complementar; multa e juros dentro dos termos são aceitos; excesso sem explicação vai para revisão.
  4. Comprovação: total calculado no servidor; pedidos simultâneos não cobrem a mesma remuneração duas vezes; referência não é reutilizada; valor diferente vai para revisão.
  5. Devoluções: lançamentos compensatórios, estorno proporcional só com a opção ligada e limite pelo valor pago.
  6. Conciliação e lançamento entre empresas são recusados pelo banco; sem remuneração não há o que comprovar.
  7. Resumo, lista filtrada, totais do detalhe e auditoria.
- Backend:
  - `npx jest`: 94 suítes / 659 testes;
  - ESLint (`src`) e `nest build` sem erros;
  - `tsc`: os mesmos 12 erros antigos em specs;
  - harnesses PostgreSQL em 38 migrations, todos passam: `payment`, `financial-activation`, `-candidates-`, `-validation-`, `-lifecycle-`, `communications`, `backup-restore`.

## Pendente

- Etapa 8: telas do painel (lista, resumo, comprovação, decisões, opção de estorno) e a visão da empresa.
- Homologação (etapa 9):
  - como a remuneração do split aparece no extrato da CifraMais (uma linha por cobrança ou agrupada);
  - se a Efí informa o valor pago na notificação de Cobranças (`value`);
  - como o BOLIX pago duas vezes é notificado.
- Fase B: lotes de repasse, destinos, comprovantes em armazenamento privado e compensação de saldo devedor.
