# Cifra+ Checkout, Parte 6: cartão (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável; a Efí é sempre simulada.

**Objetivo:** o comprador paga com cartão em até 12x na conta Efí da Cifra+, com os mesmos
cuidados do cartão da cobrança (tokenização no navegador, chave idempotente, resultado incerto
nunca reenviado). O admin liga o cartão depois da homologação e pode pausar o cartão de um
vendedor. O Pix continua igual.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), CK-28 a CK-30,
e a parte "cartão recusado" do CK-24 e do CK-21 (`order.card_declined`).

**Base:** branch `feat/cifra-checkout-parte-6`, criado a partir da Parte 5 (o cartão recusado entra
na Recuperação).

## Decisões do responsável pelo produto (08/11/2026)

- **Recebimento antecipado:** a conta Cifra+ recebe o cartão de uma vez, mesmo parcelado. O admin
  informa os dias até o crédito (padrão 30). A venda no cartão libera para o vendedor no maior
  entre 7 dias e esse prazo.
- **Endereço de cobrança:** só quando o comprador escolhe cartão. Ele digita CEP e número, e rua,
  bairro, cidade e UF vêm de uma consulta de CEP, com correção possível.
- **Estorno e contestação de cartão:** o aviso da Efí vira alerta para o admin (anomalia), e o
  admin registra o reembolso ou a contestação pelas telas da Parte 3. Nada muda sozinho no saldo.
- **Limites de tentativa:** 3 por pedido, 5 por CPF/CNPJ em 24 h e 10 por IP por hora. Depois, a
  página sugere o Pix.

## Decisões técnicas (revisar se discordar)

1. **Configuração do cartão na conta Cifra+** (nova versão de `CheckoutPlatformSettings`):
   - `cardEnabled`, ligado só pelo admin, depois da homologação;
   - tarifa no formato do cartão atual, recebimento antecipado (`cashBasisPoints` e
     `anticipationBasisPoints` por parcela depois da primeira, via `cardProcessingBasisPoints`);
   - `cardCreditDays` (padrão 30).

   Cada pedido aponta para a versão usada, como já acontece com a tarifa do Pix.
2. **Pausa por vendedor:**
   - `CheckoutSettings.cardPausedAt`, alterado só por uma rota do admin, com motivo na auditoria;
   - a tela do vendedor mostra "Cartão pausado pela Cifra+" e o Pix continua;
   - o vendedor só liga o cartão quando o cartão da conta Cifra+ estiver ligado.
3. **Fluxo do comprador:**
   - `POST /checkout/public/products/:slug/card/quote` recebe bumps, cupom e bandeira e devolve as
     parcelas (até o máximo do vendedor). Junto vão o `payeeCode` e o ambiente da conta Cifra+
     para a tokenização. A cotação fica gravada (`CheckoutCardQuote`, válida por 10 minutos).
   - `POST /checkout/public/products/:slug/card/orders` cria o pedido com o método cartão e faz a
     primeira tentativa. Os dados do pedido são os do Pix, mais a cotação, as parcelas, o token
     do cartão, o endereço e a chave idempotente.
   - Depois de uma recusa, `POST /checkout/public/orders/:token/card/pay` tenta de novo no mesmo
     pedido, com nova cotação e novo token.
   - **Endereço e cartão:** o endereço vai só para a Efí, não é gravado; o número do cartão nunca
     passa pela API.
4. **Valores:**
   - a % Cifra+ continua sobre `P`, fixada na criação do pedido;
   - **comprador paga o custo Efí:** `grossUpCard` sobre `P`;
   - **vendedor paga o custo Efí:** o comprador paga o total da Efí para o parcelamento escolhido
     (com os juros da conta, se houver). O custo Efí do vendedor é a diferença para `P` mais a
     tarifa sobre o total.
   - a tentativa guarda total, parcelas e custo Efí, e o pedido recebe os valores da tentativa
     reservada. Na confirmação, o saldo usa os valores do pedido.
5. **Tentativas** (`CheckoutCardAttempt`):
   - **id:** é o `custom_id` na Efí;
   - **campos:** chave idempotente única por pedido e hash do pedido;
   - **estados:** `SUBMITTING`, `APPROVED`, `PAID`, `DECLINED`, `CANCELED` e `UNCERTAIN`.

   Comportamento:
   - **reserva antes do envio:** a tentativa é gravada e só então a cobrança vai para a Efí;
   - **erro ou resposta perdida:** a tentativa vira `UNCERTAIN` e nunca é reenviada;
   - **conciliação:** um worker concilia `SUBMITTING` antigas, `UNCERTAIN` e `APPROVED`, consultando
     a Efí pelo `custom_id` ou pelo id da cobrança;
   - **uma de cada vez:** enquanto houver tentativa em andamento no pedido, não há outra;
   - **limites:** 3 tentativas por pedido e 5 por CPF/CNPJ em 24 h, contados no banco. O limite
     por IP é o `ThrottleGuard`: cotação 30 por minuto e pagamento 10 por hora.
6. **Notificação da Efí:**
   - **endereço:** `notification_url` = `/webhooks/efi/cobrancas?account=<identidade da Cifra+>`;
   - **roteamento:** no `WebhooksService`, uma identidade `PLATFORM` vai para o checkout;
   - **consulta:** a notificação é consultada com as credenciais da Cifra+;
   - **casamento:** a tentativa é achada pelo `custom_id`;
   - **efeito dos estados:**
     - `paid`: confirma o pedido pela mesma rotina do Pix (saldo, cupom, `order.paid`, e-mail e
       recuperados);
     - `unpaid`: recusa a tentativa;
     - `refunded` ou `contested`: anomalia para o admin.
   - **o que não casa:** vira `PaymentWebhookAnomaly`, com fonte `CARD` e motivo `CHECKOUT_…`.
7. **Saldo:** a venda no cartão libera no maior entre o pagamento + 7 dias e o pagamento +
   `cardCreditDays` da versão do pedido.
8. **Pedido recusado:**
   - **o estado:** um pedido de cartão sem pagamento fica `PENDING` até vencer (30 min, como o
     Pix);
   - **ao vencer:** com recusa, vira `DECLINED` (novo valor do enum) e gera `order.card_declined`
     uma vez; sem tentativa, vira `EXPIRED`;
   - **recuperação e anonimização:** `DECLINED` entra na Recuperação ("Cartão recusado") e na
     anonimização de 12 meses.
9. **Página do comprador:**
   - **forma de pagamento:** escolha entre Pix e Cartão, quando os dois estão ligados;
   - **bandeira:** detectada pela biblioteca `payment-token-efi`; se ela não reconhecer, o comprador
     escolhe;
   - **parcelas:** vêm sempre da cotação do servidor;
   - **CEP:** a consulta vai ao ViaCEP direto do navegador, e o aviso de privacidade ganha essa
     linha;
   - **recusa:** "Pagamento não autorizado pelo banco. Confira os dados, use outro cartão ou pague
     com Pix.", com o botão para o Pix.

## Modelo de dados (migration aditiva)

- **`CheckoutPlatformSettings`:** `cardEnabled` (padrão falso), `cardRates Json?` e
  `cardCreditDays Int?`.
- **`CheckoutSettings`:** `cardPausedAt DateTime?`.
- **`CheckoutOrder`:** `paymentMethod` (`PIX`/`CARD`, padrão `PIX`), `installments Int?` e o
  status `DECLINED`.
- **`CheckoutCardQuote`:**
  - **identidade:** id, empresa, produto e versão da conta Cifra+;
  - **o que foi cotado:** impressão digital de bumps, cupom e `P`, bandeira e opções;
  - **datas:** validade e criação.
- **`CheckoutCardAttempt`:**
  - **ligação:** id, pedido, empresa, identidade emissora e cotação;
  - **pedido do comprador:** chave idempotente e hash do pedido;
  - **valores:** bandeira, parcelas, valor enviado, total e custo Efí;
  - **resposta da Efí:** estado, id da cobrança Efí (único) e estado na Efí;
  - **datas:** criação e atualização.

  Índices por pedido, por estado e data, e o `@@unique([orderId, idempotencyKey])`.

## Tarefas

1. **Schema e migration**, conferida em banco descartável.
2. **Conta Cifra+, admin:**
   - tarifa do cartão, dias até o crédito e ligar ou desligar o cartão (versão esperada, `409`);
   - pausar e retomar o cartão de um vendedor, com motivo e auditoria.
3. **Cliente Efí do cartão na conta Cifra+:** parcelas, cobrança em um passo, consulta da
   cobrança, busca pelo `custom_id` e notificação. Reaproveita `normalizeCardInstallments`,
   `normalizeCardSubmission` e `grossUpCard`.
4. **Cotação e pagamento** (`CheckoutCardService`): cotação gravada, criação do pedido de cartão,
   nova tentativa, limites, reserva antes do envio, resultado incerto e recusa.
5. **Notificação, conciliação e vencimento:**
   - roteamento no `WebhooksService` e conciliação no worker;
   - confirmação pela rotina comum do Pix e liberação do saldo pela data do cartão;
   - `DECLINED`, `order.card_declined` e o cartão recusado na Recuperação.
6. **Vendedor:** ligar o cartão só com a conta Cifra+ pronta, aviso de pausa e o método nas Vendas.
7. **Frontend:**
   - admin: seção Cartão no painel da conta Cifra+ e a pausa no cliente;
   - comprador: escolha da forma de pagamento, formulário do cartão com CEP, parcelas, recusa e
     acompanhamento;
   - aviso de privacidade.
8. **Fluxo em banco descartável:**
   - o admin liga o cartão e o vendedor também;
   - cotação e pagamento aprovado pelo aviso da Efí, com saldo liberando em 30 dias;
   - recusa, nova tentativa e os limites;
   - resultado incerto conciliado;
   - pausa (cartão some, Pix continua);
   - o pedido recusado entra na Recuperação;
   - isolamento entre vendedores.
9. **Documentação:** AGENTS.md, spec, runbook (homologação e ligar o cartão) e registro.

## Fora desta parte

- Nome na fatura (soft descriptor) e o prazo real de crédito: dependem da Efí.
- Estorno de cartão pela API: o admin faz no app Efí e registra pela Parte 3.
- Reaproveitar o cartão para upsell (Parte 7).

## Registro de execução (08/11/2026, branch `feat/cifra-checkout-parte-6`)

As tarefas 1 a 9 foram executadas. Nada foi commitado nem publicado.

**Desvios do plano:**
- **Nova tentativa na própria página:** depois de uma recusa, o comprador tenta de novo no
  formulário da página do produto, no mesmo pedido, enquanto o carrinho não muda. A página do
  pedido mostra "em análise", "pago" ou "não autorizado", com o caminho de volta para o Pix.
- **CPF do titular:** a Efí pede o CPF de quem é dono do cartão. Ele vem do comprador quando é
  CPF, ou é digitado. Com CNPJ, a empresa vai como pessoa jurídica na cobrança.
- **Tentativa que nunca chegou à Efí:** se a Efí não mostra a cobrança pelo `custom_id` 30
  minutos depois, a tentativa é cancelada, e o pedido pode vencer ou receber outra tentativa.
- **Pagamento duplicado:** se duas tentativas forem pagas no mesmo pedido, a segunda vira anomalia
  para o admin.
- **Liquidação comum:** a confirmação do Pix e a do cartão usam a mesma rotina (`settle`), que
  marca o pedido como pago, dá baixa no saldo, conta o cupom, marca os recuperados, envia o
  `order.paid` e manda o e-mail.
- **Cliente Efí próprio:** `EfiCheckoutCardClient` com as credenciais da conta Cifra+, sem split.
  Reaproveita a normalização e o `grossUpCard` do cartão da cobrança.
- **Rota do admin para o vendedor:** responde 404, e não 403, como as outras rotas fora do
  produto da empresa.

**Checks executados:**
- **Backend:**
  - `npm test -- --runInBand`: 158 suítes, 1.335 testes;
  - `npm run build`;
  - `npx eslint`: só o erro antigo em `collection-rule-engine.spec.ts`;
  - `npm run test:e2e:checkout` (6) e `npm run test:e2e:checkout-pix` (22, 6 novos de cartão).
- **Migration:** aplicada do zero num PostgreSQL descartável, sem diferença no
  `prisma migrate diff`.
- **Frontend:** `npx jest --runInBand` (79 suítes, 492 testes), `npm run lint` (só o aviso
  conhecido) e `npm run build`.

**Pendências:**
- **Homologação:** a homologação de cartão na conta Cifra+, o prazo real de crédito e o nome na
  fatura dependem da Efí. O cartão fica desligado até lá.
- **Teste com cartão real:** a tokenização e a detecção de bandeira usam a biblioteca da Efí no
  navegador. Elas foram simuladas nos testes e precisam de um teste manual em homologação.
- **Revisão jurídica:** os textos novos do aviso de privacidade (cartão, endereço e CEP) não
  passaram por revisão.
