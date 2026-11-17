# Cifra+ Checkout: planos e assinatura com renovação automática (12/11/2026)

> **Situação:** decisões e interpretações confirmadas pelo responsável pelo produto em
> 12/11/2026. Nada implementado.
> Detalha o item **CK-43** da [spec do checkout](2026-10-30-cifra-checkout-design.md) e muda duas
> decisões dela: "Período de acesso" (não havia renovação automática) e "Seletor de planos na
> mesma página" (estava fora do escopo).

## Pedido

O primeiro cliente do checkout vende hoje, na Hubla, uma assinatura trimestral de R$ 29,90 com
renovação automática, e um dos order bumps também é cobrado por trimestre. Ele precisa da
renovação automática para migrar.

Esta entrega cobre a **base e o cartão**, pela conta Efí da Cifra+
([API de assinaturas](https://dev.efipay.com.br/docs/api-cobrancas/assinatura)). O **Pix
Automático fica para depois**, quando o responsável confirmar as condições com a Efí.

## O que a documentação da Efí diz (lida em 12/11/2026)

- Um **plano** tem nome, intervalo em meses e repetições (`repeats` nulo = sem fim). A
  **assinatura** liga um plano a itens e a um cartão; a Efí cobra sozinha a cada intervalo, no
  mesmo dia do mês da primeira cobrança.
- Criação em dois passos: `POST /v1/plan/:id/subscription` (não move dinheiro) e
  `POST /v1/subscription/:id/pay` (define o cartão e faz a primeira cobrança).
- Cobrança recorrente sem o pagador presente **deve** usar a API de assinaturas, não cobranças
  avulsas com token reutilizável.
- **Não há parcelamento** nos campos da assinatura: cada ciclo é cobrado à vista.
- Recusa na renovação deixa a cobrança `unpaid`. Não há retentativa automática documentada;
  existe `POST /v1/charge/:id/retry`, que aceita um cartão novo.
- A notificação chega pela mesma `notification_url`, com `type` `subscription` ou
  `subscription_charge` e `subscription_id` (a avulsa vem como `charge`).
- `PUT /v1/subscription/:id` troca itens, plano e cartão; `PUT /v1/subscription/:id/cancel`
  cancela.

## Decisões do responsável pelo produto (12/11/2026)

| # | Tema | Decisão |
| --- | --- | --- |
| D1 | Planos | O vendedor cria os **planos** de cada produto antes de vender: periodicidade (mensal, trimestral, semestral ou anual), valor e **tipo de cobrança**. Há uma tela **Planos** na barra lateral, e a tela Produtos tem um botão que leva a ela. |
| D2 | Tipo de cobrança do plano | **Parcelado:** o período é pago de uma vez, em até 12x com juros no cartão (ex.: anual de R$ 75,00 em até 12x). **Recorrente:** o valor é cobrado à vista a cada ciclo (ex.: R$ 75,00 uma vez por ano), com renovação automática. |
| D3 | Bump recorrente | Entra, sempre com a mesma periodicidade do plano. Se o comprador troca o plano na página, os bumps recorrentes trocam junto. |
| D4 | Bump de pagamento único num plano recorrente | Cobrado só na primeira cobrança. |
| D5 | Cupom | Vale só na primeira cobrança. |
| D6 | Preço para quem já assina | Fica o preço da adesão. Mudar o plano vale só para novos assinantes. |
| D7 | Falha na renovação | 7 dias de tolerância com o acesso mantido; sem pagamento, cancela. O vendedor é avisado **por webhook** na falha e no cancelamento. |
| D8 | Cancelamento | Por enquanto: o comprador cancela sozinho pelo link do e-mail; o vendedor e o admin também cancelam. O acesso vai até o fim do período pago. |
| D9 | Reembolso | Por ciclo, como hoje. O pedido direto do comprador vale 7 dias depois da **primeira** compra; em renovações, só o vendedor pede. Reembolso do primeiro ciclo cancela a assinatura. |
| D10 | Chargeback em qualquer ciclo | Cancela a assinatura na hora. |
| D11 | Pix num plano recorrente | Sem Pix Automático, o Pix paga o período e não renova sozinho: perto do fim, o comprador recebe um e-mail com um Pix para renovar. |
| D12 | Aviso antes de renovar | E-mail 7 dias antes, em ciclos de 3 meses ou mais. |
| D13 | Taxa | O vendedor escolhe se a taxa é repassada ao comprador, e a tela mostra **quanto ele recebe líquido** em cada caso, já descontadas a taxa Efí e a % Cifra+. |
| D14 | Escopo | Só base e cartão. Pix Automático fica para outra entrega. |

## Detalhes confirmados (12/11/2026)

1. **Plano parcelado não renova sozinho.** A Efí não parcela cobrança de assinatura, então o
   plano parcelado é uma compra única com período de acesso, como o produto de hoje: no fim do
   período o comprador compra de novo. Só o plano recorrente tem renovação automática. **A tela
   deixa isso claro ao vendedor** ao criar o plano e ao copiar o link de pagamento.
2. **A escolha de repassar a taxa (D13) fica no plano**, e não só nas Configurações do checkout.
   Sem escolha no plano, vale a das Configurações.
3. **Preço do bump recorrente por periodicidade.** Como o bump acompanha o plano escolhido, o
   vendedor informa o preço promocional do bump para cada periodicidade dos planos recorrentes
   do produto principal. Sem preço para uma periodicidade, o bump não aparece naquele plano.

## Fora do escopo

- Pix Automático (D14).
- Migrar os assinantes atuais da Hubla (os cartões salvos lá não saem de lá; eles recompram).
- Free trial.
- Troca de plano por quem já assina (upgrade e downgrade).
- Plano como oferta de upsell ou downsell. Uma oferta de pagamento único depois de uma assinatura
  continua valendo.
- Reajuste de preço para assinantes ativos.
- Reembolso executado pela API (segue manual, pelo admin, como na Parte 3).

## Como funciona

### Vendedor

- **Tela Planos** (barra lateral, e botão "Planos" na tela Produtos): lista por produto, com
  criar, editar, ativar e desativar. Cada plano tem nome, periodicidade, valor, "De / Por", tipo de
  cobrança (parcelado ou recorrente), máximo de parcelas (só no parcelado) e a escolha de repassar
  a taxa.
- **Líquido à vista do vendedor (D13):** ao digitar o valor, a tela mostra, para Pix e para
  cartão, com e sem repasse: o que o comprador paga, a taxa Efí, a % Cifra+ e o líquido. No
  parcelado, mostra o líquido na 1ª e na última parcela permitida. O cálculo vem da API, com as
  mesmas regras do pedido.
- **Link de pagamento:** cada plano tem o botão "Copiar link" (`/c/<slug>?plano=<id>`). Ao lado,
  a tela diz o que o link vende: "Renova sozinho a cada <período>" no recorrente, ou "Pagamento
  único: no fim do período o cliente compra de novo" no parcelado.
- **Produto sem plano** continua como hoje: preço único do produto.
- **Plano com assinantes:** periodicidade e tipo ficam fixos; o valor pode mudar e vale só para
  novas adesões (D6). Desativar um plano tira o plano da página e não cancela quem já assina.
- **Tela Assinaturas:** ativas, em atraso e canceladas, com filtros por produto, plano e
  situação, próxima cobrança, forma de pagamento e o botão "Cancelar". A venda de cada ciclo
  continua em Vendas, ligada à assinatura.
- **Recuperação:** renovação que falhou entra na lista, com o tipo "Renovação".
- **Order bump:** quando o produto oferecido tem plano recorrente, o bump pode ser recorrente,
  com um preço por periodicidade (ponto 3 acima).

### Comprador

- **Página `/c/<slug>`:** com mais de um plano ativo, aparece o seletor "Plano". Trocar o plano
  troca o preço, as parcelas, o total e os bumps recorrentes (D3). O link aceita `?plano=<id>` para
  já abrir num plano.
- **Plano recorrente:** o preço aparece "por mês / trimestre / semestre / ano" e, antes do botão,
  o texto de autorização da cobrança recorrente, com o valor e a periodicidade. No cartão não há
  seletor de parcelas.
- **Plano parcelado:** igual à compra de hoje, com o seletor de parcelas.
- **Pix num plano recorrente (D11):** paga o período. A página diz que a renovação não é
  automática no Pix.
- **E-mails:** confirmação com o link "Gerenciar assinatura", aviso antes de renovar (D12), falha
  na renovação, renovação por Pix (D11) e cancelamento.
- **Página `/c/assinatura/<token>`:** situação, próxima cobrança, cancelar, trocar o cartão e,
  no Pix, pagar a renovação. O token só dá acesso a essa assinatura.

### Ciclos

- Cada cobrança de um ciclo é um **pedido** (`CheckoutOrder`) com `subscriptionId` e o número do
  ciclo. Assim saldo, liberação, reembolso, contestação, webhook e API continuam os mesmos.
- A assinatura fotografa, na adesão, o plano, os itens recorrentes, o valor do ciclo, a % Cifra+,
  a tarifa e quem paga a taxa.
- Situações da assinatura: aguardando o primeiro pagamento, ativa, em atraso, cancelada.
- A compra de um plano parcelado não cria assinatura: é um pedido comum, com o plano e o período
  de acesso gravados.

### Cartão (plano recorrente)

1. A página tokeniza o cartão, como hoje.
2. A API grava o pedido do ciclo 1 e a tentativa, e cria a assinatura na Efí **em dois
   passos**. O primeiro passo não move dinheiro; se o segundo ficar incerto, a consulta
   `GET /v1/subscription/:id` diz o que houve. Nunca se reenvia.
3. Bump de pagamento único e cupom (D4 e D5): os itens da assinatura na Efí são os mesmos em
   todos os ciclos. Proposta técnica: o ciclo 1 leva os itens e o desconto da primeira cobrança e,
   depois de pago, a API ajusta os itens com `PUT /v1/subscription/:id`; se o ajuste não for
   confirmado antes da cobrança seguinte, a assinatura é cancelada na Efí, para nunca cobrar um
   valor errado. **Validar na homologação.**
4. Renovação: a Efí cobra e avisa (`subscription_charge`). A API cria o pedido do ciclo pelo
   `charge_id` (sem duplicar) e confirma pela mesma rotina de hoje.
5. Recusa: a assinatura fica em atraso por 7 dias (D7); o comprador troca o cartão pela página
   dele, que usa a retentativa da Efí. Sem pagamento, a API cancela a assinatura na Efí.
6. Os limites de tentativa por pedido, CPF e IP valem na adesão.

### Pix (plano recorrente, sem Pix Automático)

1. O primeiro ciclo é o Pix de 30 minutos de hoje.
2. Sete dias antes do fim do período, o comprador recebe o e-mail de renovação. O link abre a
   página da assinatura, que gera um Pix novo para o ciclo seguinte.
3. Sem pagamento até 7 dias depois do fim do período, a assinatura é cancelada (D7).

### Webhook ao vendedor e API

- `order.paid` de cada ciclo passa a trazer os blocos `plan` e `subscription` (id, ciclo, fim do
  período). Num plano parcelado vem só `plan`.
- Eventos novos: `subscription.activated`, `subscription.renewal_failed` e
  `subscription.canceled` (com o motivo e a data em que o acesso acaba). **Mudou em 16/11:** são
  dois avisos de cancelamento, ver a D10 da
  [spec da conta do vendedor](2026-11-13-cifra-checkout-conta-do-vendedor-design.md).
- API de consulta: `GET /checkout/api/v1/subscriptions` e `.../subscriptions/:id`; os produtos
  passam a listar os planos.

## Modelo de dados (migration aditiva)

- `CheckoutPlan`: empresa, produto, nome, periodicidade em meses, tipo de cobrança, valor,
  "De", máximo de parcelas, repasse da taxa (nulo = Configurações), ativo e versão.
- `CheckoutOrderBump`: preços do bump recorrente por periodicidade.
- `CheckoutSubscription`: empresa, produto, plano, comprador, forma de pagamento, situação,
  itens e valores fotografados, fim do período atual, cancelamento (quem, quando e motivo), hash
  do token do comprador, conta emissora e os identificadores da Efí (`subscription_id` e
  `plan_id`).
- `CheckoutOrder`: `planId`, `subscriptionId` e `subscriptionCycle` (os dois últimos únicos em
  conjunto).
- Dados existentes não mudam: todo produto atual continua sem plano, de pagamento único.

## Segurança e LGPD

- A API não guarda cartão: o cartão fica na assinatura da Efí.
- O token de "Gerenciar assinatura" é guardado só como hash e não dá acesso ao pedido.
- Plano e assinatura de outra empresa respondem 404.
- O aviso de privacidade e os Termos do checkout ganham o trecho da cobrança recorrente. Os dois
  seguem sem revisão jurídica.

## A confirmar com a Efí

- Intervalo de 3 e de 6 meses no plano de cartão: o campo `interval` é um número de meses, e o
  responsável informou que a Efí aceita. Conferir na homologação ao criar o primeiro plano.
- Assinatura de cartão exige homologação além da do cartão avulso?
- Tarifa e prazo de crédito das cobranças de assinatura.
- Pix Automático (para a entrega seguinte): habilitação na conta Cifra+, tarifa, periodicidades,
  antecedência para criar a cobrança de cada ciclo, cancelamento pela API e homologação.

## Critérios de pronto e testes

- **Isolamento:** plano e assinatura de outra empresa respondem 404; empresa `BILLING` não acessa.
- **Planos:** a página mostra só planos ativos; trocar o plano troca o total e os bumps
  recorrentes; o navegador nunca define o valor.
- **Líquido:** o valor mostrado ao vendedor é igual ao lançado no saldo de uma venda real, com e
  sem repasse da taxa.
- **Dinheiro:** aviso repetido da Efí não cria dois pedidos do mesmo ciclo; criação incerta não
  é reenviada; ciclo pago lança venda, tarifa e % Cifra+ uma vez; bump de pagamento único e cupom
  nunca entram no ciclo 2.
- **Ciclo de vida:** falha na renovação marca atraso, avisa por webhook e cancela depois de 7
  dias; cancelamento mantém o acesso até o fim do período; chargeback cancela na hora.
- **Pix:** plano recorrente pago por Pix não renova sozinho e gera o e-mail de renovação.
- **Dados antigos:** produtos sem plano, pedidos e webhooks de pagamento único não mudam.
- **Banco:** migration aditiva, testada em banco descartável.
