# Cifra+ Checkout, Parte 8: reembolso avançado (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável; a Efí e o Resend são sempre simulados.

**Objetivo:** o reembolso pedido pelo comprador passa por 7 dias de retenção, em que só ele pode
desistir. O reembolso pode ser de um item só (um order bump, por exemplo). O comprador recebe um
e-mail em cada etapa.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), CK-34 a CK-36.

**Base:** branch novo a partir do `main`, que já tem a Parte 7 (PR #68). Um upsell já é um pedido
próprio e se reembolsa sozinho desde a Parte 7.

## Decisões do responsável pelo produto (10/11/2026)

- **Retenção:**
  - 7 dias, como na spec, para o pedido feito pelo comprador;
  - o risco do art. 49 do CDC (arrependimento em 7 dias) fica para a revisão jurídica;
  - o pedido feito pelo vendedor não tem retenção.
- **Desistência:**
  - o botão fica só na página do pedido do comprador, aberta pelo link do e-mail da Cifra+;
  - o vendedor pode mandar pelo WhatsApp um texto pronto pedindo que o comprador abra esse e-mail,
    ou pedir à Cifra+ para reenviá-lo;
  - o vendedor nunca recebe o link.
- **Valor de um item:** o preço do item, mais a parte proporcional do acréscimo que o comprador
  pagou (tarifa do Pix ou juros do cartão). O comprador recebe de volta tudo o que pagou por aquele
  item.
- **Quem pede um item:** o comprador, na página de reembolso, e o vendedor, em Vendas. O admin
  executa nos dois casos.

## Decisões técnicas (revisar se discordar)

1. **Pedido de reembolso (`CheckoutRefundRequest`):**
   - **itens:** índices dos itens do pedido; vazio quer dizer o pedido inteiro;
   - **valor:** calculado e gravado no pedido de reembolso;
   - **retenção:** `holdUntil` (pedido do comprador: criação + 7 dias);
   - **novo estado `WITHDRAWN`:** o comprador desistiu, com `withdrawnAt`.
2. **Valor por item:**
   - o total pago é dividido entre os itens na proporção de (preço − desconto), pelo método do
     maior resto, para a soma bater com o total;
   - reembolsar todos os itens devolve exatamente o total;
   - um item já reembolsado não pode ser pedido de novo.
3. **Tarifas:**
   - a % Cifra+ volta na proporção do valor devolvido, como hoje;
   - a tarifa Efí fica com a venda, como hoje: a Efí não a devolve.
4. **Retenção na execução:**
   - durante a retenção, o admin não registra o reembolso manual (`409 CHECKOUT_REFUND_ON_HOLD`);
   - uma devolução Pix avisada pela Efí é um fato e vale sempre, fechando o pedido de reembolso;
   - quando o valor da devolução bate com o de um pedido de reembolso aberto, os itens desse pedido
     vão junto no lançamento e no webhook.
5. **Repasse sugerido:**
   - o saldo ganha `suggestedPayoutCents`: o liberado menos o valor dos pedidos de reembolso em
     aberto (em retenção ou prontos);
   - o admin vê esse número ao registrar o repasse.
6. **Desistência:**
   - `POST /checkout/public/orders/:token/refund-request/withdraw`, só com o token do pedido do
     comprador, enquanto o pedido de reembolso está aberto (mesmo depois da retenção, até o admin
     executar);
   - gera `refund.withdrawn` ao vendedor e um e-mail ao comprador.
7. **Vendedor:**
   - em Vendas, o pedido aberto mostra "em retenção até dd/mm" ou "com a Cifra+";
   - "Chamar no WhatsApp" abre um texto pronto, sem link;
   - "Reenviar e-mail ao comprador" pode ser usado uma vez a cada 24 h, com auditoria.
8. **E-mails ao comprador (CK-36):**
   - fila `checkout-mail`, um job por pedido de reembolso e etapa: recebido, desistência
     confirmada e reembolso concluído;
   - saem como Cifra+, com o nome e o suporte do vendedor;
   - o de "recebido" traz o link da página de reembolso (desistir ou acompanhar);
   - o pedido recusado pelo admin não gera e-mail nesta parte, como na spec.
9. **Webhook ao vendedor:**
   - `refund.requested` traz os itens, o valor e `holdUntil`;
   - novo evento `refund.withdrawn`;
   - `order.refunded` traz os itens reembolsados quando se sabe quais são.

## Modelo de dados (migration aditiva)

- **`CheckoutRefundStatus`:** novo valor `WITHDRAWN`.
- **`CheckoutRefundRequest`:**
  - `itemIndexes` (`Int[]`, padrão vazio) e `amountCents` (`Int?`; nulo nos pedidos antigos, que
    são do pedido inteiro);
  - `holdUntil`, `withdrawnAt` e `buyerRemindedAt` (todos `DateTime?`).
- **`CheckoutLedgerEntry`:** nada muda. Os itens de um reembolso ficam no pedido de reembolso e no
  webhook.

## Tarefas

1. **Schema e migration**, conferida em banco descartável, com os pedidos de reembolso antigos
   continuando válidos.
2. **Valor por item:** função pura com a divisão pelo maior resto, cobrindo cupom, acréscimo e todos
   os itens.
3. **Pedido de reembolso:**
   - itens e valor no pedido do comprador e no do vendedor;
   - retenção e bloqueio do item já reembolsado;
   - um pedido aberto por venda, como hoje.
4. **Execução:**
   - o registro manual respeita a retenção;
   - a devolução da Efí liga os itens pelo valor;
   - `order.refunded` com os itens;
   - repasse sugerido no saldo.
5. **Desistência e lembrete:**
   - rota pública de desistência;
   - "reenviar e-mail" do vendedor (uma vez a cada 24 h);
   - `refund.withdrawn`.
6. **E-mails:** recebido, desistência confirmada e concluído, pela fila, sem dados de cartão e sem
   o motivo escrito pelo vendedor.
7. **Frontend:**
   - comprador: escolha dos itens, estado do pedido de reembolso e botão de desistir;
   - vendedor: escolha dos itens, retenção, WhatsApp e reenvio;
   - admin: "em retenção" ou "pronto para executar", valor e itens do pedido de reembolso, e
     repasse sugerido.
8. **Fluxo em banco descartável:**
   - pedido do comprador fica em retenção;
   - o admin é barrado na retenção e executa depois;
   - a desistência pelo comprador fecha o pedido de reembolso;
   - o vendedor não desiste no lugar do comprador;
   - reembolso de um bump devolve só a parte dele, com a % Cifra+ proporcional;
   - o repasse sugerido desconta o pedido aberto;
   - os e-mails são enfileirados;
   - isolamento entre vendedores.
9. **Documentação:** AGENTS.md, spec, runbook e registro.

## Fora desta parte

- Reembolso parcial por valor livre (sem item): segue como hoje, pelo admin.
- E-mail ao comprador quando o admin recusa o pedido de reembolso.
- Devolução automática pela API da Efí: o admin continua executando no app da Efí, como na
  Parte 3.

## A confirmar na revisão jurídica

- **Retenção:** se os 7 dias de retenção são compatíveis com o direito de arrependimento (art. 49
  do CDC) e com os termos de uso, e o texto do e-mail que fala do prazo.

## Registro de execução (10/11/2026, branch `feat/cifra-checkout-parte-8`)

As tarefas 1 a 9 foram executadas. Nada foi commitado nem publicado.

**Desvios do plano:**
- **E-mail de recebido só no pedido do comprador:** o pedido feito pelo vendedor não tem retenção nem
  botão de desistir, então o comprador recebe só o e-mail de reembolso concluído.
- **Itens restantes viram o pedido inteiro:** se os itens escolhidos (com os já reembolsados) cobrem
  a compra, o pedido de reembolso é do restante do pedido, sem lista de itens, e devolve exatamente
  o que falta.
- **Itens na devolução da Efí:** a devolução avisada pela Efí só sabe o valor. Os itens vão no aviso
  ao vendedor quando o valor bate com o do pedido de reembolso aberto; senão, o aviso sai sem itens.
- **Desistência depois da retenção:** vale enquanto o admin não executou, como no plano.

**Checks executados:**
- **Backend:**
  - `npm test -- --runInBand`: 159 suítes, 1.365 testes;
  - `npm run build`;
  - `npx eslint` no módulo de checkout e no e2e: sem erros;
  - `npm run test:e2e:checkout` (6) e `npm run test:e2e:checkout-pix` (32, 4 novos de reembolso).
- **Migration:** `20261110120000_checkout_refund_hold`, aplicada do zero num PostgreSQL descartável
  (61 migrations), sem diferença no `prisma migrate diff`.
- **Frontend:** `npx jest --runInBand` (83 suítes, 509 testes), `npm run lint` (só o aviso
  conhecido do `useReactTable`) e `npm run build`.
- **Telas no ambiente local:** pedido de reembolso do bump na página do comprador (valor do item,
  retenção até a data e o botão de desistir) e a venda em Vendas com a retenção, o WhatsApp e o
  reenvio do e-mail.

**Pendências:**
- **Revisão jurídica:** a retenção de 7 dias frente ao art. 49 do CDC e os textos dos e-mails.
- **Publicação:** backend com `prisma migrate deploy` antes do frontend.
