# Cifra+ Checkout, Parte 1: base do cliente de checkout (plano)

> **Para execução por agente:** executar por tarefa, na ordem, com o teste antes da implementação
> e um commit por tarefa (só com pedido do responsável). Testes de banco só em infraestrutura
> descartável. Esta parte não emite cobrança, não move dinheiro e não chama a Efí.

**Objetivo:** o admin cria um cliente de checkout com a % Cifra+ e os dados de repasse. O vendedor
entra, vê só o menu do checkout e monta produtos, order bumps, cupons e a aparência da página. A
venda começa na Parte 2.

**Especificação:** [Cifra+ Checkout](../specs/2026-10-30-cifra-checkout-design.md), itens CK-01 a
CK-06.

**Arquitetura:**
- módulo novo `api-cobranca/src/checkout/`, com tabelas próprias;
- a empresa ganha `product` (`BILLING` ou `CHECKOUT`);
- o `JwtAuthGuard` passa a recusar com 404 a rota de outro produto;
- no frontend, as telas ficam em `/checkout/...` e `/admin/checkout`.

## Restrições globais

- **Isolamento:** `companyId` sempre do JWT. Um ID de outra empresa responde 404.
- **Produto da empresa:** uma empresa `CHECKOUT` não acessa rota de cobrança, e uma `BILLING` não
  acessa rota de checkout. As duas respondem 404. O `PLATFORM_ADMIN` segue como hoje.
- **Nada muda para as empresas atuais:** todas nascem `BILLING` pela migration, e o comportamento
  delas não muda.
- **Edição concorrente:** termos, configurações, produtos e cupons têm `version`. Uma versão
  esperada diferente responde `409 VERSION_CHANGED`.
- **Termos do vendedor imutáveis:** cada alteração da % Cifra+ ou dos dados de repasse grava uma
  versão nova, com auditoria. Nenhuma linha é editada.
- **Valores em centavos e percentuais em pontos-base.**
- **Logs:** sem CPF/CNPJ, chave Pix, e-mail ou telefone.
- **Migration aditiva.**

## Decisões técnicas desta parte (tomadas no plano; revisar se discordar)

1. **Imagens** (logo, banner, imagem de produto):
   - ficam no banco (`CheckoutAsset`, `bytea`), servidas por rota pública com cache longo;
   - aceitam só PNG, JPEG e WebP, conferidos pelos primeiros bytes do arquivo;
   - SVG é recusado, porque pode carregar script;
   - limite de 1 MB por arquivo.

   Motivo: a API roda numa VPS sem armazenamento de objetos, e o volume é pequeno.
2. **Preço mínimo de produto e de bump: R$ 5,00**, o mesmo piso do cupom na spec.
3. **Link do produto:**
   - o `slug` é gerado do nome com um sufixo aleatório (`porquim-anual-7k2m`) e **não muda** depois
     de criado, para não quebrar links divulgados;
   - um produto inativo mantém o slug.
4. **Bump com título e texto próprios (opcionais):**
   - exemplos: "GUIA DA RENDA FIXA COM 60% OFF" e "Pare de deixar seu dinheiro parado";
   - sem eles, a página usa o nome e a descrição do produto oferecido, como na referência da Hubla.
5. **Cartão** fica desligado nas configurações. Ligar responde `CARD_NOT_AVAILABLE` até a Parte 6.
6. **Webhook** (URL e segredo) entra na Parte 4. Na Parte 1, o produto já guarda a escolha de
   entrega (link, webhook ou os dois), e a URL de acesso só é obrigatória quando há link.
7. **Admin → Clientes** passa a listar só empresas `BILLING`. As de checkout ficam em
   Admin → Checkout.

## Mapa de arquivos

**Backend** (`api-cobranca/`):

| Arquivo | Responsabilidade |
| --- | --- |
| `prisma/schema.prisma` e `prisma/migrations/<data>_checkout_base/` | Enum `CompanyProduct`, `Company.product` e as tabelas do checkout |
| `src/auth/strategies/jwt.strategy.ts`, `src/auth/auth.types.ts` | `companyProduct` no usuário autenticado |
| `src/auth/decorators/company-products.decorator.ts` | `@CompanyProducts(...)` |
| `src/auth/guards/jwt-auth.guard.ts` | 404 quando o produto da empresa não é o da rota |
| `src/auth/auth.controller.ts` | Rotas de sessão valem para os dois produtos; a sessão devolve `companyProduct` |
| `src/admin/admin.service.ts` | Lista só `BILLING` |
| `src/checkout/checkout.module.ts` | Registro do módulo |
| `src/checkout/checkout-admin.service.ts`, `checkout-admin.controller.ts` | Criar cliente de checkout, listar, versões dos termos |
| `src/checkout/checkout-settings.service.ts` | Configurações da página |
| `src/checkout/checkout-assets.service.ts` | Upload, validação e leitura pública de imagens |
| `src/checkout/checkout-products.service.ts` | Produtos e bumps |
| `src/checkout/checkout-coupons.service.ts` | Cupons |
| `src/checkout/checkout.controller.ts` | Rotas do vendedor |
| `src/checkout/checkout-public.controller.ts` | `GET /checkout/public/assets/:id` |
| `src/checkout/checkout-rules.ts` | Regras puras: preço mínimo, slug, cupom, cor, telefone |
| `src/checkout/dto/*.ts` | DTOs |
| `test/checkout-base.e2e-spec.ts` | Fluxo em banco descartável (`npm run test:e2e:checkout`) |

**Frontend** (`front-cobranca/`):

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/auth.ts`, `src/lib/auth-session.ts` | `companyProduct` na sessão (ausente = `BILLING`) |
| `src/components/ui/Sidebar.tsx` | Menu do checkout para empresas `CHECKOUT`; item "Checkout" no admin |
| `src/app/(dashboard)/layout.tsx` | Sem ativação financeira e sem o banner dela para `CHECKOUT` |
| `src/app/(dashboard)/page.tsx` | Leva o usuário de checkout para `/checkout/produtos` |
| `src/app/(dashboard)/admin/checkout/page.tsx` | Lista, novo cliente de checkout, edição dos termos |
| `src/app/(dashboard)/checkout/produtos/page.tsx` e `[id]/page.tsx` | Produtos e, dentro do produto, os bumps |
| `src/app/(dashboard)/checkout/cupons/page.tsx` | Cupons |
| `src/app/(dashboard)/checkout/configuracoes/page.tsx` | Aparência, formas de pagamento e taxas |
| `src/components/features/checkout/*` | Formulários e o envio de imagem |

## Modelo de dados

```prisma
enum CompanyProduct { BILLING CHECKOUT }
enum CheckoutFeePayer { BUYER SELLER }
enum CheckoutDeliveryMode { ACCESS_LINK WEBHOOK BOTH }
enum CheckoutCouponType { PERCENT FIXED }
enum CheckoutAssetKind { LOGO BANNER PRODUCT_IMAGE }

// Company: product CompanyProduct @default(BILLING)

model CheckoutSellerTerms {          // uma linha por versão; nunca editada
  id, companyId, version Int, platformFeeBasisPoints Int,
  payoutDocument String, payoutPixKey String, changedByUserId, createdAt
  @@unique([companyId, version])
}

model CheckoutSettings {             // uma por empresa
  companyId @unique, version Int, displayName, logoAssetId?, bannerAssetId?,
  primaryColor String,               // #RRGGBB
  supportEmail?, supportWhatsapp?, whatsappButtonPhone?,
  pixEnabled Boolean @default(true), cardEnabled Boolean @default(false),
  maxInstallments Int @default(12),
  pixFeePayer CheckoutFeePayer @default(SELLER), cardFeePayer CheckoutFeePayer @default(BUYER),
  updatedAt
}

model CheckoutAsset {
  id, companyId, kind, contentType, sizeBytes Int, sha256, data Bytes, createdAt
}

model CheckoutProduct {
  id, companyId, name, description?, priceCents Int, compareAtPriceCents Int?,
  imageAssetId?, accessPeriodMonths Int?, deliveryMode, accessUrl?, accessInstructions?,
  slug String @unique, active Boolean @default(true), version Int, createdAt, updatedAt
  @@index([companyId, active])
}

model CheckoutOrderBump {
  id, companyId, productId, offeredProductId, priceCents Int, compareAtPriceCents Int?,
  headline?, description?, position Int, active Boolean @default(true), version Int
  @@unique([productId, offeredProductId])
}

model CheckoutCoupon {
  id, companyId, code String, type, value Int,   // pontos-base (PERCENT) ou centavos (FIXED)
  appliesToAllProducts Boolean, startsAt?, expiresAt?, maxUses Int?,
  usedCount Int @default(0), active Boolean @default(true), version Int, createdAt, updatedAt
  products CheckoutCouponProduct[]
  @@unique([companyId, code])
}

model CheckoutCouponProduct { couponId, productId  @@id([couponId, productId]) }
```

As relações usam `companyId` composto quando ligam registros da mesma empresa (produto e imagem,
bump e produto, cupom e produto), seguindo o padrão de `PaymentCharge`, para o banco também impedir
a mistura entre empresas.

## Tarefas

### Tarefa 1: Schema e migration

- Enums, `Company.product` e as tabelas acima, numa migration aditiva
  `<data>_checkout_base`. Todas as empresas existentes ficam `BILLING`.
- **Teste:** `prisma migrate deploy` em banco descartável a partir do schema atual; as empresas
  existentes continuam `BILLING`.
- **Commit:** `feat: checkout base schema`.

### Tarefa 2: Produto da empresa na sessão e nas rotas (CK-01)

- `JwtStrategy` lê `company.product` junto com o usuário (mesma consulta) e devolve
  `companyProduct`.
- `@CompanyProducts('CHECKOUT')` marca as rotas do checkout. Sem o decorator, a rota é `BILLING`.
  As rotas `change-password`, `logout` e `session` valem para os dois.
- `JwtAuthGuard`: para `COMPANY_ADMIN`, se o produto da empresa não estiver entre os da rota,
  responde 404 (`NotFoundException`). O `PLATFORM_ADMIN` não é afetado.
- `POST /auth/session` devolve `companyProduct`.
- **Testes:**
  - o guard deixa `BILLING` em rota sem decorator;
  - recusa `CHECKOUT` em rota sem decorator (404);
  - recusa `BILLING` em rota do checkout (404);
  - deixa os dois nas rotas de sessão;
  - não muda nada para `PLATFORM_ADMIN`;
  - o spec atual do `JwtStrategy` ganha o campo.
- **Commit:** `feat: refuse routes of the other company product`.

### Tarefa 3: Admin, novo cliente de checkout e termos (CK-02)

- Rotas `admin/checkout/clients` (`JwtAuthGuard` + `PlatformAdminGuard`):
  - `GET` lista (nome, documento, status, % Cifra+ atual, quantidade de produtos ativos);
  - `POST` cria a empresa `CHECKOUT` e o usuário com senha temporária, como o `createClient` de
    hoje, e grava as configurações padrão (nome exibido = nome da empresa) e a versão 1 dos termos,
    tudo numa transação;
  - `GET :companyId` mostra o detalhe com o histórico de versões dos termos;
  - `PUT :companyId/terms` grava uma nova versão, com `expectedVersion` e auditoria.
- Validações:
  - % Cifra+ entre 0 e 100% (0 a 10.000 pontos-base);
  - CPF/CNPJ válido (`debtor-document.ts`);
  - chave Pix normalizada (`normalizePixKey` dos pagamentos a colaboradores);
  - e-mail de usuário, documento ou e-mail da empresa já existentes → 409 (protege também contra
    o duplo clique no cadastro).
- `listClients` do admin de cobrança filtra `product = BILLING`.
- **Testes:**
  - criação em transação (falhou no meio, nada fica gravado);
  - versão nova a cada alteração, sem editar a anterior;
  - 409 com versão velha;
  - CPF/CNPJ e chave inválidos;
  - a lista de cobrança não mostra a empresa de checkout;
  - a auditoria não guarda documento nem chave completos.
- **Commit:** `feat: admin creates checkout clients`.

### Tarefa 4: Configurações e imagens do vendedor (CK-03)

- Rotas do vendedor:
  - `GET` e `PUT /checkout/settings`, com `expectedVersion`;
  - `POST /checkout/assets`, multipart com `kind`.
- Rota pública: `GET /checkout/public/assets/:id`, com o tipo gravado, `Cache-Control` longo e
  `X-Content-Type-Options: nosniff`.
- Validações:
  - cor no formato `#RRGGBB`;
  - telefones com DDD (10 ou 11 dígitos);
  - `maxInstallments` de 1 a 12;
  - pelo menos uma forma de pagamento ligada;
  - `cardEnabled = true` → `CARD_NOT_AVAILABLE`;
  - logo e banner precisam ser imagens da própria empresa, do tipo certo.
- Imagem: limite de 1 MB, tipo pelos primeiros bytes (PNG, JPEG, WebP) e `sha256`.
- **Testes:**
  - empresa A não usa imagem da B (404);
  - SVG e arquivo renomeado são recusados;
  - arquivo acima do limite é recusado;
  - 409 com versão velha;
  - cartão recusado;
  - a rota pública devolve os bytes com o tipo certo.
- **Commit:** `feat: checkout page settings and images`.

### Tarefa 5: Produtos e order bumps (CK-04, CK-05)

- Rotas `/checkout/products`:
  - listar com filtro ativo/inativo;
  - criar;
  - detalhar;
  - `PUT` com `expectedVersion`;
  - `PATCH :id/active`.
- Rotas `/checkout/products/:id/bumps`: listar, criar, `PUT` com versão, remover e reordenar.
- Regras:
  - preço ≥ R$ 5,00;
  - "De" maior que o preço;
  - período de acesso de 1 a 120 meses;
  - `accessUrl` `https` obrigatória quando a entrega inclui link;
  - slug gerado e fixo.
- Regras do bump:
  - no máximo 6 ativos por produto;
  - o produto oferecido é outro produto da mesma empresa;
  - preço ≥ R$ 5,00 e "De" maior que o preço;
  - não repete o mesmo produto oferecido.
- Desativar um produto não apaga os bumps, mas um produto inativo não aparece como bump na página
  (a regra vale na Parte 2).
- **Testes:**
  - isolamento A/B em produto e bump (404);
  - sétimo bump recusado;
  - bump de si mesmo e bump de produto de outra empresa recusados;
  - preço abaixo do mínimo;
  - URL sem `https`;
  - slug único e fixo depois de editar o nome;
  - 409 com versão velha.
- **Commit:** `feat: checkout products and order bumps`.

### Tarefa 6: Cupons (CK-06)

- Rotas `/checkout/coupons`: listar, criar, `PUT` com versão e `PATCH :id/active`.
- Regras:
  - código com 3 a 30 letras, números, `-` e `_`, guardado em maiúsculas e único por empresa;
  - percentual de 1% a 100%, ou valor fixo > 0;
  - produtos da própria empresa, ou todos;
  - `expiresAt` depois de `startsAt`;
  - `maxUses` ≥ 1.
- `checkout-rules.ts` já traz a função pura `couponDiscountCents(priceCents, coupon)`, com o piso de
  R$ 5,00, para a Parte 2 usar.
- **Testes:**
  - código duplicado na mesma empresa (409) e liberado em outra;
  - produto de outra empresa recusado;
  - cálculo do desconto em % e fixo respeitando o piso;
  - isolamento A/B.
- **Commit:** `feat: checkout coupons`.

### Tarefa 7: Frontend, sessão, menu e entrada

- `companyProduct` na sessão do NextAuth, vindo do login e de `/auth/session`. Se estiver ausente,
  vale `BILLING`.
- Para uma empresa `CHECKOUT`:
  - **Sidebar:** só Produtos, Cupons e Configurações do checkout;
  - **layout:** sem o `FinancialActivationProvider` e sem o banner dele;
  - **`/`:** leva a `/checkout/produtos`.
- Para o `PLATFORM_ADMIN`: o item "Checkout" no grupo do admin.
- **Testes** (Jest e Testing Library):
  - o menu muda pelo produto;
  - a sessão antiga sem o campo continua `BILLING`.
- **Commit:** `feat: checkout menu for checkout companies`.

### Tarefa 8: Frontend, Admin → Checkout

- Lista de clientes de checkout, formulário "Novo cliente de checkout" (empresa, usuário, % Cifra+,
  CPF/CNPJ e chave Pix de repasse) com a senha temporária mostrada uma vez, e edição dos termos com
  o histórico de versões.
- Um 409 recarrega os termos e avisa que outra pessoa alterou.
- Estados de carregando, erro e vazio distintos.
- **Testes:** criação, 409 recarrega e falha não vira "lista vazia".
- **Commit:** `feat: admin checkout clients screen`.

### Tarefa 9: Frontend, telas do vendedor

- **Produtos:**
  - lista com ativo/inativo e o link `/c/<slug>`, com botão de copiar. O link só abre na Parte 2, e
    a tela avisa isso;
  - formulário com preço e "De" em reais, período de acesso, entrega e imagem.
- **Produto → Order bumps:** até 6, com escolha do produto oferecido, preço, "De", título, texto,
  ativo e ordem.
- **Cupons:** lista e formulário.
- **Configurações do checkout:** aparência (logo, banner, cor), nome e suporte, botão de WhatsApp,
  formas de pagamento (cartão desabilitado com "disponível em breve"), parcelas e quem paga a taxa
  no Pix e no cartão.
- Em todas as telas: um 409 recarrega, as requisições antigas são descartadas, e os estados de
  carregando, erro e vazio são distintos.
- **Testes:**
  - validação do preço mínimo no formulário;
  - limite de 6 bumps;
  - cartão desabilitado;
  - 409 recarrega.
- **Commit:** `feat: checkout seller screens`.

### Tarefa 10: Fluxo em banco descartável e documentação

- `test/checkout-base.e2e-spec.ts` e o script `test:e2e:checkout`:
  - o admin cria o cliente;
  - o vendedor troca a senha e configura;
  - cria um produto, um bump e um cupom;
  - uma empresa `BILLING` recebe 404 nas rotas do checkout, e a de checkout recebe 404 em
    `/invoices`;
  - outra empresa de checkout não vê nada da primeira.
- Atualizar:
  - `AGENTS.md`: estado atual, módulo `checkout/` na tabela e o comando de teste;
  - a spec, com "Parte 1 entregue" e os desvios, se houver.
- **Commit:** `test: checkout base flow` e `docs: checkout part 1`.

## Checks antes de declarar pronto

```bash
cd api-cobranca && npm run build && npm test -- --runInBand && npx eslint "src/**/*.ts" "test/**/*.ts" && npm run test:e2e:checkout
cd front-cobranca && npm run build && npm run lint && npx jest --runInBand
```

## Fora desta parte

- Página pública e venda (Parte 2).
- Saldo (Parte 3).
- Webhook ao vendedor (Parte 4).
- Recuperação (Parte 5).
- Cartão (Parte 6).
- Upsell (Parte 7).
- Reembolso avançado (Parte 8).
- Integrações (Parte 9).

Nenhum job, worker ou fila nova.

## Publicação (quando pedida)

- **Ordem:** migration e backend antes do frontend.
- **Backend novo com frontend antigo:** funciona. Todas as empresas são `BILLING`, e o frontend
  antigo não conhece o checkout.
- **Primeiro cliente de checkout:** só é criado depois de o frontend novo estar publicado.

## Registro de execução (03/11/2026, branch `feat/cifra-checkout-parte-1`)

As tarefas 1 a 10 foram executadas. Nada foi commitado nem publicado.

**Desvios do plano:**
- **Tarefa 7:** o layout não mudou. A ativação financeira (provider e banner) é que ignora
  empresas `CHECKOUT`. O efeito é o mesmo, com um diff menor.
- **Tarefa 5:** um produto entregue só por webhook exige instruções de acesso, porque sem elas o
  comprador não saberia como receber o produto.
- **Tarefa 6:** o teste em banco descartável mostrou que criar o cupom com os produtos aninhados
  falha no PostgreSQL, por causa da relação composta com `companyId`. O cupom e os vínculos agora
  são gravados numa transação.

**Checks executados:**
- **Backend:** `npm test -- --runInBand` (145 suítes e 1.211 testes, todos verdes, incluindo
  os 44 do `checkout/`), `npm run build`, `npx eslint` nos arquivos tocados e
  `npm run test:e2e:checkout` (6 testes).
- **Migration:** aplicada do zero num PostgreSQL descartável, com uma empresa criada antes dela.
  Essa empresa ficou `BILLING`, e o `prisma migrate diff` não mostrou diferença em relação ao
  schema.
- **Frontend:** `npx jest --runInBand` (72 suítes, 454 testes), `npm run lint` (só o aviso
  conhecido do `useReactTable`) e `npm run build`.

**Correção depois do merge (04/11/2026):**
- **Problema:** o `middleware.ts` do frontend não conhecia as rotas novas. O admin era levado de
  Admin → Checkout para Admin → Clientes, e o vendedor ia para Cobranças depois do primeiro acesso.
- **Correção:** `/admin/checkout` entrou na lista do admin. A empresa de checkout fica sempre em
  `/checkout/...` (a entrada é `/checkout/produtos`), e a de cobrança é levada para `/` se abrir
  `/checkout/...`. Os testes de rota cobrem os dois casos.
