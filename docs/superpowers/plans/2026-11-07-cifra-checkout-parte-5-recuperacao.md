# Cifra+ Checkout, Parte 5: recuperação (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável.

**Objetivo:** o vendedor vê quem gerou Pix e não pagou e quem preencheu os dados e saiu, fala com
eles pelo WhatsApp, exporta a lista e acompanha o que foi recuperado. Os dados pessoais de quem
não comprou são apagados depois de 12 meses.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), CK-24 a CK-27.
A lista de cartões recusados entra na Parte 6, com o cartão.

## Decisões técnicas (tomadas no plano; revisar se discordar)

1. **Lead** (`CheckoutLead`):
   - **o que é:** quem preencheu dados na página e não gerou o Pix;
   - **como é gravado:** a página envia o que já foi digitado quando o comprador sai de um campo,
     com uma chave da visita (`sessionKey`). Basta e-mail **ou** celular válidos;
   - **conversão:** o pedido criado na mesma visita marca o lead como convertido;
   - **abandono:** 30 minutos depois da última atividade, sem pedido, ele conta como abandonado,
     entra na Recuperação e gera o evento de webhook `lead.abandoned` (uma vez).
2. **Aviso antes do preenchimento:** um texto curto acima dos dados do comprador, com link para o
   aviso de privacidade, diz que os dados podem ser usados pelo vendedor para contato sobre a
   compra. O aviso de privacidade ganha o parágrafo sobre quem não chegou a gerar o Pix.
3. **Recuperado:**
   - quando um pedido é pago, os pedidos não pagos e os leads da mesma empresa e do mesmo produto,
     com o mesmo CPF/CNPJ (ou o mesmo e-mail, no caso do lead), criados nos 30 dias anteriores,
     ficam marcados como recuperados por ele;
   - a marcação é feita na transação do pagamento.
4. **Lista de recuperação:**
   - **o que entra:** pedidos `EXPIRED` ou `FAILED` ("Pix não pago") e leads abandonados;
   - **filtros:** tipo, produto, período e situação (a recuperar ou recuperados);
   - **o padrão:** a recuperar nos últimos 30 dias.
5. **WhatsApp:** abre `wa.me/55<celular>` com uma mensagem pronta e editável no aparelho do
   vendedor: "Olá, <primeiro nome>! Vi que você começou a compra de <produto> e não concluiu.
   Posso ajudar?"
6. **CSV:**
   - respeita os filtros, com até 5.000 linhas;
   - células que começam com `=`, `+`, `-` ou `@` ganham `'`, para não virarem fórmula no Excel;
   - cada exportação fica na auditoria (quem, quando, filtros e quantidade, sem os dados).
7. **Anonimização** (todo dia, às 03:40):
   - **o que apaga:** pedidos não pagos e leads com mais de 12 meses perdem nome, e-mail,
     CPF/CNPJ, celular e UTMs; os avisos de webhook desses pedidos perdem o corpo;
   - **o que fica:** valores, datas e produto;
   - **o que não muda:** pedidos pagos ficam como estão (obrigações fiscais e contestações).

## Modelo de dados (migration aditiva)

- `CheckoutOrder`: `recoveredByOrderId?` e `anonymizedAt?`.
- `CheckoutLead`:
  - `id`, `companyId`, `productId`, `sessionKey`;
  - `name?`, `email?`, `document?`, `phone?`, `utm?`;
  - `lastSeenAt`, `convertedOrderId?`, `abandonedNotifiedAt?`, `recoveredByOrderId?`,
    `anonymizedAt?`, `createdAt`;
  - `@@unique([productId, sessionKey])`.

## Tarefas

1. **Schema e migration.**
2. **Leads:**
   - `POST /checkout/public/products/:slug/lead`, com limite por IP de 30 por minuto;
   - o pedido marca o lead convertido;
   - o worker marca os abandonados e emite `lead.abandoned`.
3. **Marcação de recuperados** no pagamento.
4. **Rotas do vendedor:** `GET /checkout/recovery` (com filtros e paginação) e
   `GET /checkout/recovery.csv`, com auditoria.
5. **Anonimização diária**, com o teste de que os pedidos pagos não mudam.
6. **Frontend:**
   - tela Recuperação (filtros, lista, WhatsApp, copiar contato, CSV);
   - item no menu;
   - gravação do lead na página de pagamento, com o aviso;
   - aviso de privacidade atualizado.
7. **Fluxo em banco descartável:** lead abandonado e evento, Pix expirado na lista, pagamento
   posterior marcando recuperado, CSV com auditoria, anonimização e isolamento.
8. **Documentação:** AGENTS.md, spec, runbook e registro.

## Registro de execução (07/11/2026, branch `feat/cifra-checkout-parte-5`)

As tarefas 1 a 8 foram executadas. Nada foi commitado nem publicado.

**Desvios do plano:**
- **Anonimização do aviso `lead.abandoned`:** o aviso sai cerca de 30 minutos depois do lead, então
  a data dele não serve para achá-lo. A rotina procura os avisos pelo id do lead dentro do corpo.
  O teste em banco descartável pegou o erro da primeira versão, que usava a data do aviso.
- **Visita que compra:** o lead da mesma visita fica convertido, não "recuperado". Só conta como
  recuperado o que ficou para trás em outra visita ou outro pedido.
- **Período "Todo o período":** sem data, a API mostra os últimos 30 dias; a tela envia uma data
  inicial explícita quando o vendedor escolhe ver tudo.
- **Teste em banco descartável:** os casos entraram no fim de `test/checkout-pix.e2e-spec.ts`.

**Checks executados:**
- **Backend:** `npm test -- --runInBand` (156 suítes, 1.315 testes), `npm run build`, `npx eslint`
  (só o erro antigo de formatação em `collection-rule-engine.spec.ts`), `npm run test:e2e:checkout`
  (6) e `npm run test:e2e:checkout-pix` (16).
- **Migration:** aplicada do zero num PostgreSQL descartável, sem diferença no
  `prisma migrate diff`.
- **Frontend:** `npx jest --runInBand` (77 suítes, 487 testes), `npm run lint` (só o aviso
  conhecido) e `npm run build`.

**Pendências:**
- O texto novo do aviso de privacidade e o aviso acima dos dados do comprador não passaram por
  revisão jurídica.
- A lista de cartões recusados entra com a Parte 6.
