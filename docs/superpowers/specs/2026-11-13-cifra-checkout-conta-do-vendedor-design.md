# Cifra+ Checkout: venda pela conta Efí do vendedor (13/11/2026)

> **Situação:** proposta. D1 e D2 foram decididas pelo responsável pelo produto em 13/11/2026, e
> D3 a D10 em 16/11/2026. **Aguardam confirmação:** o vencimento do BOLIX da taxa (D3), a
> referência do ok do vendedor (decisão técnica 8) e o nome do aviso do pedido de cancelamento
> (D10). Nada implementado.
> Muda a base da [spec do checkout](2026-10-30-cifra-checkout-design.md) (a venda saía pela conta
> Efí da Cifra+) e a Parte 3 (saldo, repasse e reembolso manual). A
> [spec de assinaturas](2026-11-12-cifra-checkout-assinaturas-design.md) continua valendo, agora
> sobre a conta do vendedor.

## Pedido

O primeiro cliente do checkout quer testar o MVP até **20/11/2026** e começar a divulgação na
primeira semana de dezembro, e só sai da Hubla com assinatura no cartão. Hoje o checkout recebe o dinheiro do comprador na conta Efí da Cifra+ e o
admin repassa ao vendedor por fora. O responsável quer saber se o CNPJ da Cifra+ comporta esse
modelo e, não comportando, entregar o checkout de um jeito que comporte, com reembolso feito pelo
sistema para o vendedor não precisar operar a Efí.

## Contexto do cliente (conversas com o dono e com o dev, lidas em 13/11/2026)

- **O que foi oferecido:** checkout com upsell, order bump e o fluxo de reembolso e chargeback
  "da forma que ele tem hoje", por **2,7% no total, banco e Cifra+**, para testar numa campanha
  do produto novo.
- **O que o dono espera:** link de checkout parecido com o da Hubla, de dois a quatro order bumps,
  um banner no topo, e um painel simples com quem pagou e quem não pagou (Pix gerado e não pago,
  cartão recusado), com nome e WhatsApp para remarketing. A preocupação dele é a **aprovação do
  cartão**.
- **Integração:** fica com o dev do cliente, que hoje consome estes avisos da Hubla:

  | Hubla | Para quê | Cifra+ |
  | --- | --- | --- |
  | `subscription.activated`, `customer.member_added` | Liberar o acesso | `subscription.activated` |
  | `subscription.deactivated`, `customer.member_removed` | Cortar o acesso | `subscription.canceled`, no dia em que o acesso acaba (D10) |
  | `invoice.status_updated` (pago) | Pagamento; a renovação é a fatura paga com `type = renewal` | `order.paid`, com o ciclo no bloco `subscription` |
  | `invoice.status_updated` (vencido) | Cartão recusado, Pix vencido | `order.card_declined`, `order.pix_expired`, `subscription.renewal_failed` |
  | `invoice.status_updated` (reembolso, chargeback) | Cortar o acesso | `order.refunded`, `order.chargeback` |
  | `lead.abandoned_checkout` | Carrinho abandonado | `lead.abandoned` |
  | `subscription.renewal_disabled` | Renovação desligada, acesso até o vencimento | O aviso do pedido de cancelamento, com a data (D10) |

- **Depois da compra:** no produto novo o dev trata o redirecionamento em código próprio.
- **Mensagem ao comprador (informado em 16/11):** o cliente precisa que quem paga receba um
  e-mail ou um WhatsApp para ativar o acesso. O e-mail "Seu acesso a …" já sai a cada pagamento
  confirmado, com o link e as instruções do produto. O checkout não envia WhatsApp ao comprador.
- **Não apareceu na conversa:** se o cliente tem conta Efí, e que o reembolso e o chargeback
  passam a sair da conta dele.

## O que a pesquisa mostrou (13/11/2026)

Não é parecer jurídico. As normas do Banco Central foram lidas por imprensa e por textos de
fornecedores, não pelo texto oficial.

- **CNAEs da Cifra+** (62.02-3, 62.01-5, 62.04-0, 63.11-9, 63.19-4): cobrem desenvolver, licenciar
  e hospedar software. Não cobrem receber dinheiro de terceiros e repassar, atividade que as fontes
  de contabilidade associam ao 66.19-3/99 ou ao 74.90-1/04. Incluir um CNAE não autoriza a
  atividade.
- **Conta-bolsão:** as Resoluções CMN 5.261 e BCB 518 (novembro de 2025) mandam bancos e
  instituições de pagamento encerrar contas usadas para receber ou pagar em nome de terceiros sem
  identificar cada titular. Um diretor do Banco Central citou marketplaces entre os usos legítimos,
  sem dizer o que torna o uso legítimo. O modelo de hoje fica nessa zona cinzenta, e o risco
  prático é a Efí encerrar a conta da Cifra+ com saldo de vendedores.
- **Efí, split:** existe na cobrança avulsa de cartão e no Pix. Os campos da assinatura
  (`POST /v1/plan/:id/subscription` e `/v1/subscription/:id/pay`) não têm `marketplace`.
- **Efí, devolução:** `PUT /v2/pix/:e2eId/devolucao/:id` (escopo `pix.write`; o `id` é de quem
  chama, e repetido é recusado) e `POST /v1/charge/card/:id/refund` (total em até 360 dias, parcial
  em até 90, um por dia por cobrança). O estorno de cartão "não está disponível para vendas de
  marketplace" e o Pix repassado por split não pode ser devolvido.
- **Efí, contestação:** a documentação mostra `contested` só como estado final. Não há rota para
  responder à contestação.
- **Asaas:** tem split na assinatura e subcontas no formato regulado, mas não há nada dele no
  sistema, e as subcontas ficam limitadas a 10 e a R$ 2.000 cada até a homologação.

## Decisões do responsável pelo produto

| # | Tema | Decisão | Situação |
| --- | --- | --- | --- |
| D1 | Conta emissora | A venda do checkout sai pela **conta Efí do próprio vendedor**. O dinheiro do comprador nunca passa pela conta da Cifra+. | Decidida em 13/11 |
| D2 | Taxa da Cifra+ | **Sem split.** A % Cifra+ é apurada pelo sistema e cobrada à parte. | Decidida em 13/11 |
| D3 | Como a taxa é cobrada | A Cifra+ cobra a taxa do período por **BOLIX todo dia 30**, **emitido à mão pelo admin** e registrado no sistema quando é pago. | Decidida em 16/11. A confirmar: o vencimento e o dia em fevereiro |
| D4 | Quem executa o reembolso | O **sistema**, na conta do vendedor, por dois caminhos: o **vendedor** clica em Reembolsar, ou o **admin da Cifra+** executa **com o ok do vendedor**. | Decidida em 16/11 |
| D5 | Pedido de reembolso do comprador | O pedido feito pelo comprador **espera 7 dias**, para o vendedor tentar manter a venda, e no fim do prazo o sistema **devolve sozinho**. O vendedor, ou a Cifra+ com o ok dele, pode antecipar. O termo da D9 precisa autorizar essa devolução sem clique. Segue a revisão jurídica (art. 49 do CDC). | Decidida em 16/11 |
| D6 | Devolução sem saldo | A Efí recusa, o vendedor é avisado por e-mail e na tela, e tenta de novo depois de colocar saldo. O comprador vê "em processamento". | Decidida em 16/11 |
| D7 | Chargeback | O aviso da Efí marca o pedido como contestado, cancela a assinatura e avisa o vendedor por e-mail e webhook, sem ação do admin. A defesa é do vendedor com a Efí. A % Cifra+ **não volta**, como hoje. | Decidida em 16/11 |
| D8 | Modo conta Cifra+ | Fica no código, mas o admin não consegue escolhê-lo para um cliente novo (`CHECKOUT_ACCOUNT_MODE_NOT_SUPPORTED`). | Decidida em 16/11 |
| D9 | Autorização do vendedor | O vendedor assina um termo autorizando a Cifra+ a emitir, consultar e devolver cobranças com as credenciais dele. O admin grava a referência do termo ao ativar a conta. | Decidida em 16/11 |
| D10 | Avisos de cancelamento da assinatura | Dois avisos: um **quando o cancelamento é pedido**, com a data em que o acesso acaba, e `subscription.canceled` **no dia em que o acesso acaba**. Muda a spec de assinaturas, em que `subscription.canceled` saía no pedido. | Decidida em 16/11. A confirmar: o nome do primeiro aviso |

## Fora do escopo

- Integração com o Asaas.
- Split em qualquer forma de pagamento.
- Débito automático da taxa Cifra+ na conta do vendedor (a cobrança é por BOLIX, D3).
- WhatsApp do checkout ao comprador (a confirmar com o cliente, abaixo).
- Defesa de chargeback pelo sistema.
- Antecipar ou garantir ao vendedor o valor de reembolso ou chargeback.
- Migrar para a conta do vendedor pedidos que saíram pela conta Cifra+: cada pedido fica preso à
  conta que o emitiu.
- Uma empresa de cobrança e uma de checkout usando a mesma conta Efí (a conta pertence a uma só
  empresa).
- Pix Automático.

## Como funciona

### Ativação da conta do vendedor (admin)

1. O vendedor abre ou já tem uma conta **Efí Empresas** no CNPJ dele, cria a aplicação e entrega
   ao admin: client id, client secret, certificado `.p12`, número da conta, código do recebedor e
   chave Pix. A aplicação precisa dos escopos de cobrança Pix, consulta, webhook e `pix.write`
   (devolução), e da API de Cobranças ativa. **Não** precisa do escopo de envio de Pix, e o admin
   não deve pedir.
2. Em Admin → Checkout → cliente → **Conta Efí**, o admin envia as credenciais, informa a
   referência do termo de autorização (D9) e valida. A validação faz o mesmo que a da conta Cifra+
   faz hoje: consulta a Efí, aponta o webhook da chave Pix para a API e confere.
3. O admin cadastra as **tarifas do contrato do vendedor com a Efí**: Pix, cartão à vista,
   antecipação e dias até o crédito. Elas alimentam o repasse da taxa ao comprador, as parcelas e o
   líquido mostrado ao vendedor.
4. O cartão só é ligado depois da liberação de cartão não presente **na conta do vendedor**
   (formulário de KYC da Efí, até 5 dias úteis).

Sem conta validada, a página do vendedor responde `CHECKOUT_UNAVAILABLE`, como hoje.

### Venda

Nada muda para o comprador, a não ser o nome de quem recebe: no Pix e na fatura do cartão aparece
o vendedor, não a Cifra+. Pix, cartão, cotação, tentativas, limites, ofertas e cartão
reaproveitado seguem o fluxo de hoje, só que com as credenciais da conta do vendedor. Cada pedido
grava a conta que o emitiu, e consulta, conciliação e devolução usam sempre essa conta.

### Taxa da Cifra+

- A % Cifra+ continua fotografada no pedido, pelos termos do vendedor.
- O razão do vendedor passa a responder **quanto ele deve à Cifra+**: soma das taxas das vendas
  pagas, menos o que voltou por reembolso, menos o que ele já pagou.
- **Fechamento todo dia 30 (D3):** a taxa das vendas pagas no período, menos o que voltou por
  reembolso, vira um BOLIX da Cifra+ para o vendedor, emitido à mão pelo admin. A confirmar: o
  vencimento, o dia em fevereiro e o que fazer com um fechamento abaixo do valor mínimo de boleto.
- Admin → Checkout → cliente mostra a taxa em aberto por fechamento e tem **Registrar
  recebimento** (valor, data, referência), com auditoria. O vendedor vê o mesmo extrato em Vendas.
- Saldo liberado, saldo pendente e repasse sugerido não aparecem para esse vendedor.

### Reembolso

1. O pedido nasce como hoje: o comprador pela página do pedido (em até 7 dias, com retenção) ou o
   vendedor em Vendas, inteiro ou por item.
2. **Execução (D4):** o vendedor clica em **Reembolsar** em Vendas (o próprio pedido dele ou um do
   comprador), ou o admin da Cifra+ executa em Admin → Checkout com o ok do vendedor, ou termina
   a espera de 7 dias do pedido do comprador (D5). O sistema grava a execução e só então chama a
   Efí:
   devolução Pix pelo `e2eId` ou estorno do cartão pelo id da cobrança, no valor do pedido de
   reembolso.
3. **Conclusão:** vale o que a Efí confirmar. No Pix, o aviso de devolução já conclui o reembolso
   pela rotina de hoje. No cartão, a cobrança passa a `refunded` e a mesma rotina é chamada.
4. **Recusa certa** (sem saldo, prazo vencido): a execução fica `FAILED` com o motivo, o pedido de
   reembolso continua aberto e o vendedor tenta de novo.
5. **Resultado incerto:** nunca é reenviado. Um worker consulta a Efí (a devolução Pix pelo `id`
   gravado; o cartão pelo estado da cobrança) até saber.
6. A % Cifra+ volta ao vendedor na proporção do que foi devolvido, como hoje.
7. O reembolso feito por fora (no app da Efí) continua existindo: o Pix chega pelo aviso, e o
   cartão é registrado pelo vendedor em Vendas.

### Chargeback

O aviso de cobranças da Efí com a cobrança contestada marca o pedido `CHARGEBACK`, gera
`order.chargeback`, manda um e-mail ao vendedor com o que fazer na Efí e cancela a assinatura
ligada ao pedido (D10 da spec de assinaturas). O admin continua podendo registrar um chargeback à
mão.

### Assinaturas (Parte 10)

Os planos da Efí são criados na conta do vendedor (`CheckoutEfiPlan` já é por conta), e a
assinatura e as renovações saem dela. A taxa Cifra+ de cada ciclo entra no fechamento do período.

**Avisos de cancelamento (D10):**

- **Cancelamento pedido** pelo comprador, pelo vendedor ou pelo admin, com acesso até o fim do
  período pago: sai na hora o aviso com a data em que o acesso acaba. Nome proposto:
  `subscription.renewal_disabled`, igual ao que o dev já trata na Hubla e no padrão dos outros
  eventos (o responsável chamou de `subscription.canceledDate`). **A confirmar.**
- **Fim do acesso:** `subscription.canceled`, com o motivo, uma única vez, no dia em que o acesso
  acaba. Um worker dispara os que venceram.
- **Fim na hora** (reembolso do primeiro ciclo, chargeback, renovação sem pagamento depois da
  tolerância): sai só `subscription.canceled`, no momento em que acontece.

## Decisões técnicas (revisar se discordar)

1. **Modo nos termos.** `CheckoutSellerTerms.accountMode` (`SELLER_ACCOUNT` ou
   `PLATFORM_ACCOUNT`). Os termos são versionados e cada pedido já aponta para os seus, então o
   pedido sabe para sempre em que modo foi vendido. Termos existentes ficam `PLATFORM_ACCOUNT`.
2. **Configuração da conta por vendedor na tabela que já existe.** `CheckoutPlatformSettings`
   ganha `companyId` opcional: sem empresa é a conta Cifra+, com empresa é a conta daquele
   vendedor, com versões próprias. `CheckoutPlatformService.ready()` e `cardReady()` passam a
   receber a empresa, e `CheckoutCatalogService.accounts()` escolhe pelo modo dos termos. O resto
   do checkout já recebe a conta por parâmetro.
3. **Credenciais.** `EfiAccountRegistryService.registerCompanyCredential`, que a cobrança já usa.
4. **Avisos de cartão.** `WebhooksService` entrega ao checkout o aviso de uma conta `PLATFORM` ou
   de uma conta de empresa com produto `CHECKOUT`. `CheckoutCardService.handleNotification` e
   `reconcile` carregam a conta da tentativa, não a conta atual.
5. **Razão espelhado.** A venda continua gravando `SALE`, `EFI_FEE` e `PLATFORM_FEE`, para Vendas
   e o índice de chargeback não mudarem. No modo conta do vendedor entra junto um lançamento
   `DIRECT_SETTLEMENT` com o valor que já está na conta dele, e o saldo fica igual a menos a taxa
   devida. Reembolso e chargeback ganham o `DIRECT_SETTLEMENT` contrário. O pagamento da taxa é
   `FEE_PAYMENT`.
6. **Execução do reembolso.** `CheckoutRefundExecution` é gravada antes do envio; o `id` dela é o
   `id` da devolução Pix. Uma execução em aberto por pedido de reembolso.
7. **Retenção no modo conta do vendedor.** `CHECKOUT_REFUND_ON_HOLD` deixa de barrar a execução
   pelo vendedor e pelo admin com o ok dele; continua barrando o registro manual de uma devolução
   feita por fora. Um worker executa os pedidos do comprador cuja espera terminou.
8. **Ok do vendedor (D4).** Ao executar, o admin informa a referência do ok (por exemplo, a
   mensagem e a data). Ela fica na execução e na auditoria, sem o texto da conversa.

## Modelo de dados (migration aditiva)

- **`CheckoutSellerTerms`:** `accountMode` (padrão `PLATFORM_ACCOUNT` nas linhas existentes) e
  `authorizationReference` (opcional).
- **`CheckoutPlatformSettings`:** `companyId` opcional. A versão passa a ser única por empresa, com
  um índice parcial para as linhas sem empresa.
- **`CheckoutLedgerKind`:** `DIRECT_SETTLEMENT` e `FEE_PAYMENT`.
- **`CheckoutRefundExecution`:** id, `companyId`, `refundRequestId`, `orderId`, método,
  `amountCents`, `status` (`SUBMITTING`, `DONE`, `FAILED`, `UNCERTAIN`), motivo da recusa,
  `issuerIdentityId`, quem pediu, datas.
- **Dados:** nenhum vendedor muda de modo sozinho; pedidos existentes não mudam.

## Segurança e LGPD

- As credenciais do vendedor ficam cifradas, como as da cobrança, e nunca voltam em resposta,
  log ou auditoria.
- Sem escopo de envio de Pix, a credencial guardada só consegue devolver um Pix recebido, até o
  valor recebido.
- A devolução nunca passa do que foi pago menos o que já voltou (regra de hoje).
- Executar reembolso exige usuário da empresa dona do pedido (outra empresa responde 404) ou o
  admin da Cifra+ com a referência do ok do vendedor.
- O vendedor passa a ser quem recebe do comprador. Os textos de `/termos-checkout` e
  `/privacidade-checkout` precisam dizer isso e que a Cifra+ é a fornecedora da tecnologia.

## A confirmar com a Efí

- O estorno pela API vale para cobrança de **assinatura**?
- O que acontece com estorno de cartão quando a venda ainda não foi creditada na conta (até 31
  dias) e com devolução Pix sem saldo?
- Como chega o aviso de contestação, qual o prazo de resposta e se há tarifa.
- O significado do erro `4600037`, visto na conta Cifra+ em homologação.
- Prazo real da liberação de cartão não presente na conta do vendedor, e qual o limite de emissão
  de uma conta nova. Uma campanha de lançamento pode bater nesse limite.
- A tarifa de cartão que o cliente consegue negociar (ver o preço prometido, abaixo).

## A confirmar com o cliente

- **Preço (esclarecido pelo responsável em 13/11):** a % Cifra+ é **1,5%**. No Pix o vendedor
  paga também a tarifa da Efí (1,19%, informada pelo responsável), o que dá os 2,7% combinados.
  No cartão a tarifa da Efí é **repassada ao comprador**, como ele já faz na Hubla, e o vendedor
  paga só 1,5%. Falta dizer isso a ele com essas palavras, e os planos dele nascem com a taxa do
  cartão por conta do comprador.
- **Conta Efí Empresas** no CNPJ dele, e que o dinheiro, o reembolso e o chargeback passam por ela.
- **Depois da compra:** se o dev quer a página dele (`https`) ou só o webhook.
- **Mensagem ao comprador:** se o e-mail de acesso que já existe basta, ou se o link de ativação é
  único por comprador. Sendo único, quem envia é o sistema do cliente ao receber `order.paid` ou
  `subscription.activated`. WhatsApp pelo checkout exigiria um template aprovado na Meta e o
  consentimento do comprador, e não está no escopo.

## A confirmar fora da Efí

- **Contador:** a taxa por uso do software, em percentual, cabe nos CNAEs atuais, e o código de
  serviço da nota.
- **Advogado:** o termo de autorização (D9), a retenção de 7 dias (D5) e os textos ao comprador.
  O lançamento não depende disso, mas a operação continuada sim.

## Ordem até o teste (20/11) e o lançamento (primeira semana de dezembro)

O que depende de terceiros começa no dia 1: a conta Efí do vendedor, o formulário de KYC do
cartão e as perguntas à Efí. A análise da Efí leva até 5 dias úteis e 20/11 é feriado, então o
cartão em produção na conta do vendedor pode não estar liberado no dia do teste; nesse caso o
teste do cartão é feito em homologação.

1. **Conta do vendedor:** modo nos termos, configuração por vendedor, ativação pelo admin, avisos
   de cartão e a venda de Pix e cartão avulsos na conta dele.
2. **Assinatura no cartão** na conta do vendedor: tarefas 5 a 7 da Parte 10, a página do
   comprador, os e-mails mínimos e **os avisos de webhook da assinatura**, com os dois de
   cancelamento (D10), que são a integração do dev do cliente.
3. **Reembolso pela API** e chargeback pelo aviso.
4. **Taxa Cifra+:** extrato e registro de recebimento.

Os itens 1 e 2 são o que o cliente testa em 20/11. Os itens 3 e 4 precisam estar prontos antes da
divulgação.

Podem ficar para depois do lançamento: renovação de plano recorrente por Pix, ajuste de bump de
pagamento único depois do primeiro ciclo e a API de consulta de assinaturas.

## Critérios de pronto e testes

- Um vendedor no modo conta do vendedor vende Pix e cartão com as credenciais dele; a tentativa
  grava a conta dele; o aviso de outra conta não dá baixa.
- Um vendedor sem conta validada não vende.
- Um vendedor que já está no modo conta Cifra+ segue vendendo como hoje. Os e2e atuais continuam
  cobrindo esse modo; com a D8, eles gravam os termos nesse modo sem passar pela rota do admin.
- O admin não consegue criar termos no modo conta Cifra+ (D8).
- Venda paga no modo conta do vendedor: o saldo do razão é menos a taxa Cifra+; o reembolso
  devolve a taxa na proporção; `FEE_PAYMENT` zera o que foi pago.
- Reembolso: a execução é gravada antes do envio; resposta perdida não gera segundo envio; recusa
  por saldo deixa o pedido aberto; duplo clique não cria duas execuções; a empresa B não executa
  reembolso da empresa A.
- O admin executa um reembolso só com a referência do ok do vendedor, e ela fica na auditoria.
- Retenção: o pedido do comprador é executado sozinho no fim do prazo, uma única vez, e o vendedor
  consegue antecipar.
- Cancelamento pedido gera o aviso com a data, e `subscription.canceled` sai uma única vez no fim
  do acesso; cancelamento na hora gera só `subscription.canceled`.
- Aviso de contestação marca o pedido uma vez, mesmo repetido.
- Migration aplicada em banco descartável, com vendedores e pedidos existentes.
