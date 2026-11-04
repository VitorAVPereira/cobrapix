# Cifra+ Checkout: venda de produtos digitais pela conta Cifra+ (30/10/2026)

## Pedido

Novo produto: um checkout para vendedores de produtos digitais. O pagamento cai sempre na conta
Efí da **Cifra+**, que retém os valores por 7 dias para cuidar de reembolso e chargeback e depois
repassa ao vendedor. O vendedor vê os Pix gerados e não pagos e os cartões recusados para fazer
remarketing.

- **Admin:** cadastra um novo cliente de checkout. O usuário desse cliente só vê as telas do
  checkout.
- **Usuário (vendedor):** configura a tela de checkout, decide se o custo das taxas fica com o
  comprador (Pix e cartão; sem BOLIX por enquanto), cria produtos e adiciona order bumps.

## Decisões do responsável pelo produto

| Tema | Decisão |
| --- | --- |
| Conta recebedora | Sempre a conta Efí da Cifra+. Efí e contador já aprovaram o modelo. |
| Liberação ao vendedor | Pix: 7 dias depois do pagamento. Cartão: no que vier por último, 7 dias ou o crédito da Efí na conta Cifra+. A Cifra+ nunca adianta dinheiro próprio. |
| Remuneração Cifra+ | Percentual por venda paga, definido pelo admin para cada cliente. |
| Taxas ao comprador | O acréscimo cobre só o custo Efí. A % Cifra+ sai sempre do vendedor. |
| Repasse | **Fora do sistema:** o admin faz o Pix pelo app da Efí e registra o repasse (valor, data, referência do comprovante). O sistema mostra o valor calculado; não envia Pix. |
| Chargeback | Reserva de 1% retida por 30 dias, **manejada pelo admin** no valor do repasse. Não há lógica de reserva no código. |
| Reembolso | O vendedor pede na tela da venda; o admin devolve pela Efí e registra no sistema. |
| Entrega | O vendedor escolhe por produto: **link de acesso** (redireciona o comprador quando a página está aberta e manda o mesmo link por e-mail na confirmação), **webhook** para o sistema dele, ou os dois. |
| Período de acesso | Não há renovação automática. A "assinatura" é um pagamento único (parcelável no cartão) que dá acesso por um período (ex.: 3 meses ou 1 ano) no sistema do vendedor. O produto informa o período, e o webhook leva a data de fim do acesso. Para renovar, o comprador compra de novo. |
| Extras da página | Preço "De / Por" (produto e bumps), banner no topo, botão flutuante de WhatsApp do vendedor e cupom de desconto. |
| Tipo de cliente | Só checkout. Precisando de cobrança também, cria-se outra empresa. |
| Cartão | Sai junto com o Pix no código, mas fica desligado até a homologação de cartão na conta Cifra+. |
| Order bump | Outro produto do vendedor com preço promocional, oferecido no checkout de um produto principal. |
| Validade do Pix | 30 minutos. |
| Dados do comprador | Nome, e-mail, CPF e celular, todos obrigatórios. |
| Configuração da tela | Logo e cor principal; nome exibido e contato de suporte; formas de pagamento e máximo de parcelas (até 12x); taxas ao comprador por forma de pagamento. |
| O que o vendedor vê | Vendas com tarifas e % Cifra+; saldo "a liberar" (com data), "liberado" e repasses registrados. |
| Dados de repasse | CPF/CNPJ e chave Pix do vendedor: só o admin cadastra e altera, com auditoria. |
| Retenção | Dados pessoais de tentativas não pagas (Pix expirado, cartão recusado) ficam 12 meses; depois são apagados e ficam só os números. |
| Recuperação | Lista com filtros (produto, período, tipo), botão de WhatsApp e de copiar contato, e marcação automática de "recuperado". |

## Relação com o que já existe

- **A Fase B continua bloqueada para a cobrança.** Faturas e `PaymentCharge` seguem recusando
  `PLATFORM_ACCOUNT` (`FINANCIAL_MODE_NOT_SUPPORTED`). O checkout é um módulo novo (`checkout/`),
  com tabelas próprias, e não emite fatura, não usa régua nem ativação financeira.
- **Reaproveita:**
  - a identidade Efí da plataforma (`EfiAccountIdentity` com `ownership = PLATFORM`) e as
    credenciais cifradas;
  - os clientes Efí de Pix e cartão (`efi-gateway.client`, `efi-card.client`);
  - o cálculo do cartão (`grossUpCard`);
  - o webhook Pix mTLS e a notificação de cartão;
  - o envio de e-mail pelo Resend;
  - `PaymentCryptoService`;
  - auditoria;
  - `useApiClient()`.
- **Não reaproveita** `Invoice`, `Debtor`, `PaymentCharge` nem `FinancialLedgerEntry`. Esses
  modelos assumem fatura, devedor e conta emissora do cliente; forçar o checkout neles misturaria
  a conciliação de split com o saldo do vendedor.

## Referência: checkout atual do primeiro cliente (Hubla)

Duas páginas do mesmo produto (planos anual e trimestral), usadas só como referência de
conteúdo, não de layout:

- banner no topo;
- produto com "De / Por" e a parcela;
- cupom;
- e-mail, telefone e nome;
- Cartão ou Pix (o Pix pede só o CPF/CNPJ);
- três bumps com faixa de destaque, caixa de seleção, imagem e "De / Por";
- seletor de parcelas;
- botão "Pagar";
- botão flutuante de WhatsApp.

O que fazemos diferente:

- **Só Brasil e real.** Sem a lista de 250 países e sem troca de moeda, o que deixa o formulário
  mais curto no celular.
- **Total transparente.** O total mostra o acréscimo da forma de pagamento quando o vendedor
  repassa a taxa, e a parcela vem da cotação do backend.
- **Pix com contagem regressiva** de 30 minutos e confirmação automática na página.
- **Recusa em linguagem simples**, com a sugestão de pagar por Pix.
- **Recuperação e saldo** na mesma conta, com o repasse acompanhado pelo vendedor.

## Fluxos

### Admin

1. **Admin → Empresas → Novo cliente de checkout.** Os campos são:
   - dados da empresa e do usuário (mesmo fluxo de primeiro acesso de hoje);
   - % Cifra+ por venda;
   - CPF/CNPJ e chave Pix de repasse.

   A empresa nasce com `product = CHECKOUT`.
2. **Admin → Checkout** (lista de clientes de checkout). Em cada cliente, o admin:
   - vê vendas, saldo a liberar, liberado e repassado;
   - registra um repasse (valor, data, referência do comprovante, observação);
   - vê os pedidos de reembolso e registra o reembolso ou a contestação (chargeback);
   - altera a % Cifra+ e os dados de repasse (versão esperada, auditoria).
3. A % Cifra+ vale para vendas pagas **depois** da alteração. Cada venda fotografa a % do momento.

### Vendedor (usuário da empresa de checkout)

O menu mostra só **Vendas**, **Recuperação**, **Produtos** e **Configurações do checkout**.

- **Produtos:**
  - cada produto tem nome, descrição, preço, preço "De" (opcional, maior que o preço), imagem
    (opcional), período de acesso em meses (opcional, informativo) e ativo/inativo;
  - a entrega é escolhida no produto: link de acesso (URL obrigatória), webhook, ou os dois;
  - o link público fica em `/c/<slug>`, um link por produto (sem seletor de planos na página:
    anual e trimestral são dois produtos);
  - dentro do produto, há até 6 order bumps: outro produto ativo do vendedor e um preço
    promocional;
  - desativar um produto tira o link do ar sem apagar as vendas.
- **Cupons:**
  - código, desconto em % ou em valor fixo, produtos em que vale (todos ou alguns), validade
    (opcional), limite de usos (opcional) e ativo/inativo;
  - o desconto vale sobre o produto principal, não sobre os bumps;
  - o preço com desconto nunca fica abaixo de R$ 5,00.
- **Configurações do checkout:**
  - logo, banner do topo, cor principal, nome exibido e contato de suporte;
  - WhatsApp do vendedor para o botão flutuante (opcional);
  - webhook: URL (só `https`) e um botão "Enviar teste"; o segredo de assinatura é gerado pelo
    sistema e mostrado uma vez, com opção de gerar outro;
  - Pix e cartão ligados ou desligados, e o máximo de parcelas;
  - quem paga o custo Efí no Pix e no cartão (comprador ou vendedor).

  O cartão só pode ser ligado quando o admin tiver habilitado cartão na conta Cifra+.
- **Vendas:**
  - cartões de saldo: a liberar (com a próxima data), liberado não repassado e repassado no
    período;
  - lista de vendas com produto e bumps, forma de pagamento, valor pago, custo Efí, % Cifra+,
    líquido, data de liberação e situação;
  - na venda, o botão "Pedir reembolso" (com motivo).
- **Recuperação:**
  - pedidos não pagos (Pix expirado ou cartão recusado), com comprador, contato, produto, valor,
    quando e motivo em linguagem simples;
  - filtros por produto, período e tipo;
  - botão "Chamar no WhatsApp" (`wa.me`, do aparelho do vendedor) e "Copiar contato";
  - um pedido some da lista como "recuperado" quando o mesmo comprador (CPF, mesma empresa) paga
    o mesmo produto em até 30 dias.

### Comprador (`/c/<slug>`, sem login)

1. A página mostra banner, produto com "De / Por" e o período de acesso, campo de cupom, dados
   obrigatórios, forma de pagamento, bumps (caixa de seleção, com "De / Por") e o botão de
   WhatsApp do vendedor, quando configurado. O cupom é validado pelo backend e o total mostrado
   sempre vem da cotação do backend.
2. **Pix:**
   - o backend cria o pedido com os itens e os valores fotografados;
   - emite um Pix na conta Cifra+, com validade de 30 minutos e `txid` com prefixo próprio do
     checkout;
   - a página mostra o QR Code e o copia e cola, e consulta o estado.
3. **Cartão:**
   - o cartão é tokenizado no navegador (JS da Efí, conta Cifra+);
   - o backend cota as parcelas e cobra com chave idempotente, reaproveitando o fluxo atual de
     cartão;
   - uma recusa fica registrada no pedido, e o comprador pode tentar de novo, com limite.
4. **Pagamento confirmado** (webhook Pix ou notificação do cartão, nunca o navegador): o pedido
   vira pago e os lançamentos de saldo são criados. Depois, conforme a entrega de cada item:
   - **link de acesso:** a página redireciona para a URL do produto principal e um e-mail com o
     link de cada item sai para o comprador;
   - **webhook:** o sistema avisa o vendedor (seção "Webhook ao vendedor"), e a página mostra
     "Pagamento confirmado" com as instruções de acesso que o vendedor escreveu no produto.

### Webhook ao vendedor

- Eventos: `order.paid`, `order.refunded` e `order.chargeback`. Não há evento de renovação nem de
  cancelamento, porque não há assinatura recorrente.
- O corpo leva:
  - id do evento e do pedido;
  - os itens, cada um com o período de acesso e a data de fim do acesso (`accessExpiresAt`,
    contada da confirmação do pagamento);
  - o valor pago;
  - o comprador (nome, e-mail, celular e CPF).
- Assinatura HMAC com o segredo do vendedor no cabeçalho, e id do evento estável para o vendedor
  descartar repetições.
- Entrega fora da requisição (fila BullMQ). Qualquer resposta fora de 2xx é repetida com intervalo
  crescente por até 24 h; depois, a entrega fica como "falhou".
- O vendedor vê o histórico de entregas no pedido (horário, código de resposta, sem o corpo) e pode
  pedir "Reenviar".
- URL só `https`, recusando endereços internos ou privados, para o webhook não servir de porta para
  a rede da VPS.
5. A página informa que o pagamento é processado pela Cifra+, porque o Pix mostra a Cifra+ como
   recebedora. Isso reduz contestações por "não reconheço".

## Valores

Para um pedido com itens de valor `P` (produto com o cupom aplicado, mais os bumps marcados):

- **% Cifra+** = `P × percentual` fotografado. Nunca incide sobre o acréscimo de taxa.
- **Custo Efí:**
  - Pix pela tarifa da conta Cifra+ configurada pelo admin (fixa ou percentual);
  - cartão pela tabela de cartão da conta Cifra+ (à vista, antecipação ou parcelado), como em
    [efi-credit-card.md](../../operations/efi-credit-card.md).
- **Comprador paga o custo Efí:**
  - total = gross-up de `P` pela tarifa (no cartão, `grossUpCard`; no Pix, o mesmo princípio);
  - o vendedor fica com `P − % Cifra+`.
- **Vendedor paga o custo Efí:**
  - o comprador paga `P`;
  - o vendedor fica com `P − custo Efí − % Cifra+`.
- **Juros do parcelamento:** seguem a configuração de juros da conta Efí, como no cartão atual. A
  escolha "taxas ao comprador" trata da tarifa de processamento.

Todos os valores ficam fotografados no pedido. Mudar a configuração não altera pedidos já criados.

## Saldo do vendedor

Lançamentos imutáveis por empresa, cada um com data de liberação:

| Lançamento | Sinal | Liberação |
| --- | --- | --- |
| Venda (valor recebido) | + | Pix: pago + 7 dias. Cartão: o maior entre pago + 7 dias e pago + prazo de crédito do cartão na conta Cifra+ (configurado pelo admin; a confirmar com a Efí) |
| Custo Efí | − | mesma data da venda |
| % Cifra+ | − | mesma data da venda |
| Reembolso / contestação | − | na hora do registro |
| Repasse registrado | − | na hora do registro |
| Ajuste (com motivo) | ± | na hora do registro |

- "A liberar" é a soma dos lançamentos com liberação futura.
- "Liberado não repassado" é a soma dos lançamentos já liberados.
- Um reembolso depois do repasse deixa o saldo negativo, e o valor sugerido do próximo repasse já
  sai descontado.
- A reserva de 1% e a % Cifra+ do repasse ficam a critério do admin, no valor que ele registra.
  Por isso o vendedor pode ver um "liberado não repassado" igual à reserva. O repasse tem campo de
  observação para explicar.
- Correção nunca edita um lançamento: entra como ajuste, com auditoria.

## Modelo de dados (migration aditiva)

- `Company.product`: enum `CompanyProduct { BILLING, CHECKOUT }`, padrão `BILLING`.
- `CheckoutSellerTerms` (só admin): `companyId`, % Cifra+ em pontos-base, documento e chave Pix de
  repasse, `version`.
- `CheckoutSettings` (vendedor): nome exibido, logo, banner, cor, suporte, WhatsApp do botão,
  Pix/cartão ligados, máximo de parcelas, quem paga a taxa no Pix e no cartão, URL do webhook e
  segredo cifrado, `version`.
- `CheckoutProduct`: nome, descrição, preço, preço "De", imagem, período de acesso, entrega (link,
  webhook ou os dois), URL de acesso, instruções de acesso, `slug` único, ativo, `version`.
- `CheckoutOrderBump`: produto principal, produto oferecido, preço promocional, preço "De",
  posição, ativo. No máximo 6 por produto.
- `CheckoutCoupon`: código (único por empresa), tipo e valor do desconto, produtos, validade,
  limite e contagem de usos (contagem só em pedidos pagos), ativo.
- `CheckoutWebhookDelivery`: pedido, evento, id do evento, tentativas, último código de resposta,
  estado (`PENDING`, `DELIVERED`, `FAILED`).
- `CheckoutOrder`:
  - empresa, produto, comprador (nome, e-mail, CPF, celular), itens e valores fotografados,
    estado (`PENDING`, `PAID`, `EXPIRED`, `DECLINED`, `REFUNDED`, `CHARGEBACK`);
  - token público, `recoveredByOrderId` e a data de anonimização.
- `CheckoutPaymentAttempt`: pedido, forma, `efiTxid` ou id da cobrança de cartão (únicos), estado,
  código de recusa sanitizado, chave idempotente. Nunca dados do cartão.
- `CheckoutLedgerEntry`: lançamentos imutáveis da tabela acima, com chave idempotente e evidência.
- `CheckoutRefundRequest`: pedido, motivo, estado (`REQUESTED`, `DONE`, `REJECTED`), quem resolveu.

## Rotas

- **Admin** (`JwtAuthGuard` + `PlatformAdminGuard`): criar cliente de checkout, ler e alterar os
  termos, ver saldo e vendas, registrar repasse, reembolso, contestação e ajuste.
- **Vendedor** (`JwtAuthGuard`, `companyId` do JWT, e só empresas `CHECKOUT`):
  - configurações;
  - produtos e bumps;
  - vendas e saldo;
  - recuperação;
  - pedir reembolso.

  Um ID de outra empresa responde 404.
- **Públicas:**
  - `GET /checkout/public/products/:slug`;
  - `POST /checkout/public/products/:slug/quote` (cupom, bumps e forma de pagamento → total);
  - `POST /checkout/public/products/:slug/orders` (Pix ou início do cartão);
  - `POST .../card/quote` e `.../card/pay`, com chave idempotente;
  - `GET /checkout/public/orders/:token` (estado e URL de acesso, só depois de pago).

  Todas têm limite por IP. O cartão tem limite de tentativas por pedido, por CPF e por IP, contra
  teste de cartões roubados.
- **Webhooks:** o Pix da conta Cifra+ entra pela rota mTLS atual e é roteado pelo prefixo do
  `txid`. O cartão usa a notificação Efí. Um evento que não casa vira `PaymentWebhookAnomaly`.

## Segurança e LGPD

- Acesso por produto: o vendedor só vê os próprios produtos, pedidos e saldo. O comprador só vê o
  próprio pedido pelo token.
- O CPF e o celular aparecem completos só para o vendedor dono do pedido. Não vão para log.
- O checkout tem aviso de privacidade próprio, que diz:
  - que a Cifra+ processa o pagamento;
  - que o vendedor pode contatar o comprador sobre a compra não concluída;
  - que esses dados ficam 12 meses.

  O texto não passou por revisão jurídica.
- Uma rotina diária anonimiza os dados pessoais de pedidos não pagos com mais de 12 meses.
- A URL de acesso só sai no estado do pedido depois de pago. A proteção do conteúdo depois disso
  fica com a área de membros do vendedor.

## Fora do escopo

O que está na lista "Funcionalidades por parte" e não foi decidido fica fora até ser marcado.
Também fica fora:

- BOLIX.
- Seletor de planos na mesma página (cada plano é um produto com seu link).
- Outras moedas, outros países e comprador sem CPF.
- Envio automático de mensagens de recuperação pela Cifra+.
- Pix de repasse pelo sistema.
- Reembolso pela API.
- Lógica de reserva.
- Emissão de nota fiscal ao comprador.

## A confirmar com a Efí (não bloqueia o código; bloqueia ligar o cartão)

- Homologação de cartão na conta Cifra+ e o prazo real de crédito do cartão (antecipado em até
  31 dias, ou menor se negociado).
- Nome na fatura do cartão (soft descriptor) para as vendas do checkout.
- Procedimento de devolução de Pix e estorno de cartão pela conta Cifra+.

## Critérios de pronto e testes

- **Isolamento:**
  - a empresa A não lê nem altera produtos, pedidos, saldo ou recuperação da empresa B (404);
  - uma empresa `BILLING` não acessa rotas de checkout, e uma `CHECKOUT` não acessa cobrança.
- **Valores:** % Cifra+ só sobre `P`; gross-up de Pix e cartão com comprador pagando; líquido
  correto com vendedor pagando; fotografia imutável após mudar a configuração.
- **Webhook:**
  - pagamento repetido não duplica lançamentos;
  - `txid` desconhecido ou de outra conta vira anomalia;
  - o navegador nunca confirma pagamento.
- **Saldo:**
  - liberação em 7 dias no Pix e no maior prazo no cartão;
  - reembolso depois do repasse deixa o saldo negativo;
  - repasse e ajuste nunca editam lançamentos.
- **Cartão:** chave idempotente sem cobrança dupla; limite de tentativas; recusa aparece na
  recuperação sem dado de cartão.
- **Recuperação:** Pix expirado e cartão recusado entram; pagamento posterior do mesmo CPF e
  produto em 30 dias marca recuperado; os filtros funcionam.
- **Cupom:** expirado, esgotado, de outro produto ou de outra empresa é recusado; o desconto não
  passa do mínimo; só pedidos pagos contam no limite.
- **Webhook ao vendedor:**
  - assinatura HMAC conferível;
  - mesmo id de evento nas repetições;
  - repetição com intervalo crescente até 24 h;
  - URL interna ou sem `https` é recusada;
  - produto só com link de acesso não dispara webhook.
- **Retenção:** pedidos não pagos com mais de 12 meses são anonimizados; os pagos não.
- **Banco:** migration testada em banco descartável.

## Funcionalidades por parte (backlog para priorizar)

O desenvolvimento é feito **parte por parte**. Cada parte tem o próprio plano em
`docs/superpowers/plans/`, escrito só quando ela começa, e termina publicável e testada sozinha.
Uma parte só depende das anteriores indicadas.

Decidido com o responsável pelo produto em 03/11/2026:
- `[x]` = não pode faltar;
- `[ ]` *(pode esperar)* = fica na lista e só entra com nova decisão.

A Parte 10 inteira pode esperar.

O que vem da documentação da Hubla (webhook, API pública, chargeback, reembolso e upsell,
lidos em 02/11/2026) está marcado como *(Hubla)*.

### Parte 1: Base do cliente de checkout

> **Situação (03/11/2026):** implementada no branch `feat/cifra-checkout-parte-1`, ainda não commitada nem
> publicada. Plano e registro: [Parte 1](../plans/2026-11-03-cifra-checkout-parte-1-base.md).

Sem dependências. Ao fim, o admin cria o cliente, e o vendedor entra e monta produtos, bumps,
cupons e a aparência, sem vender ainda.

- [x] **CK-01** Empresa do tipo checkout (`Company.product`). O menu do usuário mostra só o
  checkout, e as rotas de cobrança e de checkout se recusam entre si.
- [x] **CK-02** Admin → Novo cliente de checkout: empresa, usuário com primeiro acesso, % Cifra+,
  CPF/CNPJ e chave Pix de repasse, com auditoria.
- [x] **CK-03** Configurações do checkout: logo, banner, cor, nome exibido, suporte, WhatsApp do
  botão, formas de pagamento, máximo de parcelas e quem paga a taxa (Pix e cartão).
- [x] **CK-04** Produtos: preço, "De / Por", imagem, período de acesso, entrega (link, webhook
  ou os dois), URL e instruções de acesso, link `/c/<slug>`.
- [x] **CK-05** Order bumps: até 6 por produto, com preço promocional e "De / Por".
- [x] **CK-06** Cupons em % ou valor fixo, por produto, com validade e limite de usos; valem só no
  produto principal.

### Parte 2: Venda por Pix

> **Situação (04/11/2026):** implementada no branch `feat/cifra-checkout-parte-2`. Plano e registro:
> [Parte 2](../plans/2026-11-04-cifra-checkout-parte-2-pix.md). Runbook:
> [conta Cifra+](../../operations/checkout-conta-cifra.md).

Depende da Parte 1. Ao fim, o primeiro cliente consegue vender por Pix.

- [x] **CK-07** Página pública: banner, produto, cupom, dados obrigatórios (nome, e-mail, CPF,
  celular), bumps, total vindo do backend e botão de WhatsApp.
- [x] **CK-08** Pix na conta Cifra+ com validade de 30 minutos, contagem regressiva e confirmação
  automática na página.
- [x] **CK-09** Confirmação pelo webhook Efí (nunca pelo navegador), sem efeito em dobro; um
  evento estranho vira anomalia.
- [x] **CK-10** Entrega por link: redirecionamento e e-mail com o link de cada item.
- [x] **CK-11** Aviso de privacidade do checkout, sem revisão jurídica.
- [x] **CK-12** *(Hubla)* Guardar as UTMs do link (`utm_source`, `utm_campaign` etc.) no pedido,
  mostrá-las na venda e mandá-las no webhook.

### Parte 3: Saldo, repasse e reembolso

> **Situação (05/11/2026):** implementada no branch `feat/cifra-checkout-parte-3`. Plano e registro:
> [Parte 3](../plans/2026-11-05-cifra-checkout-parte-3-saldo.md).

Depende da Parte 2. Ao fim, o dinheiro de cada venda fica rastreável até o repasse.

- [x] **CK-13** Lançamentos imutáveis: venda, custo Efí, % Cifra+, reembolso, contestação,
  repasse e ajuste, com data de liberação (Pix em 7 dias; cartão no maior entre 7 dias e o crédito
  da Efí).
- [x] **CK-14** Tela Vendas do vendedor: a liberar, liberado e repassado, e a lista de vendas com
  tarifas.
- [x] **CK-15** Admin → Checkout: registrar repasse (feito por fora, no app Efí), reembolso,
  contestação e ajuste.
- [x] **CK-16** Vendedor pede reembolso na venda; o admin devolve pela Efí e registra.
- [x] **CK-17** *(Hubla)* Comprador pede reembolso sozinho por um link no e-mail de confirmação,
  para cumprir o arrependimento de 7 dias do Código de Defesa do Consumidor (art. 49). O pedido
  aparece para o vendedor e para o admin, e o admin executa como no CK-16.
- [x] **CK-18** *(Hubla)* Índice de chargeback por vendedor no admin: quantidade e % do faturamento
  no cartão. Contexto: o prazo de contestação é de até 180 dias, as bandeiras penalizam acima de
  1%, e a reserva de 1% cobre só 30 dias.

### Parte 4: Webhook ao vendedor

> **Situação (06/11/2026):** implementada no branch `feat/cifra-checkout-parte-4`. Plano e registro:
> [Parte 4](../plans/2026-11-06-cifra-checkout-parte-4-webhook.md).

Depende da Parte 2; os eventos de reembolso e chargeback, da Parte 3.

- [x] **CK-19** Eventos `order.paid`, `order.refunded` e `order.chargeback`, com assinatura HMAC,
  id de evento estável, repetição por até 24 h, histórico, "Reenviar" e "Enviar teste". Recusa
  URL interna ou sem `https`.
- [x] **CK-20** *(Hubla)* Um aviso por venda, com cada item marcado como principal ou bump e o
  valor de cada um.
- [x] **CK-21** *(Hubla)* Eventos para a recuperação do próprio vendedor: `order.created`,
  `order.pix_expired`, `order.card_declined` e `refund.requested`.
- [x] **CK-22** *(Hubla)* Desligar o webhook depois de vários dias seguidos de falha e avisar o
  vendedor por e-mail, com botão para religar.
- [ ] **CK-23** *(pode esperar)* *(Hubla)* Ver os dados enviados no histórico, por tempo
  limitado (ex.: 30 dias), já que eles contêm dados pessoais do comprador.

### Parte 5: Recuperação

> **Situação (07/11/2026):** implementada no branch `feat/cifra-checkout-parte-5`, sem os cartões
> recusados (entram com a Parte 6). Plano e registro:
> [Parte 5](../plans/2026-11-07-cifra-checkout-parte-5-recuperacao.md).

Depende da Parte 2; a lista de cartões recusados, da Parte 6.

- [x] **CK-24** Tela Recuperação: Pix expirado e cartão recusado, filtros por produto, período e
  tipo, botões de WhatsApp e de copiar contato, e marcação "recuperado" quando o mesmo CPF compra
  o mesmo produto em até 30 dias.
- [x] **CK-25** Anonimização dos dados pessoais de pedidos não pagos depois de 12 meses.
- [x] **CK-26** *(Hubla)* Lead: guardar quem preencheu os dados e saiu antes de gerar o Pix ou
  pagar. A gravação acontece enquanto a pessoa preenche, com limite contra abuso. O aviso de
  privacidade diz isso antes do preenchimento, e o lead entra na anonimização de 12 meses, na
  Recuperação e no webhook.
- [x] **CK-27** Exportar a lista de recuperação em CSV, respeitando os filtros. Cada exportação
  fica na auditoria.

### Parte 6: Cartão

Depende das Partes 2 e 3. O código fica pronto, mas o cartão só é ligado depois da homologação na
conta Cifra+.

- [x] **CK-28** Cartão até 12x pela conta Cifra+, com tokenização no navegador, cotação no backend
  e chave idempotente.
- [x] **CK-29** Limite de tentativas por pedido, CPF e IP, contra teste de cartões roubados; a
  recusa aparece em linguagem simples, com a sugestão do Pix.
- [x] **CK-30** *(Hubla)* O admin pode pausar o cartão de um vendedor (por exemplo, com índice de
  chargeback alto, CK-18); o Pix continua.

### Parte 7: Upsell e downsell

Depende das Partes 2 e 6. Antes do plano, confirmar com a Efí se o cartão pode ser reaproveitado
na conta Cifra+.

- [x] **CK-31** *(Hubla)* Upsell de 1 clique na página de agradecimento: uma oferta por produto,
  paga pelo mesmo meio da compra (cartão reaproveitado; no Pix, um novo QR Code com os dados já
  preenchidos). Vira uma venda separada, ligada à de origem, sem cupom, e não aparece para quem já
  tem o produto.
- [x] **CK-32** *(Hubla)* Link de 1 clique para usar na página de vendas do próprio vendedor,
  permitindo encadear ofertas e oferecer downsell. O link é assinado, vale só para aquele
  comprador e por pouco tempo, para ninguém cobrar o cartão de outra pessoa.
- [x] **CK-33** *(Hubla)* Destino depois da compra escolhido por produto: link de acesso, oferta
  de upsell ou página externa. O e-mail com o link de acesso sai em qualquer caso.

### Parte 8: Reembolso avançado

Depende da Parte 3 (e do CK-17).

- [x] **CK-34** *(Hubla)* Prazo de retenção: depois do pedido de reembolso, o vendedor tem 7 dias
  para tentar reverter e envia um link (ou WhatsApp) para o próprio comprador desistir. Sem
  desistência, o pedido segue para o admin executar. Só o comprador desiste; o vendedor nunca
  cancela no lugar dele. Venda com reembolso pendente não entra no valor sugerido de repasse, mesmo
  depois da data de liberação.
- [x] **CK-35** *(Hubla)* Reembolso de um item só (um bump ou um upsell) sem devolver o pedido
  inteiro. A tarifa Efí e a % Cifra+ do pedido são divididas entre os itens na proporção do valor
  de cada um, e o webhook diz qual item foi reembolsado.
- [x] **CK-36** *(Hubla)* E-mails ao comprador sobre o andamento do reembolso: pedido recebido,
  desistência confirmada, reembolso concluído. Saem como Cifra+, com o suporte do vendedor no
  texto.

### Parte 9: Integrações

Depende da Parte 4.

- [x] **CK-37** *(Hubla)* API pública do vendedor: chaves (até 5, mostradas uma vez, guardadas só
  como hash, revogáveis), consulta de pedidos e produtos e limite de requisições por chave. Útil se
  o sistema dele perder um webhook. A primeira versão só consulta: não cria nem altera.
- [x] **CK-38** *(Hubla)* Várias regras de webhook: URLs diferentes por produto e por evento, cada
  regra com o próprio segredo e o próprio histórico. A URL única do CK-19 vira a primeira regra,
  sem o vendedor reconfigurar nada.
- [ ] **CK-39** *(pode esperar)* Pixel da Meta e do Google na página e na confirmação da compra.

### Parte 10: Expansão

Cada item exige uma spec própria antes.

- [ ] **CK-40** *(pode esperar)* *(Hubla)* Afiliados com comissão por venda.
- [ ] **CK-41** *(pode esperar)* *(Hubla)* Combo: vários produtos vendidos como um só.
- [ ] **CK-42** *(pode esperar)* *(Hubla)* Reembolso preventivo pelo admin quando o risco de chargeback de uma
  venda é alto.
- [ ] **CK-43** *(pode esperar)* Assinatura com renovação automática (hoje fora do escopo).
