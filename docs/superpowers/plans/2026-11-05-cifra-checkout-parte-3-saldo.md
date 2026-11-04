# Cifra+ Checkout, Parte 3: saldo, repasse e reembolso (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável; a Efí é sempre simulada.

**Objetivo:** cada centavo de uma venda fica rastreável até o repasse. O vendedor vê vendas e
saldo; o comprador pede reembolso pelo e-mail; o admin registra repasses, contestações e ajustes,
e vê o índice de chargeback.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), CK-13 a CK-18.

## Decisões do responsável pelo produto (05/11/2026)

- **Reembolso de Pix:**
  - entra no saldo pelo **aviso da Efí** (webhook com `devolucoes` `DEVOLVIDO`), com o valor real,
    e fecha o pedido de reembolso;
  - o registro manual fica só para o que não passou pela Efí.
- **Taxas no reembolso:** a tarifa Efí fica com o vendedor; **a % Cifra+ volta ao saldo dele**,
  proporcional ao valor devolvido.
- **Prazo do comprador:** o link do e-mail aceita pedidos por **7 dias depois do pagamento**
  (arrependimento, CDC art. 49). Depois disso, a página orienta a falar com o vendedor.
- **Aviso ao admin:** e-mail para `PLATFORM_ALERT_EMAIL` a cada pedido de reembolso, e a lista de
  pendentes em Admin → Checkout.

## Decisões técnicas (revisar se discordar)

1. **Lançamentos imutáveis** (`CheckoutLedgerEntry`), com valor com sinal, data de liberação e
   chave idempotente. Correção é um lançamento novo (ajuste).
2. **Venda paga** gera três lançamentos na mesma transação da confirmação, liberados em `paidAt` +
   7 dias:
   - `SALE` (+ total recebido);
   - `EFI_FEE` (− tarifa real do webhook, ou a estimada);
   - `PLATFORM_FEE` (− % Cifra+).
3. **Pedidos já pagos antes desta parte** recebem os lançamentos pela própria migration
   (backfill), uma única vez.
4. **Reembolso:**
   - `REFUND` (− valor devolvido) e `PLATFORM_FEE_REVERSAL` (+ % Cifra+ × devolvido / total),
     liberados na hora;
   - o pedido vira `REFUNDED` quando a soma devolvida alcança o total;
   - uma devolução parcial mantém o pedido `PAID`;
   - a chave idempotente é `endToEndId:id` da devolução.
5. **Contestação (chargeback):** `CHARGEBACK` (− valor) registrado pelo admin, e o pedido vira
   `CHARGEBACK`. Só cartão tem chargeback; com cartão desligado, o índice fica em 0%.
6. **Repasse:**
   - `PAYOUT` (− valor) registrado pelo admin, com data, referência do comprovante e observação;
   - o valor sugerido é o saldo liberado;
   - um valor acima do sugerido é aceito, com aviso. A reserva de 1% e a % Cifra+ do repasse ficam
     a critério do admin.
7. **Pedidos de reembolso** (`CheckoutRefundRequest`):
   - origem `BUYER` ou `SELLER`;
   - no máximo um pedido aberto por venda;
   - o admin pode recusar com motivo, e o reembolso pela Efí fecha o pedido aberto.

## Modelo de dados (migration aditiva)

```prisma
enum CheckoutOrderStatus { … REFUNDED CHARGEBACK }   // ALTER TYPE … ADD VALUE
enum CheckoutLedgerKind { SALE EFI_FEE PLATFORM_FEE REFUND PLATFORM_FEE_REVERSAL CHARGEBACK PAYOUT ADJUSTMENT }
enum CheckoutRefundOrigin { BUYER SELLER }
enum CheckoutRefundStatus { REQUESTED DONE REJECTED }

model CheckoutLedgerEntry {
  id, companyId, orderId?, kind, amountCents Int (signed), availableAt, idempotencyKey @unique,
  evidenceReference?, note?, createdByUserId?, createdAt
  @@index([companyId, availableAt]) @@index([orderId])
}

model CheckoutRefundRequest {
  id, companyId, orderId, origin, reason, status @default(REQUESTED),
  resolutionNote?, resolvedByUserId?, resolvedAt?, createdAt
  @@index([companyId, status, createdAt])
}
```

Os dois modelos têm relação composta com `CheckoutOrder` (`[orderId, companyId]`).

## Tarefas

1. **Schema, migration e backfill** dos pedidos pagos.
   - **Teste:** migration do zero com um pedido pago antes dela, que ganha os três lançamentos uma
     vez só; `prisma migrate diff` sem diferença.
2. **Razão** (`checkout-ledger.service.ts`):
   - lançamentos da venda dentro de `CheckoutPaymentsService.confirm`;
   - `balance(companyId, now)`: a liberar, liberado e repassado;
   - lista de vendas com filtros (período, estado) e paginação.
   - **Testes:** venda gera três lançamentos; confirmação repetida não duplica; saldos por data;
     isolamento.
3. **Reembolsos:**
   - **devolução no webhook Pix do checkout:** cada `DEVOLVIDO` vira `REFUND` + estorno da % Cifra+,
     idempotente, atualiza o pedido e fecha o pedido de reembolso aberto. `EM_PROCESSAMENTO` e
     `NAO_REALIZADO` não mexem no saldo;
   - **registro manual pelo admin:** valor, referência e observação;
   - **pedido do vendedor:** `POST /checkout/sales/:orderId/refund-request`;
   - **pedido do comprador:** `POST /checkout/public/orders/:token/refund-request`, só com pedido
     pago há até 7 dias;
   - **e-mail ao admin** a cada pedido; **recusa** pelo admin com motivo.
   - **Testes:**
     - devolução repetida não duplica;
     - devolução parcial mantém o pedido `PAID`;
     - estorno proporcional da %;
     - fora do prazo é recusado;
     - um pedido aberto por venda;
     - outra empresa responde 404.
4. **Admin:**
   - `GET /admin/checkout/clients/:id/finance`: saldo, vendas recentes, pedidos de reembolso,
     repasses e índice de chargeback;
   - `POST .../payouts`, `.../chargebacks`, `.../adjustments`, `.../refunds` e
     `.../refund-requests/:id/reject`, com auditoria;
   - a lista de clientes ganha pedidos pendentes e o índice.
   - **Testes:** repasse com valor acima do liberado avisa; auditoria; 404 para empresa de cobrança.
5. **Frontend do vendedor:**
   - **Vendas:** cartões de saldo, lista com filtros (período e estado), tarifas, % Cifra+, líquido,
     liberação, UTM e "Pedir reembolso";
   - **menu:** Vendas como primeiro item e nova entrada do vendedor.
6. **Frontend do admin:** no detalhe do cliente de checkout, saldo, vendas, pedidos de reembolso
   (registrar ou recusar), repasse, contestação e ajuste; na lista, pendentes e índice.
7. **Comprador:**
   - página `/c/pedido/<token>/reembolso` com motivo e confirmação;
   - o e-mail de acesso ganha o link "Pedir reembolso" (vale por 7 dias);
   - o middleware libera a rota.
8. **Fluxo em banco descartável** (`test/checkout-balance.e2e-spec.ts`):
   - venda paga, saldo a liberar, pedido de reembolso do comprador, devolução pelo webhook e saldo;
   - repasse, contestação e ajuste;
   - isolamento.
9. **Documentação:** AGENTS.md, situação na spec, runbook com a seção de reembolso e repasse, e o
   registro de execução.

## Fora desta parte

- Reembolso de um item só e prazo de retenção (Parte 8).
- Webhook ao vendedor (Parte 4).
- Cartão (Parte 6).
- Pix de repasse pelo sistema (fora do escopo).

## Registro de execução (05/11/2026, branch `feat/cifra-checkout-parte-3`)

As tarefas 1 a 9 foram executadas. Nada foi commitado nem publicado.

**Desvios do plano:**
- **Teste em banco descartável:** os casos da Parte 3 entraram no fim de
  `test/checkout-pix.e2e-spec.ts`, que já tem a venda paga, em vez de um arquivo novo. O comando
  continua `npm run test:e2e:checkout-pix`.
- **Lista de clientes no admin:** mostra os pedidos de reembolso pendentes. O índice de chargeback
  fica no detalhe do cliente, para não fazer uma consulta por cliente na lista.
- **Contestação:** a % Cifra+ da venda contestada **não** volta ao vendedor. Só o reembolso a
  devolve, como decidido; se o responsável quiser o mesmo na contestação, é um ajuste.
- **Página do pedido:** passou a reconhecer "reembolsada" e "contestada" e a encerrar o acesso
  nesses casos.

**Checks executados:**
- **Backend:** `npm test -- --runInBand` (153 suítes, 1.276 testes), `npm run build`, `npx eslint`
  nos arquivos tocados, `npm run test:e2e:checkout` (6) e `npm run test:e2e:checkout-pix` (9).
- **Migration:** aplicada do zero num PostgreSQL descartável, com um pedido pago e um expirado
  criados antes dela. Só o pago ganhou os três lançamentos, com a tarifa real da Efí, e o
  `prisma migrate diff` não mostrou diferença.
- **Frontend:** `npx jest --runInBand` (75 suítes, 477 testes), `npm run lint` (só o aviso
  conhecido) e `npm run build`.
