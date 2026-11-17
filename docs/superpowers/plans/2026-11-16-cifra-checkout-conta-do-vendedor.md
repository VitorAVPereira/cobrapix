# Cifra+ Checkout: venda pela conta Efí do vendedor (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável; a Efí e o Resend são sempre simulados.

**Objetivo:** o checkout passa a vender pela conta Efí do próprio vendedor, com assinatura no
cartão, reembolso executado pelo sistema e a taxa Cifra+ apurada para cobrança por BOLIX.

**Especificações:**
[conta do vendedor](../specs/2026-11-13-cifra-checkout-conta-do-vendedor-design.md) (decisões D1 a
D10) e [planos e assinatura](../specs/2026-11-12-cifra-checkout-assinaturas-design.md). Este plano
absorve as Tarefas 5 a 17 do
[plano da Parte 10](2026-11-12-cifra-checkout-parte-10-assinaturas.md), na ordem que o prazo pede.

**Base:** branch `feat/cifra-checkout-conta-vendedor`, aberto em 16/11 a partir de
`feat/cifra-checkout-parte-10` (`1dd21a1`), que tem as Tarefas 1 a 4 da Parte 10 (`9af78ff`).

## Prazo

| Data | O que precisa existir |
| --- | --- |
| 20/11/2026 (feriado) | Teste do cliente: compra de assinatura no cartão pela conta dele e os avisos de webhook chegando ao dev. **Etapa A.** |
| Primeira semana de dezembro | Divulgação: reembolso pelo sistema, chargeback pelo aviso e extrato da taxa. **Etapa B.** |
| Antes da primeira renovação | Renovação pelo aviso da Efí e o resto do ciclo de vida. **Etapa C.** |

De 16/11 a 19/11 são quatro dias para a Etapa A. Se não couber inteira, o corte está no fim da
etapa.

## O que não depende de código e começa hoje

- **Erro `4600037` na homologação da Efí.** Em 12/11 a conta de homologação recusou toda cobrança
  de cartão. Sem resolver isso, não há teste de cartão no dia 20, nem em homologação.
- **Conta Efí Empresas do cliente**, com a aplicação criada e o pedido de cartão não presente (até
  5 dias úteis). Em produção o cartão não fica liberado até 20/11; o teste é em homologação.
- **Perguntas à Efí** da spec, com prioridade para o estorno pela API em cobrança de assinatura.
- **Termo de autorização** do vendedor (D9), que precisa cobrir a devolução sem clique (D5).

## Decisões técnicas (revisar se discordar)

1. **Conta por vendedor na tabela que já existe.** `CheckoutPlatformSettings` ganha `companyId`
   opcional. Linha sem empresa é a conta Cifra+; com empresa, a conta daquele vendedor. A versão
   passa a ser única por empresa: sai o índice único de `version` e entram um índice único
   (`companyId`, `version`) e um índice único parcial de `version` para as linhas sem empresa. É
   troca de índice, sem perda de dado.
2. **Um resolvedor só.** `CheckoutPlatformService.ready(companyId?)` e `cardReady(companyId?)`.
   Sem empresa, devolvem a conta Cifra+, como hoje. `CheckoutCatalogService.accounts()` escolhe
   pelo `accountMode` dos termos vigentes do vendedor.
3. **Conta da tentativa, não a conta atual.** Novo `accountOf(identityId)` para tudo que acontece
   depois da emissão: conciliação de Pix incerto, expiração, aviso de cartão, conciliação de
   cartão, devolução. Hoje esses pontos usam `platform.ready()`
   (`checkout-orders.service.ts:393` e `:427`, `checkout-card.service.ts:415` e `:520`).
4. **Credenciais.** `EfiAccountRegistryService.registerCompanyCredential`, o mesmo da cobrança. A
   conferência de CNPJ e conta da Cifra+ (`PLATFORM_ACCOUNT_MISMATCH`) vale só para a conta Cifra+.
5. **Avisos.** O Pix `ckt…` já vai ao checkout por `txid`, em qualquer conta. O aviso de cartão
   passa a ir ao checkout quando a conta é `PLATFORM` ou pertence a uma empresa com produto
   `CHECKOUT` (`webhooks.service.ts:55`).
6. **Razão espelhado.** A venda grava `SALE`, `EFI_FEE` e `PLATFORM_FEE`, como hoje, mais
   `DIRECT_SETTLEMENT` com o líquido que já está na conta do vendedor. O saldo vira menos a taxa
   devida. Reembolso e chargeback gravam o `DIRECT_SETTLEMENT` contrário. O BOLIX pago vira
   `FEE_PAYMENT`.
7. **Execução do reembolso.** `CheckoutRefundExecution` é gravada antes do envio, e o `id` dela é
   o `id` da devolução Pix. Uma execução em aberto por pedido de reembolso (índice único
   parcial). Incerto nunca é reenviado: o worker consulta a Efí.
8. **Quem executa.** `SELLER` (botão), `ADMIN` (com a referência do ok do vendedor, obrigatória)
   ou `SYSTEM` (fim da espera de 7 dias). A referência do ok segue como proposta até o
   responsável confirmar.
9. **Avisos de cancelamento (D10).** `subscription.renewal_disabled` quando o cancelamento é
   pedido com acesso até o fim do período, e `subscription.canceled` uma única vez quando o
   acesso acaba (`accessEndedNotifiedAt` na assinatura; o worker dispara os vencidos). O nome do
   primeiro segue a proposta da spec até o responsável confirmar.
10. **Fechamento da taxa.** Período do dia 30 ao dia 29, e em fevereiro o último dia do mês
    (proposta). O sistema só apura e mostra; o BOLIX é emitido à mão pelo admin (D3).

## Modelo de dados (migrations aditivas)

**Migration 1 (Etapa A):**

- `CheckoutSellerTerms`: `accountMode` (`PLATFORM_ACCOUNT` nas linhas existentes) e
  `authorizationReference`.
- `CheckoutPlatformSettings`: `companyId` e os índices da decisão 1.
- `CheckoutLedgerKind`: `DIRECT_SETTLEMENT` e `FEE_PAYMENT`.
- Assinatura, como no plano da Parte 10: `CheckoutSubscription` (com `accessEndedNotifiedAt`),
  `CheckoutEfiPlan`, `CheckoutOrder.subscriptionId` e `subscriptionCycle`,
  `CheckoutCardAttempt.quoteId` opcional.

**Migration 2 (Etapa B):**

- `CheckoutRefundExecution`: id, `companyId`, `refundRequestId`, `orderId`, método, `amountCents`,
  `status` (`SUBMITTING`, `DONE`, `FAILED`, `UNCERTAIN`), motivo da recusa, `issuerIdentityId`,
  origem (`SELLER`, `ADMIN`, `SYSTEM`), usuário, referência do ok, datas.

**Migration 3 (Etapa C):** `CheckoutOrderBump.recurringPrices`.

## Etapa A: teste do cliente (até 19/11)

1. **Schema e migration 1.** Testada em banco descartável com vendedores e pedidos existentes.
2. **Resolvedor por vendedor.** Decisões 2 e 3. Teste: vendedor no modo conta do vendedor vende
   com as credenciais dele e a tentativa grava a conta dele; vendedor no modo conta Cifra+ não
   muda; sem conta validada, `CHECKOUT_UNAVAILABLE`.
3. **Ativação pelo admin (backend).** Rotas em `/admin/checkout/companies/:id/account`: enviar
   credenciais, validar (aponta o webhook do Pix), tarifa do Pix e cartão, com versão esperada e
   auditoria. Termos novos nascem `SELLER_ACCOUNT` com a referência do termo, e o modo conta
   Cifra+ é recusado (`CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED`). Teste: nenhuma resposta traz
   credencial; a conta de A não aparece para B.
4. **Avisos na conta certa.** Decisão 5, e `handleNotification` e `reconcile` com a conta da
   tentativa. Teste: aviso de outra conta não dá baixa e vira anomalia; aviso repetido não
   duplica.
5. **Razão espelhado.** Decisão 6 em `recordSale`. Vendas esconde saldo liberado, pendente e
   repasse sugerido para esse vendedor e mostra a taxa devida. Teste: venda paga deixa o saldo
   igual a menos a % Cifra+.
6. **Cliente Efí de assinatura.** Criar plano, criar assinatura, pagar, consultar e cancelar
   (Tarefa 5 da Parte 10, sem alterar item nem retentativa).
7. **Adesão no cartão.** Pedido do ciclo 1, tentativa, assinatura em dois passos, incerteza
   conciliada e limites de tentativa (Tarefa 6 da Parte 10). O plano recorrente passa a aparecer
   na página, **só com periodicidade de 3 meses ou mais** até a Etapa C. Teste: resposta perdida
   no segundo passo não cria segunda assinatura nem segunda cobrança.
8. **Cancelamento e avisos.** Cancelar pelo comprador (link do e-mail), pelo vendedor e pelo
   admin, com o cancelamento na Efí. Eventos `subscription.activated`,
   `subscription.renewal_disabled` e `subscription.canceled`, os blocos `plan` e `subscription`
   em `order.*`, e a entrada deles nas regras de webhook. Teste: cancelamento pedido gera o
   primeiro aviso na hora e o segundo uma única vez no fim do acesso.
9. **Telas mínimas.** Admin → Checkout → cliente → Conta Efí; seletor de plano e texto de
   autorização em `/c/<slug>`, sem parcelas no recorrente; página `/c/assinatura/<token>` com ver
   e cancelar; e-mail de confirmação com "Gerenciar assinatura".
10. **E2E da etapa** no `test:e2e:checkout-pix`, com os casos acima.

**Corte, se os quatro dias não bastarem:** ficam para a semana seguinte a tela da conta Efí no
admin (a ativação é feita pela API), o cancelamento pelo vendedor e pelo admin, e a parte de
Vendas da Tarefa 5. Não se corta: as Tarefas 1, 2, 4, 6 e 7 e os avisos de webhook.

## Etapa B: antes da divulgação (até 30/11)

11. **Migration 2 e cliente Efí de devolução.** `PUT /v2/pix/:e2eId/devolucao/:id`, a consulta da
    devolução e `POST /v1/charge/card/:id/refund`.
12. **Execução do reembolso.** Decisões 7 e 8: botão do vendedor em Vendas, execução pelo admin
    com a referência do ok, recusa certa (`FAILED` com o motivo, pedido aberto), incerto no
    worker. `CHECKOUT_REFUND_ON_HOLD` deixa de barrar essas execuções. Teste: duplo clique não
    cria duas execuções; resposta perdida não gera segundo envio; B não executa reembolso de A.
13. **Fim da espera (D5).** O worker executa o pedido do comprador cuja espera terminou, uma vez.
    Recusa por saldo avisa o vendedor por e-mail (D6). O e-mail ao comprador troca "a Cifra+ faz
    a devolução" por um texto que valha nos dois modos.
14. **Cartão devolvido e chargeback pelo aviso (D7).** `refunded` conclui o reembolso pela rotina
    de hoje. `contested` marca `CHARGEBACK`, grava os lançamentos, cancela a assinatura, gera
    `order.chargeback` e manda o e-mail ao vendedor, sem devolver a % Cifra+. No modo conta
    Cifra+ os dois continuam virando anomalia. Teste: aviso repetido marca uma vez.
15. **Reembolso e assinatura.** Pedido do comprador só no ciclo 1; reembolso concluído do ciclo 1
    cancela a assinatura (Tarefa 10 da Parte 10).
16. **Taxa Cifra+.** Extrato por fechamento no admin e em Vendas, e **Registrar recebimento**
    (`FEE_PAYMENT`, com chave idempotente e auditoria).
17. **Textos e documentação.** `/termos-checkout` e `/privacidade-checkout` (o vendedor recebe, a
    Cifra+ fornece a tecnologia, cobrança recorrente), `AGENTS.md`, runbook novo
    `docs/operations/checkout-conta-vendedor.md` e a situação nas specs.

## Etapa C: antes da primeira renovação

Com plano trimestral vendido a partir de dezembro, a primeira renovação cai em março de 2027.
Publicar esta etapa até 31/01/2027. Só depois dela a página vende plano recorrente mensal.

18. **Renovação pelo aviso da Efí:** pedido do ciclo, confirmação, `PAST_DUE`,
    `subscription.renewal_failed` (Tarefa 7 da Parte 10).
19. **Ciclo de vida no worker:** tolerância de 7 dias, aviso antes de renovar (Tarefa 8).
20. **Troca de cartão** na página do comprador (Tarefa 9).
21. **Bump recorrente e ajuste de itens** depois do ciclo 1, com a migration 3. Até aqui, um
    plano recorrente não aceita bump de pagamento único nem cupom no cartão, para o ciclo 2 nunca
    sair com valor errado.
22. **Pix recorrente manual, API de consulta de assinaturas, tipo "Renovação" na recuperação,
    telas Assinaturas e Planos completas, anonimização** (Tarefas 8, 11, 14 e 16).

## Ordem de publicação

Migration, backend e depois frontend, em cada etapa. Com backend novo e frontend antigo, nenhum
vendedor está no modo conta do vendedor e tudo segue como hoje. Publicar só com pedido.

## Riscos e pendências

- **Prazo:** a Etapa A é maior do que quatro dias confortáveis. O corte está descrito nela.
- **`4600037`:** sem resposta da Efí, o cartão não é testado nem em homologação.
- **Estorno em cobrança de assinatura:** se a Efí não aceitar pela API, o reembolso de cartão de
  assinatura é feito pelo vendedor no app da Efí e registrado em Vendas, e a promessa ao cliente
  muda.
- **Limite de emissão de conta nova** do cliente na Efí: pode travar a campanha de lançamento.
- **Bump de pagamento único e cupom** em plano recorrente no cartão ficam desligados até a
  Tarefa 21. O dono pediu de dois a quatro bumps: confirmar com ele se valem para a assinatura.
- **Sem revisão jurídica:** termo de autorização, espera de 7 dias e textos ao comprador.
- **A confirmar com o responsável:** vencimento do BOLIX e período do fechamento (decisão 10),
  referência do ok (decisão 8) e o nome `subscription.renewal_disabled` (decisão 9).

## Registro de execução

### 16/11/2026: Tarefa 1 (schema e migration 1)

Feito, sem commit:

- **Schema:** `CheckoutAccountMode`, `accountMode` e `authorizationReference` nos termos,
  `companyId` em `CheckoutPlatformSettings`, `DIRECT_SETTLEMENT` e `FEE_PAYMENT` no razão,
  `CheckoutSubscription`, `CheckoutEfiPlan`, `subscriptionId` e `subscriptionCycle` no pedido e
  `quoteId` opcional na tentativa de cartão.
- **Migration:** `20261116120000_checkout_seller_account`.

Além do plano:

- **Regra no banco:** uma chave estrangeira (`identityId`, `companyId`) impede que a configuração
  de um vendedor aponte para a conta Efí de outra empresa. No schema ela aparece como a relação
  `sellerIdentity`, que o código não usa.
- **Assinatura na Efí:** `efiSubscriptionId` é único por conta emissora, e não sozinho.

Testes:

- Migration aplicada num PostgreSQL descartável sobre termos e configurações já existentes: os
  termos ficam `PLATFORM_ACCOUNT`, as configurações ficam como conta Cifra+, a versão não repete
  na conta Cifra+ nem dentro de um vendedor, e dois vendedores têm versões próprias. Foi um script
  avulso, fora do repositório. A chave estrangeira composta não foi exercitada com dados; o
  isolamento entre vendedores entra nos testes das Tarefas 2 e 3.
- `prisma migrate diff` entre o banco migrado e o `schema.prisma`: vazio.
- 1.398 testes unitários do backend, `test:e2e:checkout-pix` (36) e `test:e2e:checkout` (6)
  passando; build OK.

### 17/11/2026: Tarefa 2 (resolvedor por vendedor)

Feito, sem commit:

- **Conta por dono:** `CheckoutPlatformService.ready(owner)` e `cardReady(owner)`. Sem dono é a
  conta Cifra+ (linhas sem empresa e conta `PLATFORM`); com dono, só a configuração e a conta
  `COMPANY` daquela empresa. `accountOwner(terms)` tira o dono do modo dos termos.
- **Quem usa:** a página, a cotação e o pedido (`CheckoutCatalogService`), a prévia dos planos, a
  página da oferta e a liberação do cartão nas Configurações do vendedor.
- **Conta da tentativa:** `accountOf(identityId)` na conciliação do Pix incerto, na expiração, no
  aviso de cartão e na conciliação do cartão. Sem a conta emissora com credencial ativa, nada é
  consultado nem alterado.
- **Nova tentativa de cartão:** usa a conta dos termos do pedido, mesmo que os termos do vendedor
  tenham mudado depois.
- **Tela do admin da conta Cifra+:** passou a ler e gravar só as linhas sem empresa.

Além do plano:

- **Configurações do vendedor** (`CheckoutSettingsService.update`): ligar o cartão conferia a
  última versão de qualquer conta. Passou a conferir a conta por onde o vendedor vende.
- **Tipo `CheckoutIssuerAccount`** (conta e credencial) nos clientes da Efí, que não usam a
  configuração.

Mudança de comportamento no modo conta Cifra+: a conciliação consulta a conta que emitiu a
cobrança, e não mais a conta atual. Antes, uma tentativa de uma conta Cifra+ antiga era ignorada.

Testes:

- E2E novo, escrito antes e visto falhar: vendedor na conta própria sem conta validada não vende;
  com a conta, o Pix sai com a credencial e a chave dele, o pedido grava a configuração dele e a
  tentativa a conta dele; a cotação do cartão devolve o código do recebedor dele; aviso com a
  chave da Cifra+ não dá baixa; o Pix incerto é consultado na conta dele; a conta Cifra+ e o
  vendedor que vende por ela não mudam.
- 1.404 testes unitários do backend, `test:e2e:checkout-pix` (37) e `test:e2e:checkout` (6)
  passando; build e lint do checkout OK.

### 17/11/2026: Tarefa 3 (ativação pelo admin, backend)

Feito, sem commit:

- **Rotas** em `/admin/checkout/clients/:companyId/account`: ver, enviar credenciais, validar,
  tarifa do Pix e cartão. São os mesmos passos e DTOs da conta Cifra+
  (`CheckoutPlatformService`, agora com o dono como parâmetro), com versão esperada e auditoria
  na empresa do vendedor (`CHECKOUT_SELLER_*`).
- **Guarda do vendedor**, dentro do serviço: só cliente de checkout (404), só no modo conta
  própria (`CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED`) e só com a referência da autorização nos termos
  (`CHECKOUT_AUTHORIZATION_REQUIRED`). Vale antes de guardar credencial, de chamar a Efí e de
  gravar tarifa.
- **Termos:** cliente novo nasce `SELLER_ACCOUNT`, sem dados de repasse (gravados vazios, mesmo
  que a tela antiga os envie). Uma nova versão dos termos mantém o modo do vendedor e a
  referência da autorização, se não vier outra.

Desvios do plano:

- **Sem escolha de modo:** o DTO não tem campo de modo, então não há o que recusar na criação. O
  código `CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED` passou a responder quando se tenta cadastrar conta
  própria para um vendedor da conta Cifra+. Também não há rota para mudar um vendedor de modo.
- **Referência da autorização nos termos**, e não na tela da conta: fica versionada com o resto
  do combinado, e a tela antiga do admin continua criando clientes.

Decisão do responsável (17/11): o sistema **não exige** que a conta Efí esteja no mesmo CNPJ do
cadastro do cliente. O que liga a conta ao vendedor é o termo de autorização (D9). O campo do
titular continua aceitando só CNPJ, como na conta Cifra+.

Além do plano:

- **Troca de conta desliga o cartão:** ao validar uma conta diferente da anterior (homologação
  para produção, por exemplo), a nova versão nasce com o cartão desligado. Vale também para a
  conta Cifra+, que antes carregava o cartão ligado para a conta nova.
- **Textos do admin** da conta Cifra+ ficaram sem "Cifra+" ("Valide a conta antes da tarifa").

Testes:

- Unitários novos, vistos falhar antes: termos por modo (4) e conta do vendedor (5).
- E2E ampliado depois da implementação: cliente novo sem dados de repasse; sem conta não vende
  nem liga o cartão; sem a referência o admin não grava tarifa; tarifa e cartão por versão do
  vendedor, com 409 na versão antiga; nenhuma credencial na resposta; auditoria na empresa do
  vendedor; vendedor comum recebe 404; vendedor da conta Cifra+ recebe 409.
- Envio de credenciais e validação: só em teste unitário, com o certificado e a Efí simulados.
- 1.411 testes unitários do backend, `test:e2e:checkout-pix` (37) e `test:e2e:checkout` (6)
  passando; build e lint do checkout OK.

Para o runbook (Tarefa 17): a chave Pix do vendedor passa a avisar a API da Cifra+. Se ele usar
a mesma chave para outros recebimentos, cada um vira um aviso desconhecido aqui. Pedir uma chave
aleatória só para o checkout.

### 17/11/2026: Tarefa 4 (avisos na conta certa)

Feito, sem commit:

- **Entrega ao checkout:** `WebhooksService.handleEfiChargesWebhook` manda ao checkout o aviso de
  uma conta `PLATFORM` ou de uma conta de empresa com produto `CHECKOUT`. Conta de empresa de
  cobrança segue no fluxo da cobrança.
- **Conta do aviso:** `handleNotification` e `reconcile` já usavam a conta emissora desde a
  Tarefa 2. O aviso que cita outra conta não acha a tentativa e vira anomalia
  (`CHECKOUT_CARD_UNKNOWN_CHARGE`).

Testes:

- Unitários novos do roteamento, vistos falhar antes (2).
- E2E novo: venda de cartão na conta do vendedor sai com a credencial dele; aviso com a conta
  Cifra+ não dá baixa e vira anomalia; o aviso da conta dele confirma, lido na conta dele;
  repetido, não lança de novo no razão. O aviso entra direto no `CheckoutCardService`; a rota
  HTTP `/webhooks/efi/cobrancas` não faz parte do módulo deste e2e.
- 1.413 testes unitários do backend, `test:e2e:checkout-pix` (38) e `test:e2e:checkout` (6)
  passando; build e lint OK.

Gaps encontrados:

1. **Aviso de cartão sem o token (corrigido em 17/11, a pedido do responsável).** O
   `EfiWebhookGuard` exige `x-api-key` ou `token` na URL, e a URL de aviso do cartão levava só
   `account=`, no checkout e no cartão da cobrança. Pelo código, todo aviso de cartão era
   recusado com 401; não foi conferido em produção. A venda confirmava pelo worker, mas o que só
   chega por aviso se perdia: estorno e contestação de uma cobrança já paga e a renovação da
   assinatura.
   - **Correção:** uma função só, `cardNotificationUrl` (`payment/efi-card.client.ts`), monta a
     URL com o token e a conta, como o boleto. Sem `EFI_WEBHOOK_SECRET` ou sem endereço válido o
     cartão não fica disponível.
   - **Teste novo, visto falhar antes:** a URL que cada cliente de cartão gera passa pelo guard
     da rota (`webhooks/card-notification-url.spec.ts`).
   - **Também rodados:** `test:e2e:checkout-pix` (38) e `card-checkout.e2e-spec.ts` (13).
   - **Cobranças antigas:** as de cartão já emitidas guardaram a URL sem o token; os avisos
     delas continuam recusados.
   - **A observar:** o token do webhook fica na URL gravada em cada cobrança da conta Efí do
     vendedor, como já acontece com o boleto nas contas dos clientes da cobrança.
2. **Id da cobrança único no sistema inteiro (não alterado, aguarda o responsável).** `CheckoutCardAttempt.efiChargeId` é único sem a
   conta. Homologação e produção da Efí numeram separado: um id repetido em outra conta faz o
   aviso falhar e a venda não confirma. Proposta: único por conta emissora, numa migration.

### 17/11/2026: Tarefa 5 (razão espelhado)

Feito, sem commit:

- **Venda:** no modo conta própria, `recordSale` grava `DIRECT_SETTLEMENT` com o que ficou na
  conta do vendedor (a venda menos a tarifa da Efí). O saldo da venda fica igual a menos a %
  Cifra+, devida desde o pagamento, sem prazo de liberação.
- **Reembolso e contestação:** gravam o `DIRECT_SETTLEMENT` contrário. No reembolso a % Cifra+
  volta na proporção; na contestação continua devida (D7).
- **Saldo** (`balance`): devolve `accountMode` e `feeOwedCents`. No modo conta própria, liberado,
  pendente, repassado e repasse sugerido vêm zerados.
- **Líquido da venda** (`sales`): não conta `DIRECT_SETTLEMENT` nem `FEE_PAYMENT`, então mostra o
  que a venda deixa para o vendedor nos dois modos.
- **Repasse:** registrar repasse para um vendedor da conta própria responde
  `CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED`.
- **Telas:** Vendas mostra só "Taxa Cifra+ em aberto" e o texto de que as vendas caem na conta
  Efí do vendedor; o financeiro do admin mostra a taxa em aberto e esconde o repasse.

Testes:

- Unitários novos, vistos falhar antes: venda, saldo, reembolso, contestação e repasse recusado
  (4 no backend) e as duas telas (2 no frontend).
- E2E ampliado depois da implementação: duas vendas de R$ 100,00 a 1,5% deixam R$ 3,00 de taxa
  em aberto e líquido de R$ 97,50 cada; repasse recusado; a devolução avisada pela Efí, repetida,
  baixa a taxa para R$ 1,50 e zera os lançamentos da venda.
- 1.420 testes unitários do backend, `test:e2e:checkout-pix` (38), `test:e2e:checkout` (6) e 73
  testes das telas do checkout passando; build e lint do backend, lint e tipos do frontend OK.
- As telas não foram abertas no navegador: precisam de um vendedor na conta própria num banco
  com a migration aplicada, e os testes só usam banco descartável.

A confirmar com o responsável: o texto novo de Vendas, "As vendas caem direto na sua conta Efí.
A taxa da Cifra+ é cobrada à parte, por boleto, todo dia 30."

Com a Tarefa 5, um vendedor pode ser ativado na conta própria sem distorcer o razão. O
recebimento da taxa (`FEE_PAYMENT`) e o extrato por fechamento são a Tarefa 16.

### 17 e 18/11/2026: Tarefas 6 a 13 (etapa A completa e o reembolso da etapa B)

Feito e commitado, de `892193b` a `69c9e8f`:

- **Tarefa 6:** `EfiCheckoutSubscriptionClient`: plano, assinatura em dois passos, consulta e
  cancelamento. Os formatos foram conferidos na documentação da Efí em 17/11.
- **Tarefa 7 (adesão):**
  - Plano recorrente de 3 meses ou mais só no cartão, sem bump, cupom nem parcelas.
  - O pedido do ciclo 1 cria a assinatura. Na Efí, ela é criada sem cobrar, o id é gravado e só
    então o cartão é cobrado.
  - Resposta perdida é conciliada pela assinatura, e a assinatura de uma tentativa anterior é
    cancelada na Efí antes de criar outra.
- **Tarefa 8 (ciclo de vida):**
  - O primeiro pagamento ativa a assinatura.
  - O comprador (link do e-mail), o vendedor e o admin cancelam: a Efí primeiro, e o acesso vai
    até o fim do período.
  - Avisos: `subscription.renewal_disabled` na hora e `subscription.canceled` no dia em que o
    acesso acaba (worker). Reembolso total do ciclo 1 e contestação encerram a assinatura na hora.
  - O e-mail de acesso traz "Gerenciar assinatura".
  - Migration aditiva `20261117120000_checkout_subscription_efi_canceled`.
- **Tarefa 9 (telas):**
  - Seletor de plano na página (`?plano=`), com o texto de autorização no recorrente.
  - Página `/c/assinatura/<token>`.
  - No admin, a referência do termo nos termos e a conta Efí do vendedor no mesmo painel da conta
    Cifra+.
- **Tarefa 10:** e2e da etapa A.
- **Tarefa 11:**
  - Migration aditiva `20261118120000_checkout_refund_execution`, com uma execução aberta por
    pedido (índice parcial).
  - `EfiCheckoutRefundClient`: devolução Pix por `e2eId` com `id` nosso, consulta, e estorno de
    cartão.
- **Tarefa 12 (execução do reembolso):**
  - "Reembolsar" em Vendas e execução pelo admin com a referência do ok.
  - O Pix usa a mesma chave do aviso de devolução, então conta uma vez.
  - Recusa certa avisa o vendedor por e-mail e deixa o pedido aberto. Resposta perdida é
    conciliada pelo worker.
  - O comprador não desiste com a devolução em andamento (`CHECKOUT_REFUND_IN_PROGRESS`).
- **Tarefa 13:** no fim dos 7 dias, o worker devolve o pedido do comprador uma única vez. Os textos
  ao comprador deixaram de dizer que a Cifra+ faz a devolução.

Desvios e decisões técnicas:

- **Cotação do plano recorrente:** é a do cartão, porque a cotação Pix só aceita Pix.
- **Estorno de cartão:**
  - O total espera a cobrança ficar `refunded` (consulta do worker).
  - O parcial é concluído no aceite da Efí, porque a cobrança continua `paid`. A confirmar na
    homologação.
- **Resposta de pagamento da assinatura sem o valor:** vai para a conciliação pela consulta, em
  vez de virar divergência.
- **Auditoria de uma execução do sistema:** grava sem usuário. A primeira versão gravava `'system'`,
  que viola a chave estrangeira.

Testes, todos em infraestrutura descartável e com a Efí simulada:

- 1.457 unitários do backend.
- `test:e2e:checkout-pix` (48), `test:e2e:checkout` (6) e `card-checkout.e2e-spec.ts` (13).
- 90 testes de tela.
- Build do backend e do frontend, lint e tipos OK.
- Migrations aplicadas em PostgreSQL descartável, sem diferença com o schema.
- Os testes de tela das Tarefas 9 e 12 e os e2e das Tarefas 10, 12 e 13 foram escritos depois do
  código.

Não testado: nada disso passou pela Efí de verdade (homologação ou produção), e as telas não foram
abertas no navegador.
