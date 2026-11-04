# Cifra+ Checkout, Parte 7: upsell e downsell (plano)

> **Para execução por agente:** executar por tarefa, com o teste antes da implementação e commits
> por passo lógico (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável; a Efí é sempre simulada.

**Objetivo:** logo depois da compra, o comprador recebe uma oferta de outro produto e aceita com um
clique, pelo mesmo meio de pagamento. Se recusar, pode receber uma segunda oferta mais barata
(downsell). O vendedor também pode levar o comprador para a própria página de vendas e usar ali
links de 1 clique. Cada oferta aceita é uma venda separada, ligada à compra de origem.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), CK-31 a CK-33.

**Base:** branch novo a partir da Parte 6 (o upsell no cartão usa o fluxo de cartão).

## Decisões do responsável pelo produto (09/11/2026)

- **Cartão reaproveitado:**
  - o upsell no cartão usa o token reutilizável da Efí (cartão da compra principal);
  - o cartão já foi homologado no ambiente de homologação da Efí (informado em 09/11), então o
    upsell no cartão entra **ligado** junto com esta parte, sem chave própria: vale sempre que o
    cartão está ligado na conta Cifra+ e não está pausado para o vendedor;
  - o upsell no Pix funciona desde o início.
- **Parcelas no upsell de cartão:** o comprador escolhe, até o máximo do vendedor. A primeira opção
  já vem marcada, então quem não muda nada aceita com um clique.
- **Downsell:** uma oferta por produto, opcional. Recusou o upsell, aparece o downsell; recusou de
  novo, segue para o acesso.
- **Validade da oferta:** o vendedor define, por produto, por quanto tempo depois da compra a
  oferta e o link de 1 clique valem.

## Decisões técnicas (revisar se discordar)

1. **Ofertas (`CheckoutOffer`):**
   - **o que é:** o vendedor cria, por produto principal, até duas ofertas: `UPSELL` e
     `DOWNSELL` (opcional, só com upsell);
   - **conteúdo:** outro produto dele, com preço de oferta, "De / Por", título e texto, como o
     order bump;
   - **concorrência:** versão esperada e `409`, como os bumps.
2. **Destino depois da compra** (no produto):
   - **opções:** link de acesso (o atual), oferta (upsell e downsell na página da Cifra+) ou página
     externa do vendedor (`https`);
   - **validade da oferta:** de 15 minutos a 24 horas, com padrão de 30 minutos. O limite de
     24 horas reduz o risco de um link vazado;
   - **e-mail de acesso:** continua saindo em qualquer caso.
3. **Venda da oferta:**
   - **pedido próprio:** cada oferta aceita vira um pedido (`parentOrderId` e `offerId`), com
     comprador, produto, preço da oferta, tarifas e % Cifra+ fotografados;
   - **sem cupom e sem bump;**
   - **saldo:** liberação, reembolso e webhook próprios, como qualquer venda.
4. **Link de 1 clique:**
   - **o segredo:** no pagamento da compra principal, o pedido ganha um `offerToken` aleatório,
     guardado só como hash;
   - **validade:** do pagamento até o fim da janela do produto;
   - **página da Cifra+:** `/c/oferta/<token>` mostra a oferta do momento;
   - **página do vendedor:** recebe o token na URL (`?cifra_oferta=<token>`) e monta os botões para
     `/c/oferta/<token>?oferta=<id>`, com qualquer oferta ativa dele. Assim ele encadeia ofertas e
     faz downsell como quiser;
   - **cada oferta uma vez:** a resposta (aceita ou recusada) é gravada
     (`CheckoutOfferResponse`, única por pedido de origem e oferta);
   - **quem já tem o produto:** a oferta não aparece para quem tem uma compra paga, não reembolsada,
     do produto oferecido, com acesso ainda válido.
5. **Pix na oferta:** um Pix novo de 30 minutos, com os dados do comprador já preenchidos, pelo
   mesmo fluxo da Parte 2. A página segue para o estado do pedido da oferta.
6. **Cartão na oferta:**
   - **token reutilizável:** quando o produto tem oferta, a página tokeniza o cartão da compra
     principal com `reuse: true` (biblioteca `payment-token-efi`). A documentação da Efí põe o
     `reuse` só na tokenização; o corpo do `one-step` não tem esse campo e a resposta não traz
     token novo, então o token guardado é o mesmo enviado na compra;
   - **o que fica guardado:** o token, o CPF do titular e o endereço de cobrança ficam cifrados
     (`PaymentCryptoService`) só até o fim da janela da oferta;
   - **limpeza:** um worker apaga esses dados quando a janela termina, depois de uma recusa ou um
     dia depois de uma tentativa sem pagamento; o pedido da oferta nunca guarda o cartão de novo;
   - **cobrança:** usa o mesmo fluxo da Parte 6 (cotação no servidor, tentativa gravada antes do
     envio, resultado incerto conciliado e nunca reenviado, limites);
   - **recusa no upsell:** a oferta pode ser paga com Pix;
   - **ligar e desligar:** segue o cartão da conta Cifra+ (`cardEnabled`) e a pausa por vendedor.
     Sem token guardado (compra principal no Pix, ou cartão desligado na hora), a oferta é só Pix.
7. **Webhook ao vendedor:** os eventos do pedido da oferta trazem `parentOrderId` e
   `offer: { id, kind }`. Não há evento novo.
8. **Telas:**
   - **Vendas:** marca "Upsell" ou "Downsell" com o pedido de origem;
   - **Recuperação:** um Pix de oferta não pago aparece como "Oferta não paga";
   - **aviso de privacidade:** ganha a linha sobre o cartão guardado durante a oferta.

## Modelo de dados (migration aditiva)

- **`CheckoutProduct`:**
  - `afterPurchase` (`ACCESS` | `OFFER` | `EXTERNAL`, padrão `ACCESS`);
  - `afterPurchaseUrl?` e `offerWindowMinutes` (padrão 30).
- **`CheckoutOffer`:**
  - **ligação:** id, empresa, produto de origem e `kind` (`UPSELL`/`DOWNSELL`), únicos juntos;
  - **conteúdo:** produto oferecido, preço, "De", título e texto;
  - **controle:** ativo, versão e datas.
- **`CheckoutOfferResponse`:** pedido de origem, oferta, decisão (`ACCEPTED`/`DECLINED`), pedido
  gerado e data, com `@@unique([orderId, offerId])`.
- **`CheckoutOrder`:** `parentOrderId?`, `offerId?`, `offerTokenHash?` e `offerExpiresAt?`.
- **`CheckoutCardAttempt`:** `reuseEncrypted?` (token, CPF do titular e endereço, cifrados) e
  `reuseWipedAt?`.

## Tarefas

1. **Schema e migration**, conferida em banco descartável.
2. **Ofertas do vendedor:**
   - CRUD de upsell e downsell no produto, com versão esperada;
   - destino depois da compra e validade da oferta, com as validações da URL externa;
   - isolamento por empresa.
3. **Token da oferta:**
   - geração no pagamento e validade pela janela;
   - consulta pública da oferta do momento;
   - regra de quem já tem o produto;
   - decisão gravada uma vez.
4. **Aceite no Pix:** pedido da oferta ligado à origem, Pix novo, eventos com `parentOrderId`.
5. **Aceite no cartão:**
   - token reutilizável na compra principal e dados cifrados;
   - cotação e cobrança pelo fluxo da Parte 6;
   - limpeza ao fim da janela.
6. **Frontend:**
   - vendedor: seção "Depois da compra" e as ofertas no produto, com o link de 1 clique para
     copiar;
   - comprador: página `/c/oferta/<token>` (aceitar, parcelas, recusar e downsell) e a passagem
     pela página do pedido;
   - Vendas e Recuperação;
   - aviso de privacidade.
7. **Fluxo em banco descartável:**
   - upsell no Pix aceito vira venda separada;
   - recusa leva ao downsell e depois ao acesso;
   - a mesma oferta não é aceita duas vezes;
   - link vencido ou de outro pedido não vende;
   - quem já tem o produto não vê a oferta;
   - upsell no cartão com o token da compra principal, e os dados apagados depois da janela;
   - isolamento entre vendedores.
8. **Documentação:** AGENTS.md, spec, runbook e registro.

## Fora desta parte

- Reembolso de um item ou de um upsell sem devolver o pedido inteiro (Parte 8, CK-35). Nesta parte,
  o upsell já pode ser reembolsado sozinho porque é um pedido próprio.
- Cadeias maiores na página da Cifra+ (mais de upsell e downsell): ficam com a página do vendedor.

## Efí: token reutilizável (conferido em 09/11)

- [Documentação de cartão](https://dev.efipay.com.br/docs/api-cobrancas/cartao/): o atributo
  `reuse: true` vai na geração do `payment_token`, no navegador; o token pode ser usado em mais de
  uma transação sem guardar os dados do cartão.
- A documentação não diz por quanto tempo o token vale. A janela da oferta (no máximo 24 h) limita
  o uso do nosso lado.
- **Conferir na homologação, antes de ligar em produção:** uma segunda cobrança `one-step` com o
  mesmo token, sem o comprador digitar o cartão. Se a Efí devolver um token diferente na resposta,
  o cliente da Efí precisa guardá-lo (hoje a resposta documentada não traz token).

## Registro de execução (09/11/2026, branch `feat/cifra-checkout-parte-7`)

As tarefas 1 a 8 foram executadas. Nada foi commitado nem publicado.

**Desvios do plano:**
- **Token reutilizável (decisão do responsável, 09/11):** o upsell no cartão entra ligado, sem a
  chave `cardReuseEnabled`, porque o cartão foi homologado no ambiente de homologação da Efí. O
  `reuse: true` vai na tokenização do navegador, como na documentação da Efí; o token guardado é o
  mesmo enviado na compra.
- **Token da oferta derivado:** o token da oferta é o hash do token do pedido (`offerTokenOf`), e no
  banco fica só o hash dele. Assim a página do pedido monta o link sem guardar segredo, e quem
  recebe o link (inclusive a página do vendedor) não consegue ver o pedido nem pedir reembolso.
- **Resposta sem pedido gerado:** `CheckoutOfferResponse` grava só a decisão; o pedido da oferta é
  achado por `parentOrderId` e `offerId`. Um Pix vencido ou um cartão recusado na oferta deixam o
  comprador pagar de novo com Pix enquanto a janela está aberta.
- **Quem pode ver a oferta pelo link do vendedor:** qualquer oferta ativa da mesma empresa
  (`?oferta=<id>`), como no plano. Na página da Cifra+, o downsell aparece só depois da recusa do
  upsell.
- **Ofertas não são apagadas:** sem rota de remoção; desativar a oferta tira ela das páginas e
  preserva os pedidos e as respostas ligados a ela.
- **Limite por IP no e2e:** o fluxo descartável usa uma instância própria do `ThrottleGuard` para
  começar os cenários de oferta com os limites zerados (todas as requisições vêm do mesmo IP).

**Checks executados:**
- **Backend:**
  - `npm test -- --runInBand`: 159 suítes, 1.354 testes;
  - `npm run build`;
  - `npx eslint` no módulo de checkout, no guard e no e2e: sem erros;
  - `npm run test:e2e:checkout` (6) e `npm run test:e2e:checkout-pix` (28, 6 novos de ofertas).
- **Migration:** `20261109120000_checkout_offers`, aplicada do zero num PostgreSQL descartável
  (60 migrations), sem diferença no `prisma migrate diff`.
- **Frontend:** `npx jest --runInBand` (81 suítes, 502 testes), `npm run lint` (só o aviso
  conhecido do `useReactTable`) e `npm run build`.
- **Telas no ambiente local:** oferta do upsell, recusa levando ao downsell, aceite no Pix
  seguindo para o pedido da oferta, e o produto com "Depois da compra" e as ofertas. O Pix não é
  gerado localmente porque a conta Cifra+ local tem credenciais falsas.

**Pendências:**
- **Homologação do reuso:** comprar com cartão de teste num produto com oferta e aceitar o upsell no
  cartão, conferindo na Efí as duas cobranças com o mesmo `payment_token`.
- **Revisão jurídica:** a linha nova do aviso de privacidade (cartão guardado durante a oferta).
- **Publicação:** backend com `prisma migrate deploy` antes do frontend.
