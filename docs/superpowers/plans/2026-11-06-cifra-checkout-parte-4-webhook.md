# Cifra+ Checkout, Parte 4: webhook ao vendedor (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável; nenhum envio a endereço real.

**Objetivo:** o sistema do vendedor (ex.: o bot do Porquim) é avisado de cada evento do pedido,
com assinatura conferível, e libera ou bloqueia o acesso sozinho.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), itens CK-19 a
CK-22. O CK-23 (ver o corpo no histórico) e o CK-38 (várias regras) ficam para depois.

## Decisões do responsável pelo produto (06/11/2026)

- **Todos os pedidos geram aviso** quando o vendedor tem URL configurada. A entrega "por webhook"
  no produto passa a dizer só que o acesso chega por lá (sem link no e-mail).
- **Webhook desligado depois de 3 dias** seguidos sem nenhuma entrega com sucesso, com e-mail para
  o vendedor e botão "Religar".

## Decisões técnicas (revisar se discordar)

1. **Fila no banco** (`CheckoutWebhookDelivery`), e não no Redis:
   - cada evento vira uma linha com o corpo fixado, o id do evento (`evt_…`) e a próxima
     tentativa;
   - um worker a cada 30 s envia o que venceu;
   - assim o histórico e o "Reenviar" saem da mesma tabela, e uma queda do Redis não perde
     avisos.
2. **Tentativas** com intervalo crescente (1 min, 5 min, 15 min, 30 min, 1 h, 2 h, 4 h, 8 h), por
   até 24 h a partir do evento. Depois, a entrega fica "falhou". "Reenviar" reabre a janela de
   24 h.
3. **Assinatura:**
   - cabeçalho `X-Cifra-Signature: t=<unix>,v1=<hex>`;
   - `v1` é o HMAC-SHA256 do segredo sobre `"<t>.<corpo bruto>"`;
   - também vão `X-Cifra-Event-Id` e `X-Cifra-Event-Type`;
   - **segredo:** `whsec_…` gerado pelo sistema, cifrado no banco e mostrado uma única vez.
4. **Proteção da rede da VPS:**
   - só `https`, porta 443 e um nome que resolva para endereços públicos, conferidos a cada
     envio;
   - não segue redirecionamento;
   - limite de 10 s e de 64 KB lidos da resposta.
5. **Eventos:**
   - `order.created` (Pix gerado);
   - `order.paid`;
   - `order.pix_expired`;
   - `order.refunded` (cada devolução, com o valor e o total devolvido);
   - `order.chargeback`;
   - `refund.requested`;
   - `webhook.test`.

   `order.card_declined` entra na Parte 6, com o cartão.
6. **Corpo** (um aviso por venda, CK-20):

   ```json
   {
     "id": "evt_…", "type": "order.paid", "createdAt": "…",
     "data": {
       "order": {
         "id", "status", "paidAt", "totalCents", "subtotalCents", "discountCents",
         "surchargeCents", "couponCode", "utm",
         "buyer": { "name", "email", "document", "phone" },
         "items": [{ "kind": "MAIN|BUMP", "productId", "name", "unitPriceCents",
                     "discountCents", "accessPeriodMonths", "accessExpiresAt" }]
       },
       "refund": { "amountCents", "totalRefundedCents" }
     }
   }
   ```

   `refund` só aparece em `order.refunded`. `accessExpiresAt` = pagamento + período (null sem
   período ou sem pagamento).
7. **Desligado:**
   - eventos novos ficam "pulados" (visíveis no histórico, reenviáveis);
   - os pendentes também ficam pulados;
   - religar zera a contagem.

## Modelo de dados (migration aditiva)

- `CheckoutSettings`: `webhookUrl?`, `webhookSecretEncrypted?`, `webhookFailingSince?` e
  `webhookDisabledAt?`.
- `CheckoutWebhookDelivery`:
  - `id`, `companyId`, `orderId?`, `eventId @unique`, `eventType`, `payload Json`;
  - `status` (`PENDING`, `DELIVERED`, `FAILED`, `SKIPPED`), `attempts`, `nextAttemptAt?`,
    `retryUntil`;
  - `lastStatusCode?`, `lastError?`, `deliveredAt?`, `createdAt`, `updatedAt`.

## Tarefas

1. **Schema e migration.**
2. **Envio** (`checkout-webhook.sender.ts`):
   - conferência da URL e do DNS;
   - POST assinado com limites;
   - resultado normalizado.
   - **Testes:**
     - assinatura conferível com o segredo;
     - `http`, IP privado, `localhost` e nome que resolve para IP privado recusados;
     - redirecionamento não seguido;
     - timeout vira falha.
3. **Serviço e worker** (`checkout-webhooks.service.ts`):
   - registrar eventos;
   - entregar o que venceu, com trava por linha (`updateMany` condicional);
   - intervalo crescente e falha depois de 24 h;
   - desligar depois de 3 dias com e-mail ao vendedor;
   - pular enquanto desligado;
   - reenviar e enviar teste.
4. **Pontos de evento:**
   - criação do pedido;
   - confirmação do pagamento (na mesma transação);
   - expiração;
   - reembolso;
   - contestação;
   - pedido de reembolso.
5. **Rotas do vendedor:**
   - `GET` e `PUT /checkout/webhook`;
   - `POST /checkout/webhook/secret`, `/enable` e `/test`;
   - `GET /checkout/webhook/deliveries` e `POST .../:id/resend`.
6. **Frontend** em Configurações do checkout → seção Webhook:
   - URL, segredo mostrado uma vez e "Enviar teste";
   - aviso de desligado com "Religar";
   - histórico com "Reenviar";
   - um quadro curto de como conferir a assinatura.
7. **Fluxo em banco descartável:** envio simulado no lugar do `CheckoutWebhookSender`, com venda,
   pagamento, reembolso, assinatura, repetição, desligamento e isolamento.
8. **Documentação:** AGENTS.md, situação na spec, a seção do webhook no runbook (com o exemplo de
   conferência para o desenvolvedor do vendedor) e o registro de execução.

## Registro de execução (06/11/2026, branch `feat/cifra-checkout-parte-4`)

As tarefas 1 a 8 foram executadas. Nada foi commitado nem publicado.

**Desvios do plano:**
- **Versão da URL:** a URL do webhook não usa a versão das configurações da página. As duas ficam
  na mesma tela, e salvar uma faria a outra acusar "alterado em outra tela" sem motivo. Como só o
  vendedor edita a URL, a versão não protegia contra nada real.
- **Teste em banco descartável:** os casos do webhook entraram no fim de
  `test/checkout-pix.e2e-spec.ts`, com o envio simulado no lugar do `CheckoutWebhookSender`.
- **DNS:** o endereço é resolvido e conferido antes de cada envio, mas o `fetch` resolve de novo.
  Uma troca de DNS entre as duas resoluções ainda é possível; o risco é baixo e fica anotado para
  revisão.

**Checks executados:**
- **Backend:** `npm test -- --runInBand` (155 suítes, 1.309 testes), `npm run build`, `npx eslint`
  nos arquivos tocados, `npm run test:e2e:checkout` (6) e `npm run test:e2e:checkout-pix` (11).
- **Migration:** aplicada do zero num PostgreSQL descartável, sem diferença no
  `prisma migrate diff`.
- **Frontend:** `npx jest --runInBand` (76 suítes, 481 testes), `npm run lint` (só o aviso
  conhecido) e `npm run build`.
