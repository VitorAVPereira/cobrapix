Aqui está o plano de ação completo, organizado por fases com dependências lógicas e instruções precisas de implementação.

---

# Plano de Ação — CobraPix MVP (10 clientes x 1000 devedores)

---

## FASE 1: Correções de Segurança (Dia 1)

### 1.1 Remover `.env.evolution` do Git e corrigir `.gitignore`

**Problema:** Arquivo com credenciais reais está no histórico do Git.

**Ações:**
```bash
# 1. Remover do tracking (mantém arquivo local)
git rm --cached api-cobranca/.env.evolution

# 2. Corrigir .gitignore da api-cobranca (trocar .env.*.local por .env*)
```
- Editar `api-cobranca/.gitignore` — trocar `.env.*.local` por `.env*` (igual ao frontend)
- Fazer commit com mensagem clara
- **Rotacionar** a API key exposta (`AUTHENTICATION_API_KEY`) e senha do Postgres (`POSTGRES_PASSWORD`) nos ambientes onde estão em uso
- Opcional (se o repo for privado e recente): reescrever o histórico com `git filter-branch`

**Arquivos:** `api-cobranca/.gitignore:2-3`

---

### 1.2 Remover fallback hardcoded do JWT

**Problema:** `auth.module.ts:18` e `jwt.strategy.ts:15` usam `'default-secret-change-in-production'` como fallback. O `env.validation.ts` já exige `JWT_SECRET` com min 32 chars, mas o fallback é risco residual.

**Ações:**
- Em `api-cobranca/src/auth/auth.module.ts:16-18` — remover o operador `||` e forçar erro se `JWT_SECRET` não existir:
  ```typescript
  secret: jwtOptions.secret,  // Vai falhar no bootstrap se não configurado
  ```
- Em `api-cobranca/src/auth/strategies/jwt.strategy.ts:13-15` — mesma coisa:
  ```typescript
  secretOrKey: jwtOptions.secret,
  ```
- A validação do Zod em `env.validation.ts:22-24` já garante que o valor exista e tenha tamanho mínimo — o fallback é redundante e perigoso.

**Arquivos:** `auth.module.ts:16-18`, `jwt.strategy.ts:13-15`

---

### 1.3 Endurecer `ValidationPipe`

**Problema:** `app.module.ts:37` usa `ValidationPipe` sem opções — propriedades não declaradas em DTOs são aceitas silenciosamente.

**Ação:**
- Em `api-cobranca/src/app.module.ts:34-38`, alterar para:
  ```typescript
  {
    provide: APP_PIPE,
    useFactory: () => new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  },
  ```

**Arquivo:** `app.module.ts:34-38`

---

### 1.4 Adicionar verificação de assinatura nos webhooks Efí

**Problema:** `webhooks.controller.ts:84-114` aceita qualquer POST em `/webhooks/efi/pix` e `/webhooks/efi/cobrancas` sem verificar assinatura.

**Ações:**
- Implementar guard específico para webhooks Efí que verifique:
  - Header `x-api-key` ou token de webhook configurado no `GatewayAccount`
  - OU assinatura HMAC com segredo cadastrado
- Alternativa rápida: verificar se o `txid` / `notificationToken` do payload pertence a alguma invoice/gateway account da base antes de processar — isso evita injeção de dados falsos de fontes externas

**Arquivos:** `webhooks.controller.ts:84-114`, `efi.service.ts:770-786`

---

### 1.5 Adicionar Helmet (security headers)

**Problema:** `helmet` já está instalado mas nunca usado. Zero headers de segurança.

**Ação:**
- Em `api-cobranca/src/main.ts`, adicionar após criar o app:
  ```typescript
  import helmet from 'helmet';
  // ...
  app.use(helmet());
  ```

**Arquivo:** `main.ts:7`

---

## FASE 2: Banco de Dados — Índices (Dia 1-2)

### 2.1 Criar migration com índices críticos

**Problema:** As queries do cron de billing e métricas fazem full table scan em todas as tabelas.

**Índices a adicionar no `schema.prisma`:**

```prisma
// Model Invoice — índices críticos para billing
@@index([companyId, status, dueDate])       // cron: where company + PENDING + date range
@@index([status, dueDate])                   // fallback: PENDING + date range

// Model CollectionLog — índices para métricas
@@index([companyId, actionType, createdAt])  // getMetrics filtra por 7 actionTypes + período

// Model Company — WhatsApp status
@@index([whatsappStatus, whatsappInstanceId]) // cron: where CONNECTED + instanceId not null
```

**Ações:**
```bash
cd api-cobranca
# Editar schema.prisma adicionando os @@index acima
npm run prisma:migrate -- --name add_performance_indexes
```

**Arquivo:** `prisma/schema.prisma` (nos models Invoice, CollectionLog, Company)

---

## FASE 3: Worker — Escalabilidade (Dia 2)

### 3.1 Aumentar concurrency e remover limiter excessivo

**Problema:** `message.worker.ts:127-131` — `concurrency: 1` + `limiter: { max: 1, duration: 10_000 }` limita a 360 msgs/hora. Meta suporta ~80-250/segundo para utility templates.

**Ação:**
- Em `api-cobranca/src/queue/workers/message.worker.ts:116-133`, alterar:
  ```typescript
  this.worker = new Worker<WhatsAppQueueJob>(
    'whatsapp-messages',
    (job) => this.processJob(job),
    {
      connection: this.queueService.getConnection(),
      concurrency: 10,  // era 1 — processa até 10 jobs paralelos
      limiter: {
        max: 10,         // era 1 — até 10 jobs por segundo
        duration: 1_000,  // era 10_000 — janela de 1 segundo
      },
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
    },
  );
  ```

Isso dá ~600 msgs/minuto (ainda conservador para utility templates da Meta, que permitem muito mais). Ajuste monitorando os headers `X-Business-Use-Case-Usage` das respostas da Meta.

**Arquivo:** `message.worker.ts:116-133`

---

### 3.2 Reduzir delay artificial no `addBulkSendMessageJobs`

**Problema:** `message.queue.ts:103-111` — `buildSafeDelay` adiciona `index * 30s` por job. Para 1000 jobs, o último tem 8h de delay. Com concurrency maior, isso é desnecessário.

**Ação:**
- Em `api-cobranca/src/queue/message.queue.ts:5-8`, reduzir constantes:
  ```typescript
  const SAFE_SINGLE_MIN_DELAY_MS = 1_000;   // era 15_000
  const SAFE_SINGLE_MAX_DELAY_MS = 5_000;   // era 45_000
  const SAFE_BULK_INTERVAL_MS = 2_000;      // era 30_000
  const SAFE_BULK_JITTER_MS = 2_000;        // era 15_000
  ```
- Ajustar `buildSafeDelay` para usar `index * SAFE_BULK_INTERVAL_MS` ainda, mas com base menor.

O rate limiting real é feito pelo `RateLimitService` no worker — o delay no enfileiramento é redundante quando o worker já tem rate limiting.

**Arquivo:** `message.queue.ts:5-8, 103-111`

---

### 3.3 Implementar Dead Letter Queue (DLQ)

**Problema:** Jobs que falham 3 vezes são removidos silenciosamente. Sem visibilidade.

**Ação:**
- Configurar `removeOnFail` para manter falhas por mais tempo e expor via API
- Criar endpoint `GET /queue/stats` e `POST /queue/retry/:jobId` no `QueueModule`
- Hook no evento `failed` do worker para logar com detalhes

**Arquivos:** `message.worker.ts:147-149` (evento failed), novo endpoint em `queue/`

---

## FASE 4: API — Paginação e Tratamento de Erro (Dia 3)

### 4.1 Paginação server-side nas invoices

**Problema:** `invoices.controller.ts:53-56` retorna todas as invoices. Frontend carrega tudo em memória.

**Ações no backend:**
- Alterar `invoices.controller.ts:53-56` para aceitar query params:
  ```typescript
  @Get()
  async findAll(
    @GetUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
    @Query('search') search?: string,
    @Query('status') status?: InvoiceStatus,
  ): Promise<{ data: InvoiceListItem[]; total: number; page: number; pageSize: number }> {
    return this.invoicesService.findPaginated(user.companyId, { page, pageSize, search, status });
  }
  ```
- Implementar `findPaginated` no `InvoicesService` com `skip`/`take` + `where` com `contains` para search

**Arquivos:** `invoices.controller.ts:53-56`, `invoices.service.ts`

### 4.2 Adaptar frontend para paginação server-side

**Ação:**
- Em `api-client.ts:398-400`, alterar `getInvoices()` para aceitar parâmetros:
  ```typescript
  async getInvoices(params: { page: number; pageSize: number; search?: string; status?: string }): Promise<PaginatedResponse<InvoiceListItem>> {
    const qs = new URLSearchParams(params as any).toString();
    return this.fetch(`/invoices?${qs}`);
  }
  ```
- Em `InvoiceTable.tsx:431`, trocar `getPaginationRowModel()` por `manualPagination: true` e passar `pageCount` calculado a partir do `total` da API
- Adicionar campo de busca (já existe filtro client-side, precisa virar query param)
- Adicionar seletor de pageSize

**Arquivos:** `api-client.ts:398-400`, `InvoiceTable.tsx:431-447`, `cobrancas/page.tsx`

---

### 4.3 ExceptionFilter global

**Problema:** Cada controller duplica try/catch com tratamento inconsistente.

**Ação:**
- Criar `api-cobranca/src/common/filters/http-exception.filter.ts`:
  ```typescript
  @Catch()
  export class GlobalExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
      // Se HttpException — usa status/mensagem
      // Se Prisma error — mapeia para conflito/not found
      // Se desconhecido — 500 com mensagem genérica (não vaza stack)
      // Loga tudo com contexto
    }
  }
  ```
- Registrar em `app.module.ts` como `APP_FILTER`

**Arquivo novo:** `src/common/filters/http-exception.filter.ts`

---

### 4.4 Rate limiting nos endpoints HTTP

**Ação:**
- Criar guard `ThrottleGuard` usando `rate-limiter-flexible` (já instalado):
  - `POST /auth/login`: 5 tentativas/minuto por IP
  - `POST /payments/*`: 30 requisições/minuto por company
  - `GET /invoices`: 60 requisições/minuto por company
- Opcional: usar `@nestjs/throttler` que abstrai isso com decorators

**Arquivo novo:** `src/common/guards/throttle.guard.ts`

---

## FASE 5: Correções de Negócio (Dia 3-4)

### 5.1 Corrigir vazamento multi-tenant no `findGatewayAccountByNotification`

**Problema:** `efi.service.ts:783-785` — fallback busca qualquer gateway account ativa, ignorando `companyId`.

**Ação:**
- Remover o fallback cross-company. Se não encontrar pela invoice, retornar `null` em vez de buscar qualquer conta:
  ```typescript
  // Antes (linhas 783-785):
  return this.prisma.gatewayAccount.findFirst({
    where: { provider: 'EFI', status: 'ACTIVE' },
  });
  
  // Depois: simplesmente retornar null
  return null;
  ```
- No `handleChargesWebhook`, se `gatewayAccount` for null, logar e retornar sem processar.

**Arquivo:** `efi.service.ts:770-786`

---

### 5.2 Paralelizar criação de pagamentos no billing

**Problema:** `billing.service.ts:432-501` — loop `for...of` chama `ensureInvoicePayment()` sequencialmente para cada invoice. 1000 faturas = 1000 chamadas Efí seriais.

**Ação:**
- Agrupar invoices que precisam de pagamento novo (sem `gatewayId` válido)
- Usar `Promise.all` com chunk de 10-20 para criar pagamentos em paralelo:
  ```typescript
  const chunkSize = 10;
  for (let i = 0; i < invoices.length; i += chunkSize) {
    const chunk = invoices.slice(i, i + chunkSize);
    await Promise.all(chunk.map(inv => this.ensureInvoicePayment(inv, company)));
  }
  ```
- Ou melhor: usar o endpoint `POST /payments/create-batch` que já existe no `PaymentController`

**Arquivo:** `billing.service.ts:432-501`

---

### 5.3 Limpeza de sobras Evolution

**Ações:**
- Remover `webhooks/evolution` endpoint (ou marcar como deprecated)
- Remover enum `EVOLUTION` do schema (só referência, mantendo `META_CLOUD` como único)
- Renomear `evolution.indicator.ts` → `meta.indicator.ts`
- Limpar referências a `EVOLUTION_API_KEY`, `EVOLUTION_API_URL`, etc.

**Arquivos:** `webhooks.controller.ts:68-82`, `schema.prisma:40`, `health/indicators/evolution.indicator.ts`

---

## FASE 6: Frontend — Cache e UX (Dia 4-5)

### 6.1 Adicionar TanStack Query para caching

**Problema:** Toda navegação refetcha todos os dados. Sem cache, sem revalidação.

**Ação:**
- Instalar `@tanstack/react-query`
- Criar hooks especializados:
  - `useInvoices(params)` — com staleTime de 30s
  - `useMetrics(period)` — com staleTime de 60s
  - `useSettings()` — com staleTime de 5min
- Substituir `useState` + `useEffect` nos pages por esses hooks
- Adicionar `QueryClientProvider` no layout

**Arquivos novos:** `src/hooks/use-invoices.ts`, `src/hooks/use-metrics.ts`, `src/hooks/use-settings.ts`

---

### 6.2 Loading skeletons e error boundaries

**Ação:**
- Adicionar componentes `InvoiceTableSkeleton`, `MetricsSkeleton`
- Criar `ErrorBoundary` wrapper para páginas
- Adicionar estados de empty (sem invoices, sem métricas) com CTA contextual

---

## FASE 7: Observabilidade (Dia 5-6)

### 7.1 Structured logging com correlation IDs

**Ação:**
- Criar interceptor que gera `x-correlation-id` por request (se não vier no header)
- Injetar correlation ID no logger via `AsyncLocalStorage`
- Em todos os `this.logger.log/error/warn`, usar formato JSON: `{ correlationId, message, context, data }`

**Arquivo novo:** `src/common/interceptors/correlation.interceptor.ts`

---

### 7.2 Expandir health check

**Ação:**
- Adicionar indicador Redis: `ping` no ioredis
- Adicionar indicador BullMQ: contar jobs waiting/active/failed — alertar se `failed > 50` ou `waiting > 1000`
- Adicionar indicador Efí: `GET /v2/gn/balance` na API da Efí (ou endpoint leve equivalente)

**Arquivos:** `health/indicators/` — novos indicadores, `health.service.ts`

---

### 7.3 Expor queue stats via API

**Ação:**
- Criar endpoint `GET /queue/stats` (já existe `getQueueStats()` em `message.queue.ts:92-101`, só precisa de controller)
- Adicionar `POST /queue/retry/:jobId` para reprocessar jobs falhos

**Arquivo:** novo controller em `queue/`

---

## FASE 8: CI/CD e Testes (Dia 6-7)

### 8.1 GitHub Actions CI

**Ação:**
- Criar `.github/workflows/ci.yml`:
  ```yaml
  on: [push, pull_request]
  jobs:
    backend:
      - checkout
      - setup node 20
      - npm ci
      - npm run lint
      - npm run build
      - npm test
    frontend:
      - checkout
      - setup node 20
      - npm ci
      - npm run lint
      - npm run build
  ```

---

### 8.2 Testes críticos

**Prioridade de cobertura:**

1. `PaymentCryptoService` — encrypt/decrypt cycle (criptografia de credenciais é critical path)
2. `EfiService.createPixCobv` — mock do SDK Efí, verificar idempotência
3. `BillingService.queueBillingForCompany` — mock de tudo, verificar que invoices já logadas hoje são puladas
4. `WebhooksService.verifyMetaSignature` — HMAC validation com payload conhecido
5. `MessageWorkerService.processSendMessageJob` — opt-in check, rate limit, fallback

---

## Resumo de Ordem de Execução

| Dia | Fase | Itens | Tempo estimado |
|-----|------|-------|----------------|
| 1 | Segurança | `.env.evolution`, JWT, ValidationPipe, Helmet | 2-3h |
| 1-2 | Banco | Índices críticos + migration | 1h |
| 2 | Worker | Concurrency, delays, DLQ | 3-4h |
| 2-3 | Webhook Efí | Assinatura / verificação | 2-3h |
| 3 | Paginação | Backend + Frontend server-side | 4-5h |
| 3 | ExceptionFilter | Global filter + throttle | 2h |
| 3-4 | Negócio | Multi-tenant fix, paralelizar Efí, limpar Evolution | 3h |
| 4-5 | Frontend | TanStack Query, skeletons, error boundaries | 4-5h |
| 5-6 | Observabilidade | Structured logging, health expand, queue stats | 4-5h |
| 6-7 | CI/CD + Testes | GitHub Actions + 5 suites críticas | 4-5h |

**Total estimado:** 7 dias de trabalho (um dev full-time).

---