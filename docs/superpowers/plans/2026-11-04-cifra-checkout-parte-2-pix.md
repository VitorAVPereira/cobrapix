# Cifra+ Checkout, Parte 2: venda por Pix (plano)

> **Para execução por agente:** executar por tarefa, na ordem, com o teste antes da implementação
> e commits por passo lógico (só com pedido do responsável). Testes de banco e Redis só em
> infraestrutura descartável. A Efí é sempre simulada nos testes; nenhuma chamada real.

**Objetivo:** o comprador abre `/c/<slug>`, escolhe os bumps, aplica cupom e paga por Pix na conta
Efí da Cifra+. O pagamento é confirmado pelo webhook, e o acesso chega por redirecionamento e por
e-mail.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), itens CK-07 a
CK-12.

**Pré-requisito:** a correção de rotas do frontend (branch `fix/checkout-rotas-frontend`) estar no
`main`.

## Decisões do responsável pelo produto (04/11/2026)

- **Conta da Cifra+:** já tem aplicação de API com escopos Pix, certificado `.p12` e chave Pix.
  As credenciais são cadastradas pelo admin numa tela nova.
- **Tarifa do Pix na conta Cifra+:** percentual, configurado pelo admin e versionado. Sem tarifa
  configurada, o checkout não vende.
- **Aviso de venda ao vendedor:** não há e-mail. Ele acompanha pela tela de Vendas (Parte 3) e pelo
  webhook (Parte 4).
- **Descrição do Pix no banco do comprador:** produto e vendedor, como em
  `Porquim Anual — Porquim via Cifra+`, cortada em 140 caracteres.

## Restrições globais

- **Conta Cifra+ separada da cobrança:**
  - o checkout emite só pela identidade `PLATFORM` escolhida para ele;
  - a cobrança continua recusando `PLATFORM_ACCOUNT`;
  - nada muda em `PaymentCharge`, no split ou na conciliação.
- **Confirmação:** só o webhook Efí (ou a consulta à Efí pelo `txid`) confirma o pagamento; o
  navegador nunca. Webhook repetido não repete efeito.
- **Resultado incerto:**
  - se a resposta da Efí se perder na criação, a tentativa fica `UNCERTAIN` e é conciliada pela
    consulta do `txid`;
  - o mesmo pedido nunca gera um segundo Pix;
  - a mesma chave idempotente devolve o mesmo pedido.
- **Valores fotografados no pedido:** itens, preços, desconto, acréscimo, tarifa, % Cifra+,
  versão dos termos e versão da conta. Mudar a configuração não altera um pedido feito.
- **Dados do comprador:**
  - só no pedido;
  - fora dos logs, assim como o corpo do webhook;
  - o token público do pedido é aleatório (32 bytes) e só mostra aquele pedido.
- **Rotas públicas** com limite por IP. Cartão continua desligado.
- **Migration aditiva.**

## Mapa de arquivos

**Backend** (`api-cobranca/`):

| Arquivo | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma` e `migrations/<data>_checkout_pix/` | Conta e tarifa da Cifra+, pedidos e tentativas de pagamento |
| `src/financial-activation/efi-account-registry.service.ts` | `registerPlatformCredential`: identidade `PLATFORM` (sem empresa) e versão de credencial |
| `src/checkout/checkout-platform.service.ts`, `checkout-platform.controller.ts` | Admin: cadastrar e validar a conta Efí da Cifra+, ligar o webhook Pix da chave e definir a tarifa |
| `src/checkout/checkout-pricing.ts` | Regras puras: itens, cupom válido, desconto, acréscimo, tarifa e % Cifra+ |
| `src/checkout/checkout-catalog.service.ts` | Visão pública do produto e cotação |
| `src/checkout/efi-checkout-pix.client.ts` | Pix imediato (`pixCreateImmediateCharge`, `pixDetailCharge`) na conta da Cifra+, com respostas normalizadas |
| `src/checkout/checkout-orders.service.ts` | Pedido, emissão do Pix, resultado incerto e consulta pública |
| `src/checkout/checkout-payments.service.ts` | Confirmação pelo webhook ou pela consulta e uso do cupom |
| `src/checkout/checkout.worker.ts` | A cada minuto: concilia `UNCERTAIN` e expira pedidos vencidos |
| `src/checkout/checkout-mail.processor.ts` | Fila BullMQ do e-mail de acesso ao comprador |
| `src/checkout/checkout-public.controller.ts` | Rotas públicas novas |
| `src/payment/efi.service.ts` | `handlePixWebhook` entrega ao checkout os `txid` do checkout antes da busca de cobrança |
| `src/common/guards/throttle.guard.ts` | Limites das rotas públicas do checkout |
| `test/checkout-pix.e2e-spec.ts` | Fluxo em banco descartável com a Efí simulada |

**Frontend** (`front-cobranca/`):

| Arquivo | Responsabilidade |
| --- | --- |
| `src/app/c/[slug]/page.tsx` e componentes em `src/components/checkout-public/` | Página de pagamento |
| `src/app/c/pedido/[token]/page.tsx` | Pedido: QR Code, copia e cola, contagem, confirmação e redirecionamento |
| `src/app/privacidade-checkout/page.tsx` | Aviso de privacidade do checkout |
| `src/lib/public-routes.ts` | `/c/...` público, como `/pagar/...` |
| `src/app/(dashboard)/admin/checkout/page.tsx` | Seção "Conta Efí da Cifra+" |

## Modelo de dados

```prisma
enum CheckoutOrderStatus { PENDING PAID EXPIRED FAILED }
enum CheckoutAttemptStatus { CREATING ACTIVE PAID EXPIRED UNCERTAIN FAILED }

// Versioned; the highest version is the current one.
model CheckoutPlatformSettings {
  id, version Int @unique, identityId (EfiAccountIdentity, ownership PLATFORM),
  pixFeeBasisPoints Int, webhookConfiguredAt DateTime?, changedByUserId, createdAt
}

model CheckoutOrder {
  id, companyId, productId, publicToken String @unique, idempotencyKey String @unique,
  status CheckoutOrderStatus, buyerName, buyerEmail, buyerDocument, buyerPhone,
  items Json,                 // photo: main + bumps with name, price, discount, delivery, access
  couponId?, couponCode?, subtotalCents, discountCents, surchargeCents, totalCents,
  efiFeeBasisPoints, efiFeeCents, platformFeeBasisPoints, platformFeeCents,
  feePayer CheckoutFeePayer, termsId, platformSettingsId, utm Json?,
  expiresAt, paidAt?, accessEmailSentAt?, createdAt, updatedAt
  @@index([companyId, status, createdAt])
}

model CheckoutPaymentAttempt {
  id, orderId @unique,       // one Pix per order: a new Pix is a new order
  companyId, issuerIdentityId, efiTxid String @unique, status CheckoutAttemptStatus,
  amountCents, pixCopyPaste?, pixQrCodeImage? (Text), endToEndId?, paidAmountCents?,
  providerFeeCents?, lastCheckedAt?, createdAt, updatedAt
}
```

O `txid` do checkout começa com `ckt` e completa 32 caracteres alfanuméricos. Assim, o webhook
separa o checkout das cobranças sem consultar as duas tabelas.

## Regras de valor (`checkout-pricing.ts`)

- **P** = preço do produto principal − desconto do cupom + preço promocional dos bumps marcados
  (ativos, com produto oferecido ativo).
- **Desconto:** `couponDiscountCents` da Parte 1, só no principal. O cupom vale se:
  - estiver ativo;
  - estiver dentro da validade em São Paulo;
  - `usedCount < maxUses`;
  - valer para o produto.

  O uso só conta quando o pedido é pago. Pedidos em aberto podem passar do limite; o Pix já gerado
  é honrado.
- **Tarifa Pix** `t` em pontos-base, da versão atual da conta:
  - **comprador paga:** `total = ceil(P × 10000 / (10000 − t))`, `acréscimo = total − P`;
  - **vendedor paga:** `total = P`.

  A tarifa estimada é `round(total × t / 10000)`. A tarifa real da Efí (`gnExtras.tarifa`), quando
  vier no webhook, fica na tentativa para a Parte 3.
- **% Cifra+:** `round(P × bps / 10000)`, sobre P, nunca sobre o acréscimo.

## Tarefas

### Tarefa 1: Schema e migration

- Tabelas e enums acima, numa migration aditiva.
- **Teste:** migration do zero em banco descartável e `prisma migrate diff` sem diferença.

### Tarefa 2: Conta Efí da Cifra+ no admin (backend)

- `GET /admin/checkout/platform-account`: a conta atual, sem segredo nenhum (ambiente, conta,
  chave Pix, versão da credencial, estado, URL do webhook, tarifa e histórico).
- `POST /admin/checkout/platform-account/credentials` (multipart com `.p12`):
  - campos: ambiente, CNPJ, número da conta, código do recebedor, chave Pix, client id e secret;
  - cria ou reusa a identidade `PLATFORM` e grava uma credencial `CANDIDATE` cifrada;
  - **em produção**, a conta e o CNPJ precisam bater com `EFI_PLATFORM_ACCOUNT_NUMBER` e
    `EFI_PLATFORM_CNPJ`; diferença responde 409.
- `POST .../validate`:
  - autentica na Efí, consulta a chave e lê o webhook atual da chave;
  - **se a chave já tiver webhook para outra URL**, responde `PIX_WEBHOOK_IN_USE` com a URL e só
    sobrescreve com `confirmOverwrite: true`, porque a Efí aceita um webhook por chave;
  - configura o webhook, ativa a credencial e aposenta a anterior.
- `PUT .../pix-fee`: grava uma versão nova da tarifa, com `expectedVersion`.
- Tudo com auditoria, sem client id, secret ou certificado no log ou na resposta.
- **Testes:**
  - conta diferente da env em produção é recusada;
  - webhook ocupado não é sobrescrito sem confirmação;
  - credencial antiga aposentada;
  - resposta sem segredo;
  - 409 de versão.

### Tarefa 3: Regras de valor

- Funções puras de `checkout-pricing.ts`.
- **Testes:**
  - os dois pagadores da tarifa;
  - arredondamentos;
  - piso do cupom;
  - cupom vencido, esgotado, de outro produto ou inativo;
  - bump inativo ou com produto inativo ignorado;
  - % Cifra+ sem o acréscimo.

### Tarefa 4: Visão pública e cotação

- `GET /checkout/public/products/:slug`:
  - devolve produto, preços, imagem, período, bumps válidos, aparência, suporte, botão de WhatsApp
    e formas de pagamento;
  - responde 404 para produto inativo ou empresa não `ACTIVE`;
  - responde `available: false`, com mensagem simples, se faltar a conta Cifra+, a tarifa ou os
    termos.
- `POST /checkout/public/products/:slug/quote`: bumps, cupom e forma de pagamento, devolvendo os
  totais.
- Limites por IP no `ThrottleGuard`:
  - leitura: 120 por minuto;
  - cotação: 60 por minuto;
  - pedido: 10 a cada 15 minutos;
  - consulta do pedido: 120 por minuto.
- **Testes:**
  - nenhum campo interno vaza (URL de acesso, termos, conta);
  - cupom inválido explica o motivo em PT-BR.

### Tarefa 5: Pedido e emissão do Pix

- `POST /checkout/public/products/:slug/orders`:
  - recebe comprador, bumps, cupom, `PIX`, UTMs (`utm_source`, `utm_medium`, `utm_campaign`,
    `utm_term`, `utm_content`, até 100 caracteres cada) e `idempotencyKey`;
  - **comprador:** nome, e-mail, CPF ou CNPJ válido e celular com DDD, todos obrigatórios;
  - **em transação:** fotografa os valores e cria a tentativa `CREATING` com o `txid`;
  - **fora da transação:** chama `pixCreateImmediateCharge` com expiração de 1.800 s, devedor,
    valor, chave da Cifra+ e a descrição decidida, e depois busca o QR Code.
- Respostas da Efí:
  - **sucesso:** `ACTIVE`, com o copia e cola e a imagem;
  - **recusa comprovada** (4xx de validação): `FAILED` e pedido `FAILED`, com mensagem simples;
  - **timeout ou 5xx:** `UNCERTAIN`; a página mostra "Gerando seu Pix…" e consulta de novo.
- `GET /checkout/public/orders/:token`:
  - devolve estado, totais, itens (nome e valor), Pix e expiração;
  - quando pago, inclui a URL de acesso do principal (se a entrega tiver link) e as instruções.
- **Worker** (`@Cron` a cada minuto, com trava para duas instâncias):
  - concilia `UNCERTAIN` por `pixDetailCharge`: existe e `ATIVA` → `ACTIVE`; `CONCLUIDA` → confirma
    como na tarefa 6; não existe depois de 10 minutos → `FAILED`;
  - expira pedidos `PENDING` 10 minutos depois do `expiresAt`.
- **Testes:**
  - mesma chave idempotente devolve o mesmo pedido;
  - timeout vira `UNCERTAIN` sem segundo Pix;
  - recusa vira `FAILED`;
  - fotografia imutável depois de mudar preço ou termos;
  - token de outro pedido responde 404;
  - URL de acesso só depois de pago.

### Tarefa 6: Confirmação do pagamento

- **Desvio no webhook:** em `EfiService.handlePixWebhook`, eventos com `txid` iniciado por `ckt`
  vão para `CheckoutPaymentsService.handlePixEvent`, antes da busca de cobrança. Os demais seguem
  como hoje.
- **Conferências** (cada falha vira `PaymentWebhookAnomaly`, sem dar baixa):
  - a chave do evento é a chave da identidade que emitiu;
  - o valor é o da tentativa.
- **Baixa:** numa transação, a tentativa e o pedido viram `PAID` (só a partir de `ACTIVE`,
  `UNCERTAIN` ou `EXPIRED`), gravando `endToEndId` e a tarifa real, somando 1 ao `usedCount` do
  cupom e enfileirando o e-mail.
- Devoluções (`devolucoes`) ainda não são tratadas: viram a anomalia `CHECKOUT_REFUND_PENDING`
  para o admin ver, até a Parte 3.
- **Testes:**
  - webhook repetido, uma baixa só;
  - chave diferente vira anomalia;
  - valor diferente vira anomalia;
  - `txid` de cobrança segue o caminho antigo (testes atuais do webhook intactos);
  - pagamento depois de expirado ainda dá baixa.

### Tarefa 7: E-mail de acesso ao comprador

- Fila BullMQ `checkout-mail`, idempotente por `accessEmailSentAt`, com 5 tentativas e intervalo
  crescente.
- Enviado pelo Resend central, com remetente Cifra+:
  - **assunto:** "Seu acesso a <produto>";
  - **corpo:** cada item com link (entrega por link) ou instruções (entrega por webhook), o
    suporte do vendedor e a frase "Pagamento processado pela Cifra+".
- **Testes:**
  - reenvio da fila não manda duas vezes;
  - item só por webhook não leva link;
  - falha do provedor fica registrada e tenta de novo.

### Tarefa 8: Admin → Conta Efí da Cifra+ (frontend)

- Seção em Admin → Checkout com:
  - estado da conta;
  - formulário de credenciais com `.p12`;
  - botão "Validar e ligar webhook", com a confirmação para sobrescrever um webhook existente;
  - tarifa do Pix em %, com histórico.
- **Testes:** confirmação do webhook ocupado, 409 recarrega, nenhum segredo exibido depois de
  salvo.

### Tarefa 9: Página de pagamento (frontend)

- **`/c/[slug]`**, no celular primeiro:
  - banner, logo, produto com "De / Por" e período, cupom e dados do comprador;
  - bumps com destaque, total vindo da cotação (atualizado a cada mudança, descartando a resposta
    antiga) e botão "Gerar Pix";
  - WhatsApp flutuante, "Pagamento processado pela Cifra+" e link para `/privacidade-checkout`;
  - as UTMs da URL vão no pedido.
- **`/c/pedido/[token]`:**
  - QR Code, copia e cola com botão e contagem de 30 minutos;
  - consulta o estado a cada 3 s, e mais devagar depois de 5 minutos;
  - **quando pago:** "Pagamento confirmado", as instruções e o redirecionamento em 3 s para o link
    do principal (se houver);
  - **quando expirado:** "Gerar novo Pix", que volta à página com os dados preenchidos;
  - **quando incerto:** "Gerando seu Pix…".
- **`/privacidade-checkout`:** texto do aviso. É um rascunho, sem revisão jurídica, e diz:
  - quem trata os dados (Cifra+ e o vendedor);
  - para quê (pagamento, entrega e contato sobre compra não concluída);
  - a guarda de 12 meses dos dados de quem não concluiu;
  - os direitos do titular, pelo WhatsApp comercial.
- **Middleware:** `/c/...` e `/privacidade-checkout` ficam públicos, sem sessão.
- **Testes:**
  - total vem do backend;
  - UTMs enviadas;
  - estados pago, expirado e incerto;
  - redirecionamento só quando pago e com link;
  - CPF e celular inválidos barrados no formulário.

### Tarefa 10: Fluxo em banco descartável e documentação

- `test/checkout-pix.e2e-spec.ts` (Efí simulada pela troca do `EfiCheckoutPixClient` no módulo):
  - admin cadastra a conta e a tarifa;
  - comprador cota com bump e cupom e cria o pedido;
  - webhook confirma (e o repetido não muda nada);
  - e-mail enfileirado;
  - consulta pública mostra o acesso;
  - pedido de outra empresa isolado.
- **Atualizar:**
  - `AGENTS.md`: estado atual, rotas públicas, webhook e comando de teste;
  - spec: Parte 2 entregue;
  - o runbook novo `docs/operations/checkout-conta-cifra.md`: como cadastrar e validar a conta
    Cifra+, conferir o webhook e testar um Pix em homologação.

## Checks antes de declarar pronto

```bash
cd api-cobranca && npm run build && npm test -- --runInBand && npx eslint "src/**/*.ts" "test/**/*.ts" && npm run test:e2e:checkout && npm run test:e2e:checkout-pix
cd front-cobranca && npm run build && npm run lint && npx jest --runInBand
```

Também, se o responsável pedir: abrir `/c/<slug>` no navegador com a API apontando para
homologação e pagar um Pix de teste.

## Fora desta parte

- Saldo e repasse (Parte 3).
- Webhook ao vendedor e eventos (Parte 4).
- Lista de recuperação e lead (Parte 5).
- Cartão (Parte 6).
- Upsell (Parte 7).
- Reembolso (Partes 3 e 8).

## Publicação (quando pedida)

1. **Backend e migration** antes do frontend. O backend novo com o frontend antigo só acrescenta
   rotas.
2. **Conta Cifra+:** cadastrar e validar no admin em produção.
3. **Teste em homologação:** um Pix de ponta a ponta antes de divulgar qualquer link.
4. **Nginx:** o webhook Pix da chave da Cifra+ usa a rota mTLS que já existe
   (`/webhooks/efi/pix`), sem mudança.

## Registro de execução (04/11/2026, branch `feat/cifra-checkout-parte-2`)

As tarefas 1 a 10 foram executadas. O branch parte de `fix/checkout-rotas-frontend` (o
pré-requisito), então o PR leva também essa correção enquanto ela não estiver no `main`.

**Desvios do plano:**
- **Criação do Pix:** usa `pixCreateCharge` (`PUT /v2/cob/:txid`), não `pixCreateImmediateCharge`.
  O imediato é `POST /v2/cob`, em que a Efí escolhe o `txid`, e o desvio do webhook depende do
  prefixo `ckt` definido pelo sistema.
- **Desvio do webhook:** feito no `WebhooksService`, e não no `EfiService`. Ele separa os eventos
  `ckt…` antes de chamar o `EfiService`, sem dependência circular entre `PaymentModule` e
  `CheckoutModule`.
- **Anomalias:** gravadas com `source = 'PIX'` e o motivo prefixado (`CHECKOUT_RECEIVER_MISMATCH`,
  `CHECKOUT_AMOUNT_MISMATCH`, `CHECKOUT_UNKNOWN_TXID`, `CHECKOUT_REFUND_PENDING`). A tabela tem
  uma regra que só aceita `PIX`, `CHARGES` ou `CARD`. O teste em banco descartável pegou isso: a
  gravação falhava em silêncio.
- **Conta Cifra+:** o banco já tinha a regra de uma identidade `PLATFORM` por ambiente. Uma
  segunda conta no mesmo ambiente responde `PLATFORM_ACCOUNT_EXISTS`, e a conta com a credencial
  enviada por último é a mostrada e validada.
- **Expiração:** antes de expirar um pedido, o worker consulta a Efí. Se o Pix estiver pago (webhook
  perdido), confirma em vez de expirar.
- **Pagamento como fato:** a confirmação vale a partir de qualquer estado não pago da tentativa,
  inclusive `FAILED` ou `EXPIRED`, porque o aviso já passou pelo mTLS, pela chave e pelo valor.
- **Redirecionamento no frontend:** saiu para `openAccess()` em `src/lib/checkout-public.ts`, para
  ser testável.

**Checks executados:**
- **Backend:**
  - `npm test -- --runInBand`: 151 suítes e 1.261 testes, todos verdes;
  - `npm run build`;
  - `npx eslint` nos arquivos tocados;
  - `npm run test:e2e:checkout` (6 testes, Parte 1) e `npm run test:e2e:checkout-pix` (6 testes);
  - a migration aplicada do zero num PostgreSQL descartável, sem diferença no
    `prisma migrate diff`.
- **Frontend:** `npx jest --runInBand` (74 suítes, 469 testes), `npm run lint` (só o aviso conhecido
  do `useReactTable`) e `npm run build`.
- **Não executado:** um Pix real em homologação. Ele depende das credenciais da Cifra+ e fica como
  passo de publicação no runbook.
