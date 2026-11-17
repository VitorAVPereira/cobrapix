# Cifra+ Checkout, Parte 10: planos e assinatura no cartão (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável; a Efí e o Resend são sempre simulados.

**Objetivo:** o vendedor cria planos para cada produto (parcelado ou recorrente), o comprador
escolhe o plano na página, e o plano recorrente renova sozinho no cartão. No Pix, o plano
recorrente renova por um e-mail com um Pix novo.

**Especificação:** [Planos e assinatura](../specs/2026-11-12-cifra-checkout-assinaturas-design.md)
(CK-43 da spec do checkout). O Pix Automático fica fora.

**Base:** branch `feat/cifra-checkout-parte-10`, aberto a partir de `feat/checkout-layout-hubla`
(`44c3b4d`), porque a página de pagamento nova ainda não está no `main`. Se a PR do layout mudar,
rebasear antes de abrir a PR desta parte.

## Decisões do responsável pelo produto

As 14 decisões (D1 a D14) e os 3 detalhes confirmados estão na spec. As que mais pesam aqui:

- plano **parcelado** é compra única com período de acesso; plano **recorrente** renova sozinho,
  à vista a cada ciclo;
- bump recorrente acompanha a periodicidade do plano escolhido, com um preço por periodicidade;
- bump de pagamento único e cupom entram só na primeira cobrança;
- falha na renovação: 7 dias de tolerância, depois cancela, com aviso ao vendedor por webhook;
- a escolha de repassar a taxa fica no plano, e a tela mostra o líquido do vendedor.

## Decisões técnicas (revisar se discordar)

1. **Plano (`CheckoutPlan`):**
   - pertence a um produto; até 6 planos ativos por produto;
   - **campos:** nome, `intervalMonths` (1, 3, 6 ou 12), `billing` (`INSTALLMENT` ou `RECURRING`),
     preço, "De", máximo de parcelas (só no parcelado), repasse da taxa no Pix e no cartão (nulo =
     Configurações), `active`, `position`, `version`;
   - **fixos depois da primeira venda:** `intervalMonths` e `billing`;
   - **escritas:** com versão esperada (`409 VERSION_CHANGED`);
   - **produto com plano ativo:** a página vende só pelos planos; o preço do produto deixa de valer
     na página e continua valendo quando o produto é bump de pagamento único ou oferta.
2. **Preço com plano:**
   - o item principal do pedido usa o preço e o período do plano (`accessPeriodMonths` =
     `intervalMonths`), e o item guarda `planId` e `recurring`;
   - o `quoteOrder` continua sendo a única conta; ele passa a receber o preço do plano e o repasse
     da taxa já resolvido (plano ou Configurações);
   - o cupom incide sobre o preço do plano.
3. **Bump recorrente:**
   - `CheckoutOrderBump.recurringPrices`: preço promocional por periodicidade (`{ "3": 990 }`);
   - só existe quando o produto oferecido tem plano recorrente daquela periodicidade;
   - num plano recorrente, o bump com preço para a periodicidade entra no valor do ciclo; os
     demais bumps continuam de pagamento único (D4);
   - num plano parcelado ou num produto sem plano, todo bump é de pagamento único, como hoje.
4. **Líquido do vendedor:** `POST /checkout/plans/preview` devolve, para Pix e cartão, com e sem
   repasse: total do comprador, taxa Efí, % Cifra+ e líquido.
   - usa as mesmas funções do pedido (`quoteOrder`, `grossUpCard`, `cardProcessingBasisPoints`);
   - no parcelado, mostra 1x e o máximo de parcelas, com as parcelas da Efí para a bandeira Visa,
     e a tela diz que o valor por bandeira pode variar em centavos;
   - sem conta Cifra+ ou sem cartão ligado, devolve só o que dá para calcular.
5. **Assinatura (`CheckoutSubscription`):**
   - **situações:** `PENDING` (primeiro pagamento em aberto), `ACTIVE`, `PAST_DUE`, `CANCELED`;
   - **fotografia na adesão:** plano, itens recorrentes, valor do ciclo (`P`), % Cifra+, tarifa,
     repasse da taxa e termos do vendedor;
   - **token do comprador:** 32 bytes, guardado só como SHA-256, enviado só por e-mail;
   - **cancelamento:** `cancelRequestedAt`, `canceledAt`, `cancelReason` (`BUYER`, `SELLER`,
     `ADMIN`, `PAYMENT_FAILED`, `REFUND`, `CHARGEBACK`) e `accessEndsAt`.
6. **Cada ciclo é um pedido:** `CheckoutOrder.subscriptionId` e `subscriptionCycle`, únicos em
   conjunto. O ciclo 1 é o pedido da compra; os seguintes nascem do aviso da Efí (cartão) ou da
   página da assinatura (Pix). Saldo, reembolso, webhook e API não mudam.
7. **Cartão recorrente na Efí:**
   - **plano na Efí:** um por periodicidade e por conta (`CheckoutEfiPlan`: identidade, meses,
     `plan_id`), criado na primeira venda, `repeats` nulo. Criar um plano a mais por engano não
     move dinheiro;
   - **adesão em dois passos:** `POST /v1/plan/:id/subscription` com `custom_id` = id da nossa
     tentativa, depois `POST /v1/subscription/:id/pay`. O `subscription_id` é gravado entre os
     dois. Resposta incerta no segundo passo: a tentativa fica `UNCERTAIN` e o worker consulta
     `GET /v1/subscription/:id`; nunca reenvia;
   - **valor:** um item só, com o total do ciclo 1 (itens recorrentes + bumps de pagamento único −
     cupom + acréscimo da taxa, se repassada). Sem parcelas: tarifa de crédito à vista;
   - **ajuste depois do ciclo 1:** se o valor do ciclo 1 difere do valor recorrente, a API troca o
     item com `PUT /v1/subscription/:id` logo depois do pagamento e confere pela consulta. Sem
     confirmação até 3 dias antes da cobrança seguinte, cancela a assinatura na Efí e avisa o
     admin (anomalia). Nunca cobra um ciclo com valor errado;
   - **tentativa sem cotação:** `CheckoutCardAttempt.quoteId` passa a ser opcional (ciclos de
     assinatura não têm cotação de parcelas).
8. **Aviso da Efí (`/webhooks/efi/cobrancas?account=`):** o `handleNotification` passa a ler o
   `type` de cada evento.
   - `subscription_charge` com `charge_id` novo: cria o pedido do ciclo e a tentativa, com
     `efiChargeId` único (dois avisos iguais não criam dois pedidos);
   - `paid`: confirma pela rotina de hoje (`confirmCard`);
   - `unpaid`: assinatura `PAST_DUE`, e-mail ao comprador, `subscription.renewal_failed`;
   - `subscription` `canceled` sem pedido nosso: cancela aqui com o motivo que a Efí informar;
   - aviso de assinatura desconhecida ou de outra conta: anomalia.
9. **Worker (no `checkout.worker.ts`, a cada 10 min):**
   - concilia adesões incertas;
   - cancela assinaturas `PAST_DUE` há mais de 7 dias (na Efí e aqui);
   - manda o aviso de renovação 7 dias antes (ciclos de 3 meses ou mais), uma vez por ciclo;
   - no Pix, manda o e-mail de renovação 7 dias antes do fim do período e cancela 7 dias depois
     do fim sem pagamento;
   - refaz o ajuste de itens pendente (item 7).
10. **Página do comprador (`/checkout/public/subscriptions/:token`):** ver, cancelar, trocar o
    cartão (token novo da Efí; com ciclo `unpaid`, usa `POST /v1/charge/:id/retry`; sem, usa
    `PUT /v1/subscription/:id`) e, no Pix, gerar o Pix do ciclo seguinte. Limite de 20
    requisições por minuto por IP.
11. **Reembolso e contestação:**
    - o pedido do comprador pelo link do e-mail só vale no ciclo 1 (`CHECKOUT_REFUND_RENEWAL`
      nos demais);
    - reembolso concluído do ciclo 1 e contestação de qualquer ciclo cancelam a assinatura, na
      mesma transação do lançamento, com o cancelamento na Efí logo depois (refeito pelo worker
      se falhar).
12. **Webhook e API:**
    - `order.*` de um pedido com plano traz `plan` (id, nome, periodicidade, tipo) e, com
      assinatura, `subscription` (id, ciclo, `currentPeriodEnd`);
    - eventos novos: `subscription.activated`, `subscription.renewal_failed`,
      `subscription.canceled`. Entram na lista de eventos das regras de webhook;
    - `GET /checkout/api/v1/subscriptions` e `.../:id`; `products` passa a listar os planos.
13. **Recuperação:** ciclo de renovação recusado ou vencido aparece com o tipo "Renovação".
14. **Telas do vendedor:** Planos (nova, na barra lateral), botão "Planos" em Produtos,
    Assinaturas (nova), preços recorrentes no painel de bumps e a prévia da página com o seletor
    de plano.
15. **Página `/c/<slug>`:** seletor "Plano" (aceita `?plano=<id>`), preço por período, texto de
    autorização no recorrente e sem seletor de parcelas no cartão recorrente.

## Verificações na homologação da Efí (antes da Tarefa 5)

Precisam das credenciais de homologação da conta Cifra+; os testes automáticos simulam a Efí.

- Criar plano com `interval` 3 e 6.
- Adesão em dois passos e o que `GET /v1/subscription/:id` devolve em cada situação.
- `PUT /v1/subscription/:id` trocando o valor do item antes do ciclo 2. **Se não funcionar**, o
  bump de pagamento único vira uma cobrança avulsa separada, com o token reutilizável, e a Tarefa
  5 muda.
- Formato do aviso `subscription_charge` e o que acontece quando o cartão recusa a renovação.
- Troca de cartão pelo `retry` e pelo `PUT`.

## Modelo de dados (migration aditiva)

- **`CheckoutPlan`:** id, `companyId`, `productId`, nome, `intervalMonths`, `billing`,
  `priceCents`, `compareAtPriceCents`, `maxInstallments`, `pixFeePayer`, `cardFeePayer`, `active`,
  `position`, `version`, datas.
- **`CheckoutEfiPlan`:** `identityId`, `intervalMonths` (únicos em conjunto), `efiPlanId`.
- **`CheckoutSubscription`:** id, `companyId`, `productId`, `planId`, comprador (nome, e-mail,
  documento, celular), `paymentMethod`, `status`, `intervalMonths`, `items`, `cycleCents`, % e
  tarifa fotografadas, `feePayer`, `termsId`, `issuerIdentityId`, `efiSubscriptionId` (único),
  `itemsAdjustedAt`, `currentPeriodEnd`, `renewalNoticeCycle`, `pastDueSince`,
  `cancelRequestedAt`, `canceledAt`, `cancelReason`, `accessEndsAt`, `tokenHash` (único),
  `anonymizedAt`, datas.
- **`CheckoutOrder`:** `planId`, `subscriptionId`, `subscriptionCycle`; único
  (`subscriptionId`, `subscriptionCycle`).
- **`CheckoutOrderBump.recurringPrices`:** JSON opcional.
- **`CheckoutCardAttempt.quoteId`:** passa a aceitar nulo.
- **Dados:** nenhum produto ganha plano; nada existente muda.

## Tarefas

1. **Schema e migration.** Modelos acima; migration testada em banco descartável.
2. **Planos no backend.** `CheckoutPlansService` e rotas `/checkout/plans` (listar por produto,
   criar, editar, ativar, ordenar), com isolamento (404), limite de 6 e campos fixos depois da
   venda. Teste: A não vê nem altera plano de B.
3. **Líquido do vendedor.** `POST /checkout/plans/preview`. Teste: o líquido da prévia é igual
   ao lançado no saldo de um pedido com os mesmos dados, com e sem repasse.
4. **Preço com plano.** `view`, `quote` e `prepare` aceitam `planId`; bumps recorrentes;
   repasse da taxa do plano. Plano parcelado vende de ponta a ponta no Pix e no cartão, pelo
   fluxo de hoje. Teste: produto sem plano não muda; plano inativo ou de outro produto é
   recusado; o navegador não define valor.
5. **Cliente Efí de assinatura.** Criar plano, criar assinatura, pagar, consultar, alterar
   item, cancelar, retentativa e leitura do aviso com `type`.
6. **Adesão no cartão.** Pedido do ciclo 1, tentativa, assinatura em dois passos, incerteza
   conciliada, limites de tentativa. Teste: resposta perdida no segundo passo não cria segunda
   assinatura nem segunda cobrança.
7. **Renovação pelo aviso da Efí.** Pedido do ciclo, confirmação, `PAST_DUE`, ajuste de itens
   depois do ciclo 1. Teste: aviso repetido não duplica; bump de pagamento único e cupom não
   entram no ciclo 2; ajuste não confirmado cancela.
8. **Ciclo de vida no worker.** Tolerância de 7 dias, avisos de renovação e o Pix recorrente
   manual.
9. **Página do comprador.** Rotas públicas da assinatura: ver, cancelar, trocar cartão e Pix de
   renovação.
10. **Reembolso e contestação.** Regras do item 11.
11. **Webhook, API e recuperação.** Blocos `plan` e `subscription`, eventos novos, rotas de
    consulta e o tipo "Renovação".
12. **E-mails.** Confirmação com "Gerenciar assinatura", aviso de renovação, falha, renovação por
    Pix e cancelamento, pela fila `checkout-mail`.
13. **Cancelamento pelo vendedor e pelo admin.** Rotas e auditoria; anomalias de assinatura no
    admin.
14. **Telas do vendedor.** Planos, botão em Produtos, líquido ao digitar, "Copiar link" com a
    explicação de cada tipo, bumps recorrentes e Assinaturas.
15. **Página de pagamento e prévia.** Seletor de plano, texto de autorização, cartão recorrente
    sem parcelas, e a página `/c/assinatura/<token>`.
16. **Anonimização e textos.** Assinatura que nunca foi paga entra na rotina de 12 meses;
    trecho de cobrança recorrente em `/privacidade-checkout` e `/termos-checkout`.
17. **E2E e documentação.** Casos no `test:e2e:checkout-pix`; `AGENTS.md`, runbook
    `checkout-conta-cifra.md` e situação na spec.

## Registro de execução

### 12/11/2026: Tarefas 1 a 4 (backend)

Feito, sem commit:

- **Tarefa 1:** `CheckoutPlan`, `CheckoutPlanBilling` e `CheckoutOrder.planId`; migration
  `20261113120000_checkout_plans`, aplicada no banco descartável pelo e2e.
- **Tarefa 2:** `CheckoutPlansService` e rotas `/checkout/plans` (listar, criar, editar, ativar e
  ordenar), com 404 para outra empresa, limite de 6 ativos e periodicidade e tipo fixos depois da
  venda (`CHECKOUT_PLAN_LOCKED`).
- **Tarefa 3:** `POST /checkout/plans/preview`, com o Pix pelo `quoteOrder` e o cartão pelo
  mesmo cálculo de parcelas do pedido (`CheckoutCardService.optionsFor`, extraído do `price`).
- **Tarefa 4:** `planId` na página, na cotação e no pedido de Pix e de cartão; produto com plano
  recusa a compra sem plano (`CHECKOUT_PLAN_REQUIRED`); o plano entra na conferência da cotação
  do cartão.

Desvios do plano:

- **Tarefa 1 menor:** as tabelas de assinatura (`CheckoutSubscription`, `CheckoutEfiPlan`), os
  preços recorrentes do bump e o `quoteId` opcional ficam para a migration das Tarefas 5 a 7.
  Motivo: o desenho delas depende das verificações na homologação da Efí, que não terminaram.
- **Plano recorrente ainda não vende:** dá para criar, mas a página lista só planos parcelados
  (`SELLABLE_BILLING`) até a renovação existir. Um produto só com planos recorrentes segue
  vendendo pelo preço do produto.

Verificações na homologação da Efí (12/11): planos com `interval` 3 e 6 e o passo 1 da assinatura
funcionaram. O pagamento com cartão foi recusado pela conta (`4600037`, limite operacional),
também numa cobrança avulsa, então a troca de valor e a troca de cartão seguem sem teste.

Testes: 1.398 unitários do backend, `test:e2e:checkout-pix` (36) e `test:e2e:checkout` (6)
passando; build OK. O lint acusa um erro de formatação em
`billing/collection-rule-engine.spec.ts`, arquivo que esta parte não tocou.

## Ordem de publicação

Migration aditiva, backend e depois frontend. Com backend novo e frontend antigo, nenhum produto
tem plano e a página antiga segue vendendo como hoje.

## Riscos e pendências

- **Cartão desligado em produção:** o plano recorrente no cartão só vende depois de ligar o
  cartão na conta Cifra+. Até lá, vale o Pix com renovação por e-mail.
- **Ajuste de itens depois do ciclo 1** depende do que a homologação mostrar.
- **Tarifa e prazo de crédito** das cobranças de assinatura: confirmar com a Efí; o código usa a
  tarifa de crédito à vista e os dias de crédito configurados pelo admin.
- **Textos sem revisão jurídica:** autorização da cobrança recorrente, cancelamento e reembolso
  só no primeiro ciclo.
