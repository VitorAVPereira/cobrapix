# AGENTS.md

Guia para agentes que trabalham no CifraMais (repositório `cobrapix`). Leia inteiro antes
da primeira alteração. Contexto de negócio detalhado:
[`docs/superpowers/specs/2026-09-24-contexto-sistema-ativacao-financeira.md`](docs/superpowers/specs/2026-09-24-contexto-sistema-ativacao-financeira.md)
e o retrato mais recente em
[`docs/superpowers/specs/2026-09-29-correcoes-testes-producao-design.md`](docs/superpowers/specs/2026-09-29-correcoes-testes-producao-design.md).

---

## 1. Como trabalhar neste projeto

### 1.1 Entenda antes de codar

- Reescreva o pedido em uma frase e defina o critério de pronto antes de abrir arquivos.
- Leia o código que será afetado e seus testes. Não suponha: confira no código, no schema
  ou no git. Se algo não pode ser conferido, diga que é hipótese.
- Pergunte só quando a decisão é do responsável pelo produto (regra de negócio, dinheiro,
  permissão, texto para cliente) e não há padrão no código. Para detalhes técnicos com
  convenção clara, decida, siga e mencione.

### 1.2 Simplicidade primeiro

O mínimo de código que resolve o problema. Nada especulativo.

- Nenhuma funcionalidade além do que foi pedido.
- Nenhuma abstração para código de uso único.
- Nenhuma "flexibilidade" ou "configurabilidade" que não foi pedida.
- Nenhum tratamento de erro para cenários impossíveis. Trate os possíveis: rede, provedor,
  concorrência e dados antigos são possíveis aqui.
- Se você escreveu 200 linhas e dava para fazer em 50, reescreva.
- Reutilize o que já existe (serviço, helper, DTO, componente) antes de criar outro.

Pergunte-se: "um engenheiro sênior diria que isso está complicado demais?" Se sim, simplifique.

### 1.3 Mudanças cirúrgicas

- Toque só no que o pedido exige. Não reformate arquivos inteiros, não renomeie o que
  funciona, não "melhore" código vizinho sem motivo ligado ao pedido.
- Mantenha o estilo do arquivo: nomes, densidade de comentários, padrões de erro.
- Não atualize dependências, não troque bibliotecas e não mexa em CI/infra sem pedido.
- Um diff pequeno e explicável vale mais que um diff "completo".

### 1.4 Foco e quando intervir

Não perca o foco do pedido. Ao encontrar algo fora dele, classifique:

| Situação | O que fazer |
| --- | --- |
| Faz parte do pedido | Faça. |
| Pequeno e **necessário** para o pedido funcionar corretamente (um teste quebrado pela mudança, um bug adjacente que invalida o resultado) | Faça e **avise** na seção "Alterações fora do pedido" do relato final. |
| Muda regra de negócio, dinheiro, permissões, schema/migration, contrato de API, comportamento visível ao cliente, ou é grande | **Pare e pergunte antes**, explicando o gap, o impacto e a proposta. |
| Só observado, não bloqueia o pedido | Não implemente. Registre como sugestão no fim do relato. |

Você deve procurar ativamente gaps de negócio e de desenvolvimento (checklist na seção 5).
Encontrar um gap e seguir calado é pior do que parar para avisar.

Formato do aviso:

```text
Gap encontrado: <o que está errado ou faltando, com arquivo:linha>
Impacto: <quem é afetado e como: empresa, pagador, admin, dinheiro, dados>
Proposta: <a menor correção segura>
Situação: não alterei / alterei em <arquivo> (motivo)
```

### 1.5 Verifique pelo objetivo

- Transforme o pedido em um teste que falha antes da correção e passa depois, quando
  for comportamento. Para correções de bug, reproduza primeiro.
- Rode os checks do que você tocou (seção 8). Não declare pronto sem rodar.
- Relate com honestidade: o que foi testado, o que não foi e por quê. Um teste que
  falhou aparece no relato com a saída.

### 1.6 Relato final (sempre)

1. O que foi feito, em linguagem de negócio.
2. Arquivos principais alterados.
3. Testes executados e resultado.
4. **Alterações fora do pedido** (ou "nenhuma").
5. Riscos, pendências e o que precisa de ação humana (deploy, configuração, Meta/Efí).

Commit, merge, deploy e "funcionando em produção" são coisas diferentes. Nunca afirme
que algo está publicado sem evidência. Não faça deploy, não rode nada na VPS e não crie
PR sem pedido explícito.

---

## 2. O que é o sistema

O CifraMais é uma plataforma de cobrança multiempresa. Cada empresa cadastra devedores e
faturas; o sistema emite a cobrança na Efí (Pix, boleto, BOLIX), envia avisos por WhatsApp
e e-mail, acompanha o pagamento e concilia a remuneração da plataforma.

| Público | Acesso |
| --- | --- |
| Administrador CifraMais (`PLATFORM_ADMIN`) | Empresas, ativação financeira manual, integrações, tarifas, catálogo de templates, atendimento central, conciliação |
| Usuário da empresa (`COMPANY_ADMIN`) | Seus devedores, faturas, régua, estatísticas e conversas atribuídas à própria empresa |
| Pagador | Só a página `/pagar/<token>` da cobrança, sem login; o link assinado vale 90 dias |

### 2.1 Vocabulário (não misture)

| Termo | Significado |
| --- | --- |
| Empresa / tenant | Cliente da plataforma. Todo dado de negócio pertence a um `companyId`. |
| Devedor / pagador | Quem paga. A mesma pessoa pode dever a várias empresas; telefone, e-mail ou CPF **não** identificam a empresa. |
| Fatura (`Invoice`) | Obrigação comercial: `DRAFT`, `PENDING`, `PAID`, `CANCELED`. |
| Cobrança (`PaymentCharge`) | Emissão financeira de uma fatura em uma conta Efí, com tarifas fotografadas. Substituir não apaga a anterior. |
| Ativação financeira | Torna a empresa apta a emitir. Diferente de criar login ou marcar a empresa como ativa. |
| Conta emissora | Conta Efí que emitiu a cobrança. Consulta, cancelamento e baixa usam sempre essa conta. |
| Split | Instrução de divisão do pagamento. Configurado ≠ recebido. |
| Conciliação | Comprovação, pelo admin, do que foi recebido (remuneração por split) e decisão das divergências. |
| Intenção de envio (`CommunicationOutboundIntent`) | Registro persistido antes de transmitir uma mensagem: `PENDING`, `SENDING`, `ACCEPTED`, `FAILED`, `UNCERTAIN`, `BLOCKED`. |
| Pendência de template | Mensagem retida pela política de templates; só volta com revisão e confirmação do admin. |

**Enfileirar, emitir, enviar, entregar e pagar são eventos diferentes.** Uma fatura
`PENDING`, uma cobrança `PENDING` e o estado na Efí não têm o mesmo significado. Uma
mensagem pode estar retida enquanto o pagamento existe; reenviar mensagem nunca cria
nova cobrança.

### 2.2 Estado atual (30/09/2026)

- **Financeiro, Fase A em uso:** conta Efí **do próprio cliente**, configurada pelo admin
  (credenciais, `.p12`, chave Pix). O pagamento cai na conta do cliente; a remuneração da
  CifraMais vem por split e é conciliada em Admin → Conciliação.
- **Fase B bloqueada:** modos com conta da CifraMais (`PLATFORM_ACCOUNT`, repasse por split
  invertido ou manual) existem em tipos e enums, mas são recusados na ativação e na emissão
  (`FINANCIAL_MODE_NOT_SUPPORTED`). Não habilite sem pedido.
- **Abertura de contas Efí desligada** (`EFI_OPENING_ENABLED=false`): a autoativação pela
  empresa não deve aparecer; a ativação é manual pelo admin.
- **WhatsApp:** canal central compartilhado, transporte **somente Datafy**. Templates são
  criados na Meta, importados, mapeados e liberados por empresa pelo admin (seção 4.3).
- **E-mail:** conta central Resend, com atribuição da mensagem à empresa.
- **Produção:** frontend na Vercel; API, PostgreSQL, Redis e Nginx na VPS InterServer,
  publicação manual (seção 9). Código no `main` não significa código publicado.
- **Em aberto:** planos de correção de 29/09 em `docs/superpowers/plans/2026-09-29-0*.md`
  (conciliação de BOLIX, página pública de pagamento, cota por empresa no canal central,
  interface). Confira no git o que já entrou antes de assumir.

---

## 3. Arquitetura e módulos

- `front-cobranca/`: Next.js 16 + React 19 (porta 3000). Sem acesso a banco; tudo pela API
  via `useApiClient()` / `src/lib/api-client.ts`.
- `api-cobranca/`: NestJS 11 (porta 3001), Prisma 7 com PostgreSQL, BullMQ/Redis. Node 24 na imagem.
- Prisma pertence **só** ao backend. Schema canônico: `api-cobranca/prisma/schema.prisma`.

| Módulo (`api-cobranca/src/`) | Responsabilidade |
| --- | --- |
| `auth/` | Login, JWT, guards (`JwtAuthGuard`, `@GetUser()`), primeiro acesso e recuperação de senha |
| `admin/` | Empresas, analytics da plataforma, `PlatformAdminGuard`, integrações centrais |
| `invoices/`, `billing/` | Faturas, devedores, régua de cobrança (`CollectionProfile`/`CollectionRuleStep`), envio da primeira cobrança |
| `payment/`, `payment-fees/` | Emissão Efí, cobranças, link público de pagamento, webhooks de pagamento, tarifas versionadas |
| `financial-activation/` | Ativação manual: perfil versionado, credenciais cifradas, validação em fila, elegibilidade, certificados |
| `settlements/` | Lançamentos imutáveis (`FinancialLedgerEntry`), conciliação e divergências |
| `efi-onboarding/` | Abertura de contas (desligada) e chaves de integração (`PlatformIntegrationState`) |
| `communications/` | Conversas, mensagens, intenções de envio, atribuição por empresa, pendências e retomada de templates |
| `whatsapp/` | Transporte Datafy e `OutboundDispatcherService` (ver `whatsapp/transport/README.md`) |
| `templates/` | Catálogo WhatsApp importado: sync, mapeamento, liberações/padrões, política e preparação do envio |
| `email/` | Templates de e-mail (`GlobalEmailTemplate`) e envio pelo Resend |
| `queue/` | Filas BullMQ e workers (mensagens, primeira cobrança, webhooks Datafy) |
| `webhooks/` | Entrada de Datafy, Efí e Resend |
| `health/`, `scripts/` | Saúde e scripts operacionais (seed de produção, rotação de chaves, transição de templates) |

---

## 4. Regras de negócio que não podem ser quebradas

### 4.1 Isolamento por empresa

- O `companyId` vem do JWT (`@GetUser() user`), nunca do corpo ou da query em rotas da
  empresa. ID de outra empresa responde **404**, não 403, para não confirmar existência.
- Rotas globais usam `JwtAuthGuard` + `PlatformAdminGuard`.
- Nada que uma empresa vê (métricas, conversas, templates, pendências) pode vazar dados
  de outra, inclusive por filtro, paginação ou mensagem de erro.

### 4.2 Dinheiro

- Uma cobrança fica presa à **conta emissora**; trocar credenciais ou conta não move
  cobranças antigas.
- Resultado incerto do provedor (`EFI_SUBMISSION_UNCERTAIN`) **nunca** é reenviado:
  preserva-se a reserva e concilia-se consultando a Efí pelo identificador gravado.
- Webhooks são autenticados, idempotentes e só dão baixa na cobrança da conta correta;
  o que não se aplica vira `PaymentWebhookAnomaly`.
- Lançamentos financeiros nunca são editados: correção entra como novo lançamento, com
  auditoria.
- Não marque cobrança como paga, não exclua reservas e não reemita só para limpar a tela.
- Pagamento confirmado ≠ split recebido ≠ repasse concluído.

### 4.3 WhatsApp e templates

- Datafy é o único transporte. Não existe integração direta com a Meta.
- Todo envio passa por `OutboundDispatcherService`, com intenção persistida antes da
  transmissão e chave idempotente. `UNCERTAIN` nunca é reenviado automaticamente.
- Empresa só vê e usa templates liberados a ela. Template novo nasce sem liberação.
- Sem template disponível, a mensagem fica **pendente**; nunca troque por outro
  automaticamente. Corrigir liberação ou mapeamento não retoma envio: só a confirmação
  do admin (prévia de 15 min, chave idempotente). `ACCEPTED`, `SENDING` e `UNCERTAIN`
  nunca são retomados.
- Formatos aceitos: BODY com variáveis `{{1}}` ou nomeadas (`{{nome_devedor}}`, conforme o
  `parameter_format`), FOOTER de texto, no máximo um botão URL apontando exatamente para
  `<FRONTEND_URL>/pagar/{{1}}`, no máximo um botão "Copiar código Pix" e um "Copiar código
  do boleto" (`PAYMENT_REQUEST` `pix_dynamic_code`/`boleto`, preenchidos com o Pix e a linha
  digitável da cobrança) e respostas rápidas estáticas. Cabeçalho/mídia e outros botões
  aparecem como não suportados; nunca "adapte" o texto aprovado.
- A primeira mensagem da cobrança (WhatsApp e e-mail) segue a etapa "Inicial" da régua do
  devedor e conta como envio dela; sem essa etapa, vale o padrão de Emissão. Etapas de
  WhatsApp podem ter um template por forma de pagamento (Pix, Boleto, BOLIX).
- Respeite opt-in, supressão do destinatário, janela de 24 h para texto livre e limites do
  canal. Admin responde no atendimento central; a empresa só visualiza.

### 4.4 E-mail, links e ativação

- Etapas EMAIL da régua usam `GlobalEmailTemplate` (`emailTemplateId`); WhatsApp usa a
  seleção de template (`whatsappSelection`). Não misture catálogos.
- O link público de pagamento autoriza ver **só aquela cobrança**; não cria sessão nem
  libera outra API. Cobrança encerrada mostra o status, sem instrumentos de pagamento.
- Ativação financeira é manual e auditada; alterar dados após a validação exige validar de novo.

### 4.5 Segredos e dados pessoais

Credenciais Efí, certificados, tokens Datafy/Resend e chaves de pagamento ficam cifrados
no banco ou no `api.env`. Nunca em respostas HTTP, logs, auditoria, fixtures, documentos
ou `localStorage`. Não registre corpo de mensagem nem telefone em log.

---

## 5. Checklist para encontrar gaps

Antes de dar uma tarefa por concluída, responda. Se alguma resposta for "não sei" ou
"quebra", avise (seção 1.4).

**Negócio**
- Quem é dono deste dado e como o código sabe? Outra empresa consegue ver ou alterar?
- Qual estado real está sendo mostrado: fatura, cobrança, Efí, intenção, entrega?
- O que acontece com os dados que já existem (faturas antigas, etapas legadas, cobranças em aberto)?
- O cliente final vê algo novo? O texto está em PT-BR, claro e sem jargão técnico?
- Há efeito em dinheiro, tarifa, split ou conciliação? Está auditado?

**Desenvolvimento**
- Se rodar duas vezes (retry, duplo clique, fila reentregue), o efeito se repete?
- Se a resposta do provedor se perder no meio, o sistema reenvia ou concilia?
- Dois admins editando ao mesmo tempo: há versão esperada / `409` em vez de sobrescrever?
- A ordem de publicação funciona? Backend novo com frontend antigo; migration aditiva.
- A mudança precisa de migration? Ela é aditiva e testada em banco descartável?
- Falha de rede/Redis/provedor deixa o sistema num estado recuperável e visível?
- Há teste cobrindo o caminho feliz **e** o caminho que protege o negócio?

---

## 6. Padrões de código

- Identificadores e comentários de código em inglês; textos de interface, mensagens de erro
  para usuário e documentação em português do Brasil.
- Comentários explicam o **porquê** (regra de negócio, risco), não o que a linha faz.
- DTOs com `class-validator`; o `ValidationPipe` global usa `whitelist` e
  `forbidNonWhitelisted`, então campo não declarado é recusado. IDs de rota com `ParseUUIDPipe`.
- Erros de negócio com código estável: `new ConflictException({ code: 'VERSION_CHANGED', message: '...' })`.
- Escritas concorrentes usam versão esperada e respondem `409`; o frontend recarrega em vez
  de sobrescrever.
- Frontend: `useApiClient()`, estados de carregando/erro/vazio distintos (falha não é
  "lista vazia"), requisições antigas descartadas (AbortController ou identidade da requisição).
- Migrations só aditivas, com nome descritivo; nunca edite migration já publicada.
- Commits pequenos, um passo lógico cada, prefixo convencional: `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`.

---

## 7. Exemplos

### 7.1 Simplicidade

Pedido: "mostrar o total pendente da empresa no dashboard".

```ts
// Ruim: estratégia, fábrica e cache configurável que ninguém pediu.
export class PendingTotalCalculatorFactory {
  create(kind: 'default' | 'cached', ttl = 60): PendingTotalStrategy { /* ... */ }
}

// Bom: uma consulta, no serviço que já monta o dashboard.
const { _sum } = await this.prisma.invoice.aggregate({
  where: { companyId, status: 'PENDING' },
  _sum: { originalAmount: true },
});
```

### 7.2 Isolamento por empresa

```ts
// Ruim: a empresa vem do cliente; qualquer usuário lê dados de outra empresa.
@Get(':id')
get(@Param('id') id: string, @Query('companyId') companyId: string) {
  return this.prisma.invoice.findUnique({ where: { id } });
}

// Bom: empresa do JWT; ID de outra empresa é simplesmente "não encontrado".
@Get(':id')
async get(@GetUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
  const invoice = await this.prisma.invoice.findFirst({ where: { id, companyId: user.companyId } });
  if (!invoice) throw new NotFoundException('Fatura não encontrada.');
  return invoice;
}
```

### 7.3 Resultado incerto do provedor

Padrão ilustrativo (nomes simplificados):

```ts
// Ruim: timeout pode significar "a Efí criou a cobrança"; repetir pode duplicar.
try {
  return await efi.createCharge(input);
} catch {
  return await efi.createCharge(input);
}

// Bom: preserva a reserva, marca incerto e concilia depois pelo identificador gravado.
try {
  return await efi.createCharge(input);
} catch (error) {
  if (isRejectedByProvider(error)) return this.markFailed(charge.id, error);
  await this.markUncertain(charge.id); // EFI_SUBMISSION_UNCERTAIN, sem nova emissão
  throw new ConflictException({ code: 'EFI_SUBMISSION_UNCERTAIN', message: '...' });
}
```

### 7.4 Mudança cirúrgica e aviso

Exemplo ilustrativo (não descreve um problema real do código). Pedido: "corrigir o texto
do botão de enviar template". Durante a tarefa você nota que uma listagem da empresa
filtra por status, mas não por `companyId`.

- Faça: trocar o texto e ajustar o teste do componente.
- Não faça: refatorar o componente, reformatar o arquivo, corrigir a listagem por conta própria.
- Avise no relato:

```text
Gap encontrado: a listagem X filtra só por status, sem companyId (<arquivo>:<linha>).
Impacto: uma empresa poderia ver registros de outra.
Proposta: incluir companyId do JWT no where e cobrir com teste de isolamento A/B.
Situação: não alterei; fora do pedido e envolve permissão. Posso corrigir em seguida?
```

---

## 8. Comandos e testes

```bash
# Frontend
cd front-cobranca
npm run dev              # porta 3000
npm run build
npm run lint
npx jest --runInBand     # não há script "test"

# Backend
cd api-cobranca
npm run dev              # porta 3001
npm run build
npm test -- --runInBand
npx eslint "src/**/*.ts" "test/**/*.ts"   # conferência sem --fix

# Integração em PostgreSQL/Redis descartáveis (exige Docker local)
npm run test:collection-rules:postgres
npm run test:communications:postgres
npm run test:template-email-migration:postgres
npm run test:template-catalog:postgres
npm run test:template-pending:postgres
npm run test:template-transition:postgres
node test/e2e-disposable.cjs <arquivo>.e2e-spec.ts [...]   # ex.: npm run test:e2e:templates
```

- Testes que escrevem em banco ou Redis usam **somente** a infraestrutura descartável dos
  runners. Nunca o `.env`, Neon compartilhado ou a VPS.
- Provedores (Datafy, Efí, Resend) são simulados nos testes; nenhum teste chama serviço real.
- Dívidas conhecidas, fora de escopo salvo pedido: `tsc` acusa erros de tipo em specs
  antigos (`admin.service.spec`, `billing.service.spec`, `invoices.service.spec`,
  `webhooks.controller.spec`); o lint do frontend avisa sobre `useReactTable`.

### Schema

```bash
cd api-cobranca
npm run prisma:migrate -- --name <nome_descritivo>   # só em desenvolvimento
npm run prisma:generate
```

Seed de desenvolvimento (`npx prisma db seed`): empresa "Empresa Teste MVP", login
`admin@cobrapix.com` / `senha123`. Em produção existe só `seed:production`.

---

## 9. Publicação (só com pedido explícito)

- Pacote no Windows: `infra/interserver/package.ps1`. Ele recusa gerar o pacote com
  alteração do backend fora de commit. Envio por `scp` para a VPS; conferir o SHA256.
- Na VPS: extrair em **pasta nova**, guardar a imagem atual com tag, `compose.sh build api`,
  `prisma migrate deploy` (nunca `migrate dev`, `db push`, reset ou `down -v`),
  `compose.sh up -d --no-deps --force-recreate api`, `nginx -t` e reload.
- Publique o backend antes do frontend (Vercel, a partir do `main`).
- Confira no container que o código novo está rodando antes de declarar concluído.
- Runbooks: `infra/interserver/README.md`, `infra/interserver/DATAFY.md`,
  `docs/operations/financial-activation.md`, `docs/operations/whatsapp-template-catalog.md`.

---

## 10. Onde está a documentação

| Caminho | Conteúdo |
| --- | --- |
| `docs/superpowers/specs/` | Especificações de produto e decisões (uma por demanda, com data) |
| `docs/superpowers/plans/` | Planos de implementação e registros de execução por etapa |
| `docs/operations/` | Runbooks de operação (ativação financeira, homologação, catálogo WhatsApp) |
| `api-cobranca/src/whatsapp/transport/README.md` | Transporte Datafy, estados das intenções, limites, templates |
| `infra/interserver/` | Infraestrutura da VPS, Compose, backup, HTTPS, Datafy |

Para demandas grandes, o fluxo é: spec em `specs/` → plano em `plans/` → execução por
etapas com commits e registro. Siga o plano; registre desvios e o motivo.

---

## 11. Referência rápida

### Variáveis de ambiente do backend

| Variável | Uso |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL` | PostgreSQL (local em desenvolvimento; VPS em produção) |
| `REDIS_HOST`, `REDIS_PORT` | Filas BullMQ |
| `FRONTEND_URL`, `ALLOWED_ORIGINS` | Links de pagamento (`<FRONTEND_URL>/pagar/...`) e CORS |
| `DATAFY_API_TOKEN` (`sk_live_`), `DATAFY_WEBHOOK_SECRET` (`whsec_`), `DATAFY_WEBHOOK_BASE_URL` | WhatsApp via Datafy (obrigatórias em produção) |
| `META_PHONE_NUMBER_ID`, `META_BUSINESS_ACCOUNT_ID` | IDs do número e da WABA, conferidos contra o `/me` do Datafy |
| `PAYMENT_ENCRYPTION_KEYS`, `PAYMENT_ACTIVE_KEY_VERSION` | Cifra de credenciais e certificados dos clientes |
| `EFI_PLATFORM_PAYEE_CODE`, `EFI_PLATFORM_ACCOUNT_NUMBER`, `EFI_PLATFORM_CNPJ` | Conta CifraMais que recebe a remuneração por split |
| `EFI_OPENING_ENABLED` | `false` enquanto a abertura de contas não for liberada |
| `EFI_WEBHOOK_BASE_URL`, `EFI_CHARGES_WEBHOOK_BASE_URL`, `EFI_WEBHOOK_SECRET` | Webhooks Pix (mTLS) e Cobranças |
| `PLATFORM_ALERT_EMAIL` | Alertas de vencimento de certificado |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | E-mail e webhook Resend |
| `COMMUNICATION_MEDIA_DIR`, `COMMUNICATION_MEDIA_LIMIT_BYTES` | Anexos cifrados do WhatsApp |

Descontinuadas: `EFI_ONBOARDING_NOTICE_TEMPLATE`, `EFI_ONBOARDING_REMINDER_TEMPLATE`
(avisos de ativação usam os padrões de template por empresa).

### API de pagamentos (`/payments`, JWT da empresa)

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/payments/create` | Cria cobrança Pix |
| POST | `/payments/create-batch` | Cobranças em lote |
| POST | `/payments/boleto` | Cria boleto |
| POST | `/payments/boleto-batch` | Boletos em lote |
| GET | `/payments/invoice/:id` | Consulta a cobrança da fatura |
| POST | `/payments/invoice/:id/status` | Atualiza status |
| POST | `/payments/invoice/:id/replace` | Substitui a cobrança, preservando a anterior |
| GET | `/payments/status` | Situação da configuração de pagamentos da empresa |

### Webhooks

| Rota | Origem |
| --- | --- |
| `POST /webhooks/datafy` | Mensagens, status e templates do WhatsApp (assinatura Datafy) |
| `POST /webhooks/efi/pix` | Pagamentos Pix (mTLS) |
| `POST /webhooks/efi/cobrancas` | Boleto/BOLIX; `account=` identifica a conta emissora |
| `POST /webhooks/resend` | Eventos de e-mail |

### Arquivos removidos (não recriar)

- `front-cobranca/docker-compose.yml`: redundante (usar `api-cobranca/`).
- `front-cobranca/src/lib/prisma.ts`, `billing.ts`, `auth-utils.ts`: o frontend não acessa banco nem regra de negócio.
