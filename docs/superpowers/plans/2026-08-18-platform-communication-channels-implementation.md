# Canais de Comunicação Centralizados do Cifra+ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os canais por empresa por WhatsApp global com failover ordenado, e-mail global, templates globais e atendimento exclusivo do administrador da plataforma.

**Architecture:** A configuração operacional passa a viver em modelos globais sem `companyId`. Jobs mantêm o contexto do tenant, mas resolvem o remetente apenas no worker; o serviço de WhatsApp tenta remetentes saudáveis por prioridade e registra cada tentativa. Webhooks correlacionam entregas por IDs externos, respostas entram em um inbox global e opt-outs alimentam uma supressão global por telefone.

**Tech Stack:** NestJS 11, TypeScript estrito, Prisma 7/PostgreSQL, BullMQ/Redis, Meta Cloud Graph API, Resend, Next.js 16 App Router, React 19, Tailwind CSS, Jest e Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-18-platform-communication-channels-design.md`

## Global Constraints

- Não manter modo híbrido nem fallback para credenciais armazenadas em `Company`.
- Não implantar commits intermediários; somente o conjunto completo após Task 12 é um artefato de release.
- WhatsApp usa failover ordenado; não fazer balanceamento normal de carga.
- E-mail usa uma única conta global, sem failover.
- Apenas `PLATFORM_ADMIN` acessa canais, templates e atendimento.
- Segredos são criptografados em repouso, nunca retornados por APIs e nunca registrados em logs.
- `companyId` continua obrigatório em consultas de dados de cobrança, devedor, fatura, tentativa e métricas do tenant.
- Opt-out cria supressão global por telefone e bloqueia envios de qualquer empresa.
- Falha ambígua de transporte não troca imediatamente de número.
- Clientes controlam régua, datas, horários e canais, mas não templates.
- Preservar as alterações locais preexistentes e não incluir arquivos alheios nos commits.
- Executar a implementação em um worktree isolado criado a partir do commit que contém este plano, usando a branch `codex/centralized-communication-channels`; não implementar sobre o checkout atualmente sujo.
- Não usar `any`, `@ts-ignore` nem tipos implícitos; DTOs NestJS usam `class-validator`.
- Cada comportamento começa por teste falhando, seguido da implementação mínima e nova execução verde.

---

### Task 1: Persistência global e seleção ordenada de remetentes

**Files:**
- Modify: `api-cobranca/prisma/schema.prisma`
- Create: `api-cobranca/src/platform-channels/platform-channels.module.ts`
- Create: `api-cobranca/src/platform-channels/whatsapp-sender-selector.service.ts`
- Test: `api-cobranca/src/platform-channels/whatsapp-sender-selector.service.spec.ts`
- Modify: `api-cobranca/src/app.module.ts`

**Interfaces:**
- Produces: `ResolvedWhatsAppSender` with `id`, `phoneNumberId`, `businessAccountId`, `businessPhoneNumber`, `accessToken`, `defaultLanguage`, and `priority`.
- Produces: `WhatsAppSenderSelectorService.listEligible(now: Date): Promise<ResolvedWhatsAppSender[]>`.
- Produces: `WhatsAppSenderSelectorService.listEligibleForTemplate(templateId: string, now: Date): Promise<ResolvedTemplateSender[]>`.
- Produces: Prisma models `PlatformMetaConfig`, `PlatformWhatsAppSender`, `PlatformEmailConfig`, `WhatsAppTemplateDeployment`, `WhatsAppSuppression`, `PlatformWhatsAppConversation`, contextual `PlatformWhatsAppMessage`, and `WhatsAppDispatchAttempt`.

- [ ] **Step 1: Write the failing selector tests**

```typescript
it('retorna somente remetentes habilitados e saudaveis na ordem de prioridade', async () => {
  prisma.platformWhatsAppSender.findMany.mockResolvedValue([
    sender({ id: 'backup', priority: 2, healthStatus: 'HEALTHY' }),
    sender({ id: 'primary', priority: 1, healthStatus: 'HEALTHY' }),
  ]);

  await expect(service.listEligible(new Date('2026-08-18T12:00:00Z')))
    .resolves.toEqual([
      expect.objectContaining({ id: 'primary', priority: 1 }),
      expect.objectContaining({ id: 'backup', priority: 2 }),
    ]);
});

it('ignora remetente em cooldown ainda vigente', async () => {
  prisma.platformWhatsAppSender.findMany.mockResolvedValue([
    sender({
      id: 'primary',
      priority: 1,
      healthStatus: 'COOLDOWN',
      cooldownUntil: new Date('2026-08-18T12:15:00Z'),
    }),
  ]);

  await expect(service.listEligible(new Date('2026-08-18T12:00:00Z')))
    .resolves.toEqual([]);
});

it('ignora remetente cujo WABA nao possui o template aprovado', async () => {
  prisma.platformWhatsAppSender.findMany.mockResolvedValue([
    sender({ id: 'primary', businessAccountId: 'waba-1' }),
    sender({ id: 'backup', businessAccountId: 'waba-2' }),
  ]);
  prisma.whatsAppTemplateDeployment.findMany.mockResolvedValue([
    deployment({ businessAccountId: 'waba-2', status: 'APPROVED' }),
  ]);

  await expect(
    service.listEligibleForTemplate('template-1', new Date('2026-08-18T12:00:00Z')),
  ).resolves.toEqual([expect.objectContaining({ id: 'backup' })]);
});
```

- [ ] **Step 2: Run the selector test and verify RED**

Run: `cd api-cobranca && npm test -- whatsapp-sender-selector.service.spec.ts --runInBand`

Expected: FAIL because `WhatsappSenderSelectorService` and the global Prisma model do not exist.

- [ ] **Step 3: Add the global Prisma models without contracting legacy fields yet**

Add these domain shapes, using explicit relations and indexes:

```prisma
enum PlatformChannelHealth {
  PENDING
  HEALTHY
  COOLDOWN
  LIMIT_REACHED
  ERROR
}

model PlatformWhatsAppSender {
  id                   String                @id @default(uuid())
  label                String
  phoneNumberId        String                @unique
  businessAccountId    String
  businessPhoneNumber  String
  accessTokenEncrypted String                @db.Text
  defaultLanguage      String                @default("pt_BR")
  priority             Int                   @unique
  isEnabled            Boolean               @default(false)
  healthStatus         PlatformChannelHealth @default(PENDING)
  cooldownUntil        DateTime?
  messagingLimitTier   MessagingLimitTier?
  messagingLimitResetAt DateTime?
  lastHealthCheckAt    DateTime?
  lastError            String?               @db.Text
  lastSentAt           DateTime?
  messages             PlatformWhatsAppMessage[]
  dispatchAttempts     WhatsAppDispatchAttempt[]
  createdAt            DateTime              @default(now())
  updatedAt            DateTime              @updatedAt

  @@index([isEnabled, healthStatus, priority])
}

model PlatformMetaConfig {
  id                     String   @id
  appSecretEncrypted     String   @db.Text
  verifyTokenEncrypted   String   @db.Text
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
}

model PlatformEmailConfig {
  id                     String   @id
  apiKeyEncrypted        String   @db.Text
  webhookSecretEncrypted String   @db.Text
  fromName               String
  fromEmail              String
  isEnabled              Boolean  @default(false)
  lastHealthCheckAt      DateTime?
  lastError              String?  @db.Text
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
}

model WhatsAppSuppression {
  id              String   @id @default(uuid())
  phoneNumber     String   @unique
  reason          String
  sourceMessageId String?
  createdAt       DateTime @default(now())
}

model WhatsAppTemplateDeployment {
  id                String          @id @default(uuid())
  templateId        String
  template          MessageTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  businessAccountId String
  remoteTemplateId  String?
  remoteName        String
  language          String
  status            String          @default("LOCAL")
  rejectedReason    String?         @db.Text
  lastSyncedAt      DateTime?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@unique([templateId, businessAccountId])
  @@index([businessAccountId, status])
}

model PlatformWhatsAppConversation {
  id                     String             @id @default(uuid())
  phoneNumber            String             @unique
  status                 ConversationStatus @default(NEW)
  assigneeId             String?
  assignee               User?              @relation(fields: [assigneeId], references: [id])
  lastInboundAt          DateTime?
  serviceWindowExpiresAt DateTime?
  lastMessagePreview     String?
  unreadCount            Int                @default(0)
  messages               PlatformWhatsAppMessage[]
  createdAt              DateTime           @default(now())
  updatedAt              DateTime           @updatedAt

  @@index([status, updatedAt])
}

model PlatformWhatsAppMessage {
  id             String                       @id @default(uuid())
  conversationId String
  conversation   PlatformWhatsAppConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  direction      MessageDirection
  content        String                       @db.Text
  messageId      String?                      @unique
  status         String?
  companyId      String?
  company        Company?                     @relation(fields: [companyId], references: [id])
  invoiceId      String?
  invoice        Invoice?                     @relation(fields: [invoiceId], references: [id])
  debtorId       String?
  debtor         Debtor?                      @relation(fields: [debtorId], references: [id])
  senderId       String?
  sender         PlatformWhatsAppSender?      @relation(fields: [senderId], references: [id])
  readAt         DateTime?
  createdAt      DateTime                     @default(now())

  @@index([conversationId, createdAt])
  @@index([companyId, createdAt])
  @@index([invoiceId])
  @@index([senderId, createdAt])
}
```

Create `PlatformWhatsAppConversation` with `phoneNumber @unique` and `PlatformWhatsAppMessage` with nullable `companyId`, `invoiceId`, `debtorId`, and `senderId` relations. Add `WhatsAppDispatchAttempt` with `collectionAttemptId`, `senderId`, `status`, `failureKind`, `providerMessageId`, `errorDetails`, and timestamps. Define Prisma enums `WhatsAppDispatchStatus` (`PENDING`, `SENT`, `FAILED`, `UNKNOWN`) and `ProviderFailureKind` with the seven normalized failure values from Task 3. Add the deployment relation to `MessageTemplate` and add `SKIPPED` to `CollectionAttemptStatus` for globally suppressed sends.

Add the required back-relations to `User`, `Company`, `Invoice`, `Debtor`, `CollectionAttempt`, and `MessageTemplate`. `WhatsAppDispatchAttempt` must index `(collectionAttemptId, createdAt)`, `(senderId, createdAt)`, and `providerMessageId`.

Keep the old `Company` channel columns, tenant templates, `WhatsAppConversation`, `WhatsAppMessage`, `MessagingUsage`, and `WhatsAppInteraction` in the schema only so untouched code continues to compile while each consumer is migrated. Do not add any new dependency on them. The sole destructive SQL migration and their schema removal occur in Task 8, after every consumer has moved; intermediate commits are never deployed.

- [ ] **Step 4: Implement ordered runtime resolution**

```typescript
export interface ResolvedWhatsAppSender {
  id: string;
  phoneNumberId: string;
  businessAccountId: string;
  businessPhoneNumber: string;
  accessToken: string;
  defaultLanguage: string;
  priority: number;
}

export interface ResolvedTemplateSender extends ResolvedWhatsAppSender {
  templateName: string;
  templateLanguage: string;
}

async listEligible(now: Date): Promise<ResolvedWhatsAppSender[]> {
  const senders = await this.prisma.platformWhatsAppSender.findMany({
    where: {
      isEnabled: true,
      healthStatus: 'HEALTHY',
      OR: [
        { cooldownUntil: null },
        { cooldownUntil: { lte: now } },
      ],
    },
    orderBy: { priority: 'asc' },
  });

  return senders.map((sender) => ({
    id: sender.id,
    phoneNumberId: sender.phoneNumberId,
    businessAccountId: sender.businessAccountId,
    businessPhoneNumber: sender.businessPhoneNumber,
    accessToken: this.crypto.decrypt(sender.accessTokenEncrypted),
    defaultLanguage: sender.defaultLanguage,
    priority: sender.priority,
  }));
}
```

Implement `listEligibleForTemplate` by calling `listEligible`, loading `WhatsAppTemplateDeployment` rows with `templateId`, `businessAccountId in eligibleWabas`, and `status: 'APPROVED'`, then returning only senders whose WABA appears in that result. Copy `remoteName` and `language` into `templateName` and `templateLanguage`.

Import `PlatformChannelsModule` in `AppModule`; export the selector from its module.

Register `PaymentCryptoService` directly as a provider of `PlatformChannelsModule` instead of importing `PaymentModule`; this avoids a module cycle when `PaymentModule` later consumes the global e-mail config.

- [ ] **Step 5: Generate Prisma Client and verify GREEN**

Run: `cd api-cobranca && npm run prisma:generate && npx prisma validate --schema=prisma/schema.prisma && npm test -- whatsapp-sender-selector.service.spec.ts --runInBand`

Expected: Prisma validation succeeds and all selector tests PASS.

- [ ] **Step 6: Commit the persistence boundary**

```bash
git add api-cobranca/prisma/schema.prisma api-cobranca/src/platform-channels api-cobranca/src/app.module.ts
git commit -m "feat: add global communication channel models"
```

---

### Task 2: Administração segura dos canais globais

**Files:**
- Create: `api-cobranca/src/platform-channels/dto/create-whatsapp-sender.dto.ts`
- Create: `api-cobranca/src/platform-channels/dto/update-whatsapp-sender.dto.ts`
- Create: `api-cobranca/src/platform-channels/dto/reorder-whatsapp-senders.dto.ts`
- Create: `api-cobranca/src/platform-channels/dto/upsert-platform-meta.dto.ts`
- Create: `api-cobranca/src/platform-channels/dto/upsert-platform-email.dto.ts`
- Create: `api-cobranca/src/platform-channels/dto/test-platform-email.dto.ts`
- Create: `api-cobranca/src/platform-channels/platform-channels.service.ts`
- Create: `api-cobranca/src/platform-channels/platform-channels.controller.ts`
- Create: `api-cobranca/src/platform-channels/platform-channel-health.service.ts`
- Test: `api-cobranca/src/platform-channels/platform-channel-health.service.spec.ts`
- Create: `api-cobranca/src/platform-channels/meta-graph.client.ts`
- Rename: `api-cobranca/src/admin/guards/platform-admin.guard.ts` to `api-cobranca/src/common/guards/platform-admin.guard.ts`
- Rename: `api-cobranca/src/admin/admin.guard.spec.ts` to `api-cobranca/src/common/guards/platform-admin.guard.spec.ts`
- Modify: `api-cobranca/src/admin/admin.controller.ts`
- Modify: `api-cobranca/src/admin/admin.module.ts`
- Test: `api-cobranca/src/platform-channels/platform-channels.service.spec.ts`
- Test: `api-cobranca/src/platform-channels/platform-channels.controller.spec.ts`
- Modify: `api-cobranca/src/platform-channels/platform-channels.module.ts`

**Interfaces:**
- Produces: `PlatformChannelsService.listWhatsAppSenders(): Promise<AdminWhatsAppSender[]>` without secrets.
- Produces: `createWhatsAppSender`, `updateWhatsAppSender`, `reorderWhatsAppSenders`, `testWhatsAppSender`, `getMetaConfig`, `upsertMetaConfig`, `getEmailConfig`, `upsertEmailConfig`, and `testEmailConfig`.
- Produces: admin routes rooted at `/admin/channels` guarded by `JwtAuthGuard`, `PlatformAdminGuard`, and `ThrottleGuard`.
- Produces: an automatic five-minute health check that re-tests senders whose cooldown or limit window expired before marking them `HEALTHY`.

Define these response contracts in `platform-channels.service.ts`:

```typescript
export interface AdminWhatsAppSender {
  id: string;
  label: string;
  phoneNumberId: string;
  businessAccountId: string;
  businessPhoneNumber: string;
  defaultLanguage: string;
  priority: number;
  isEnabled: boolean;
  healthStatus: PlatformChannelHealth;
  cooldownUntil: Date | null;
  lastHealthCheckAt: Date | null;
  lastError: string | null;
  hasAccessToken: boolean;
}

export interface ChannelTestResult {
  healthy: boolean;
  testedAt: string;
  message: string;
}
```

- [ ] **Step 1: Write failing service tests for secret masking and atomic reorder**

```typescript
it('nunca devolve o token criptografado ou descriptografado', async () => {
  prisma.platformWhatsAppSender.findMany.mockResolvedValue([
    sender({ accessTokenEncrypted: 'encrypted-token' }),
  ]);

  const result = await service.listWhatsAppSenders();

  expect(result[0]).toEqual(expect.objectContaining({ hasAccessToken: true }));
  expect(result[0]).not.toHaveProperty('accessTokenEncrypted');
  expect(result[0]).not.toHaveProperty('accessToken');
});

it('reordena todos os remetentes em uma transacao sem prioridade duplicada', async () => {
  await service.reorderWhatsAppSenders(['sender-b', 'sender-a'], actor);

  await expect(service.listWhatsAppSenders()).resolves.toEqual([
    expect.objectContaining({ id: 'sender-b', priority: 1 }),
    expect.objectContaining({ id: 'sender-a', priority: 2 }),
  ]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd api-cobranca && npm test -- platform-channels.service.spec.ts platform-channels.controller.spec.ts --runInBand`

Expected: FAIL because the service, controller and DTOs do not exist.

- [ ] **Step 3: Implement strict DTOs and write-only secrets**

Use `@IsString`, `@IsNotEmpty`, `@IsOptional`, `@IsInt`, `@Min`, `@IsBoolean`, `@IsEmail`, `@IsArray`, `@ArrayUnique`, and `@ValidateNested`. A missing token on update preserves the current encrypted value; an empty token is rejected. Return `hasAccessToken`, never token material.

Implement reorder in one Prisma transaction: assign temporary negative priorities, then final priorities `1..n`, and reject if the submitted IDs do not equal the complete current sender set.

On token, phone or WABA change, reset `healthStatus` to `PENDING`, set `isEnabled` to `false`, and clear `lastHealthCheckAt`. Enabling a sender requires a successful health test and `APPROVED` deployment for every active global WhatsApp template in that sender's WABA. On Resend API key, webhook secret, or sender change, also disable the e-mail config and clear its health timestamp. Store the Meta app secret and verify token in singleton ID `default`; their read DTO exposes only `hasAppSecret` and `hasVerifyToken`. Define `actor` in tests as a complete `AuthenticatedUser` with `PLATFORM_ADMIN`, `userId`, `companyId`, `email`, and `name`.

- [ ] **Step 4: Implement guarded controller routes**

```typescript
@Controller('admin/channels')
@UseGuards(JwtAuthGuard, PlatformAdminGuard, ThrottleGuard)
export class PlatformChannelsController {
  constructor(private readonly channels: PlatformChannelsService) {}

  @Get('whatsapp')
  listWhatsApp(): Promise<AdminWhatsAppSender[]> {
    return this.channels.listWhatsAppSenders();
  }

  @Post('whatsapp/:id/test')
  testWhatsApp(@Param('id') id: string): Promise<ChannelTestResult> {
    return this.channels.testWhatsAppSender(id);
  }
}
```

Implement these remaining route contracts with the same typed delegation pattern:

```text
POST /admin/channels/whatsapp
PUT  /admin/channels/whatsapp/:id
PUT  /admin/channels/whatsapp/order
GET  /admin/channels/meta
PUT  /admin/channels/meta
GET  /admin/channels/email
PUT  /admin/channels/email
POST /admin/channels/email/test
```

`MetaGraphClient` performs the phone profile health request without logging authorization. `PlatformChannelHealthService` uses `@Cron('*/5 * * * *')`, queries only enabled senders whose cooldown/reset window expired, and marks a sender healthy only after the profile request succeeds.

Add a health-service test where an expired cooldown remains `COOLDOWN` after a failed profile request and becomes `HEALTHY` with `cooldownUntil: null` only after a successful profile response.

Register the relocated stateless `PlatformAdminGuard` in every module that owns a protected controller. Update existing admin imports in the same commit so no module depends on `AdminModule` merely to use the guard.

Activation must reject a sender or e-mail config without a successful health test. Persist `AuditLog` using the authenticated platform admin's `companyId` and `userId`, with changes containing IDs and field names but no secret values.

- [ ] **Step 5: Verify service and authorization tests GREEN**

Run: `cd api-cobranca && npm test -- platform-channels.service.spec.ts platform-channels.controller.spec.ts platform-channel-health.service.spec.ts platform-admin.guard.spec.ts --runInBand`

Expected: PASS; non-platform users receive 403 in the controller test.

- [ ] **Step 6: Commit channel administration**

```bash
git add api-cobranca/src/platform-channels api-cobranca/src/common/guards api-cobranca/src/admin
git commit -m "feat: add platform channel administration api"
```

---

### Task 3: Cliente Meta isolado, classificação de falhas e failover

**Files:**
- Modify: `api-cobranca/src/platform-channels/meta-graph.client.ts`
- Create: `api-cobranca/src/whatsapp/provider-error-classifier.ts`
- Test: `api-cobranca/src/whatsapp/provider-error-classifier.spec.ts`
- Modify: `api-cobranca/src/whatsapp/whatsapp.service.ts`
- Modify: `api-cobranca/src/whatsapp/whatsapp.service.spec.ts`
- Modify: `api-cobranca/src/whatsapp/whatsapp.module.ts`
- Modify: `api-cobranca/src/whatsapp/whatsapp.controller.ts`
- Delete: `api-cobranca/src/whatsapp/dto/configure-meta-whatsapp.dto.ts`
- Modify: `api-cobranca/src/platform-channels/platform-channels.service.ts`

**Interfaces:**
- Produces: `ProviderFailureKind = 'SENDER_UNAVAILABLE' | 'SENDER_LIMIT' | 'RECIPIENT_INVALID' | 'TEMPLATE_INVALID' | 'PAYLOAD_INVALID' | 'DELIVERY_UNKNOWN' | 'TRANSIENT_PROVIDER'`.
- Produces: `classifyMetaFailure(error: MetaGraphError): ProviderFailure` with `allowsFailover`, `retryable`, `scope: 'PHONE' | 'WABA' | 'RECIPIENT' | 'MESSAGE' | 'UNKNOWN'`, and optional `resetAt`.
- Produces: `WhatsappService.sendTemplateMessage(input): Promise<{ messageId: string; status: string | null; senderId: string }>`.
- Consumes: `templateId` and `listEligibleForTemplate` so a sender is considered only when its WABA deployment is approved.

```typescript
export interface ProviderFailure {
  kind: ProviderFailureKind;
  scope: 'PHONE' | 'WABA' | 'RECIPIENT' | 'MESSAGE' | 'UNKNOWN';
  allowsFailover: boolean;
  retryable: boolean;
  resetAt?: Date;
}
```

- [ ] **Step 1: Write table-driven failing classifier tests**

```typescript
it.each([
  [{ status: 429, code: 80007 }, 'SENDER_LIMIT', 'WABA', true],
  [{ status: 429, code: 130429 }, 'SENDER_LIMIT', 'PHONE', true],
  [{ status: 401, code: 190 }, 'SENDER_UNAVAILABLE', 'PHONE', true],
  [{ status: 400, code: 131026 }, 'RECIPIENT_INVALID', 'RECIPIENT', false],
  [{ status: 400, code: 131056 }, 'TRANSIENT_PROVIDER', 'RECIPIENT', false],
  [{ status: 400, code: 132001 }, 'TEMPLATE_INVALID', 'MESSAGE', false],
])('classifica a resposta Meta com escopo e failover corretos', (raw, kind, scope, allowsFailover) => {
  expect(classifyMetaFailure(metaError(raw))).toEqual(
    expect.objectContaining({ kind, scope, allowsFailover }),
  );
});

it('trata timeout sem resposta como entrega desconhecida sem failover', () => {
  expect(classifyMetaFailure(metaTimeout())).toEqual(
    expect.objectContaining({ kind: 'DELIVERY_UNKNOWN', allowsFailover: false }),
  );
});
```

- [ ] **Step 2: Run classifier tests and verify RED**

Run: `cd api-cobranca && npm test -- provider-error-classifier.spec.ts --runInBand`

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Extract `MetaGraphClient` and implement the classifier**

`MetaGraphClient` owns URL construction, authorization header, JSON parsing and `MetaGraphError`. It must never log request authorization. Preserve the existing Graph API version from `META_GRAPH_API_VERSION`.

Remove tenant configure/status/disconnect/usage/sync-tier routes from `WhatsappController` and delete `ConfigureMetaWhatsappDto` in this task. Keep only conversation routes until Task 5 replaces them with the platform-admin controller.

In the spec file, define typed test-local fixture functions `metaError(input: { status: number; code: number }): MetaGraphError` and `metaTimeout(): MetaGraphError`; define sender fixtures as complete `ResolvedTemplateSender` objects so the tests do not depend on partial mocks.

- [ ] **Step 4: Write failing failover tests against `WhatsappService`**

```typescript
it('usa o backup quando o principal recebe falha de remetente', async () => {
  selector.listEligibleForTemplate.mockResolvedValue([primary, backup]);
  graph.sendMessage
    .mockRejectedValueOnce(metaError({ status: 429, code: 80007 }))
    .mockResolvedValueOnce({ messages: [{ id: 'wamid.backup' }] });

  const result = await service.sendTemplateMessage(messageInput);

  expect(result).toEqual(expect.objectContaining({
    messageId: 'wamid.backup',
    senderId: 'backup',
  }));
});

it('nao usa backup depois de timeout ambiguo', async () => {
  selector.listEligibleForTemplate.mockResolvedValue([primary, backup]);
  graph.sendMessage.mockRejectedValueOnce(metaTimeout());

  await expect(service.sendTemplateMessage(messageInput)).rejects.toMatchObject({
    failureKind: 'DELIVERY_UNKNOWN',
  });
  expect(graph.sendMessage).toHaveBeenCalledTimes(1);
});
```

`messageInput` in these tests is a complete `SendTemplateMessageInput` containing `collectionAttemptId`, `companyId`, `invoiceId`, `debtorId`, `templateId`, recipient phone, body parameters and optional payment button suffix.

- [ ] **Step 5: Implement minimal ordered dispatch**

For each eligible sender, create `WhatsAppDispatchAttempt` before the provider call. On success, set provider ID/status and call `markSenderHealthy(sender.id)`. On phone-scoped failover, call `markSenderFailure(sender.id)`; on WABA-scoped limit, call `markWabaLimited(sender.businessAccountId, resetAt)` and add that WABA to an in-memory `blockedWabas` set so later candidates from the already-loaded list are skipped. Persist the normalized failure before continuing. Errors without `allowsFailover` are thrown immediately. If the eligible list is empty, throw `NoHealthyWhatsAppSenderError`.

- [ ] **Step 6: Run targeted tests GREEN**

Run: `cd api-cobranca && npm test -- provider-error-classifier.spec.ts whatsapp.service.spec.ts platform-channels.service.spec.ts --runInBand`

Expected: PASS, including no fallback to any `Company` credential.

- [ ] **Step 7: Commit failover core**

```bash
git add api-cobranca/src/whatsapp api-cobranca/src/platform-channels
git commit -m "feat: dispatch whatsapp with ordered failover"
```

---

### Task 4: Jobs, limites por remetente e supressão global

**Files:**
- Modify: `api-cobranca/src/queue/message.queue.ts`
- Modify: `api-cobranca/src/queue/message.queue.spec.ts`
- Modify: `api-cobranca/src/queue/workers/message.worker.ts`
- Modify: `api-cobranca/src/queue/workers/message.worker.spec.ts`
- Create: `api-cobranca/src/queue/workers/whatsapp-dispatch.processor.ts`
- Test: `api-cobranca/src/queue/workers/whatsapp-dispatch.processor.spec.ts`
- Modify: `api-cobranca/src/queue/services/messaging-limit.service.ts`
- Create: `api-cobranca/src/queue/services/messaging-limit.service.spec.ts`
- Modify: `api-cobranca/src/queue/services/rate-limit.service.ts`
- Modify: `api-cobranca/src/whatsapp/whatsapp.service.ts`
- Modify: `api-cobranca/src/whatsapp/whatsapp.service.spec.ts`
- Modify: `api-cobranca/src/billing/billing.service.ts`
- Modify: `api-cobranca/src/billing/billing.service.spec.ts`

**Interfaces:**
- Changes: `SendMessageJob` removes `senderKey`, `templateName`, and `templateLanguage`; it adds `collectionAttemptId` plus global `templateId`. The provider name/language come from the selected WABA deployment at execution time.
- Produces: public `WhatsAppDispatchProcessor.process(data: SendMessageJob): Promise<void>`; the BullMQ worker delegates send-message jobs to it.
- Produces: `MessagingLimitService.canSend(senderId: string): Promise<DailyLimitStatus>` and `trackSend(senderId: string, phoneNumber: string): Promise<void>`.
- Consumes: failover result with `senderId` from Task 3.

Inject `MessagingLimitService` into `WhatsappService`. Before each candidate call, skip a sender whose `canSend(sender.id)` result is not allowed and update its limit state; after confirmed success, call `trackSend(sender.id, input.phoneNumber)`.

- [ ] **Step 1: Write failing queue and worker tests**

```typescript
it('enfileira contexto da tentativa sem fixar remetente', async () => {
  await service.addSendMessageJob(job({ collectionAttemptId: 'attempt-1' }));

  expect(queue.add).toHaveBeenCalledWith(
    'send-message',
    expect.not.objectContaining({ senderKey: expect.anything() }),
    expect.any(Object),
  );
});

it('bloqueia telefone suprimido antes de chamar a Meta', async () => {
  prisma.whatsAppSuppression.findUnique.mockResolvedValue({ id: 'sup-1' });

  await processor.process(jobData);

  expect(whatsapp.sendTemplateMessage).not.toHaveBeenCalled();
  expect(prisma.collectionAttempt.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED' }) }),
  );
});
```

- [ ] **Step 2: Run queue tests and verify RED**

Run: `cd api-cobranca && npm test -- message.queue.spec.ts message.worker.spec.ts messaging-limit.service.spec.ts billing.service.spec.ts --runInBand`

Expected: FAIL because jobs still require `senderKey` and limit resolution reads `Company`.

- [ ] **Step 3: Move sender choice to worker execution**

Make `createQueuedAttempt` return the persisted attempt ID. Put it in each `SendMessageJob`. Remove every `company.whatsappInstanceId`, `company.metaPhoneNumberId`, `company.whatsappStatus`, `senderKey`, preselected `templateName`, and preselected `templateLanguage` read from billing and initial-charge job creation.

- [ ] **Step 4: Enforce global suppression and sender capacity**

Normalize phone numbers with `getWhatsAppNumberLookupCandidates` before checking `WhatsAppSuppression`. Build Redis keys as `messaging:sender:<senderId>:<date>` and `messaging:recipient:<phoneNumber>`, not by company. Count confirmed outbound `PlatformWhatsAppMessage` rows by `senderId` for database reconciliation.

- [ ] **Step 5: Persist the selected sender and final result**

After `sendTemplateMessage`, set `CollectionAttempt.externalMessageId`, status `SENT`, and create the outbound `PlatformWhatsAppMessage` with `companyId`, `invoiceId`, `debtorId`, and returned `senderId`. On `DELIVERY_UNKNOWN`, keep the collection attempt non-successful and let BullMQ retry according to the normalized error.

- [ ] **Step 6: Run queue/billing tests GREEN**

Run: `cd api-cobranca && npm test -- message.queue.spec.ts message.worker.spec.ts messaging-limit.service.spec.ts billing.service.spec.ts --runInBand`

Expected: PASS; fixtures contain no tenant WhatsApp config.

- [ ] **Step 7: Commit runtime queue changes**

```bash
git add api-cobranca/src/queue api-cobranca/src/billing
git commit -m "feat: resolve platform sender inside message workers"
```

---

### Task 5: Webhook Meta global, supressão e atendimento administrativo

**Files:**
- Rename: `api-cobranca/src/whatsapp/conversation.service.ts` to `api-cobranca/src/whatsapp/platform-conversation.service.ts`
- Create: `api-cobranca/src/whatsapp/platform-conversation.service.spec.ts`
- Modify: `api-cobranca/src/webhooks/webhooks.service.ts`
- Create: `api-cobranca/src/webhooks/webhooks.service.spec.ts`
- Modify: `api-cobranca/src/webhooks/webhooks.controller.spec.ts`
- Modify: `api-cobranca/src/webhooks/webhooks.module.ts`
- Create: `api-cobranca/src/whatsapp/admin-whatsapp.controller.ts`
- Create: `api-cobranca/src/whatsapp/admin-whatsapp.controller.spec.ts`
- Delete: `api-cobranca/src/whatsapp/whatsapp.controller.ts`
- Modify: `api-cobranca/src/whatsapp/whatsapp.module.ts`

**Interfaces:**
- Produces: admin routes `/admin/support/conversations`, `/:id/messages`, `/:id/reply`, `/:id/status`, `/:id/assignee`, and `/unread-count`.
- Produces: `PlatformConversationService.handleInboundMessage(input)` without `companyId`.
- Consumes: `phone_number_id` to resolve `PlatformWhatsAppSender` and `messageId` to resolve contextual outbound messages.

- [ ] **Step 1: Write failing inbound tests**

```typescript
it('cria uma conversa global por telefone sem escolher tenant', async () => {
  await service.handleInboundMessage({
    phoneNumber: '5511999999999',
    messageId: 'wamid.inbound',
    content: 'Preciso de ajuda',
    timestamp: '1787054400',
  });

  expect(prisma.platformWhatsAppConversation.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { phoneNumber: '5511999999999' } }),
  );
  expect(prisma.platformWhatsAppMessage.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.not.objectContaining({ companyId: expect.any(String) }) }),
  );
});

it('mensagem SAIR cria supressao global idempotente', async () => {
  await webhook.handleMetaWebhook(optOutPayload, validSignature, rawBody);

  expect(prisma.whatsAppSuppression.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { phoneNumber: '5511999999999' } }),
  );
});
```

- [ ] **Step 2: Run webhook/inbox tests and verify RED**

Run: `cd api-cobranca && npm test -- platform-conversation.service.spec.ts webhooks.service.spec.ts admin-whatsapp.controller.spec.ts --runInBand`

Expected: FAIL because inbound still resolves a `Company` from the receiver.

- [ ] **Step 3: Implement global webhook correlation**

Resolve sender from `platformWhatsAppSender.phoneNumberId`. Read singleton `PlatformMetaConfig` ID `default` to compare the verification token and verify the HMAC signature with the decrypted app secret. For statuses, update `PlatformWhatsAppMessage` and `CollectionAttempt` through the external `messageId`. For inbound, upsert the global conversation. For opt-out phrases already recognized by the service, upsert `WhatsAppSuppression`; do not update a single debtor selected by tenant.

- [ ] **Step 4: Implement platform-only inbox APIs**

Guard the new controller with `JwtAuthGuard`, `PlatformAdminGuard`, and `ThrottleGuard`. Search across conversation phone plus contextual `Debtor.name`, `Company.corporateName`, and invoice ID. Assignees must have role `PLATFORM_ADMIN`. Replies use `WhatsappService.sendTextMessage`, preserve the most recent active billing context when present, and still enforce the Meta 24-hour service window.

- [ ] **Step 5: Run webhook and inbox tests GREEN**

Run: `cd api-cobranca && npm test -- webhooks.service.spec.ts webhooks.controller.spec.ts platform-conversation.service.spec.ts admin-whatsapp.controller.spec.ts --runInBand`

Expected: PASS; a company user receives 403 from every support route.

- [ ] **Step 6: Commit global support flow**

```bash
git add api-cobranca/src/webhooks api-cobranca/src/whatsapp
git commit -m "feat: centralize whatsapp webhooks and support inbox"
```

---

### Task 6: Resend global em cobranças e notificações de pagamento

**Files:**
- Modify: `api-cobranca/src/email/email.service.ts`
- Modify: `api-cobranca/src/email/email.service.spec.ts`
- Modify: `api-cobranca/src/email/email.processor.ts`
- Modify: `api-cobranca/src/email/email.module.ts`
- Modify: `api-cobranca/src/payment/payment-notifications.service.ts`
- Modify: `api-cobranca/src/payment/payment-notifications.service.spec.ts`
- Modify: `api-cobranca/src/payment/payment.module.ts`
- Modify: `api-cobranca/src/webhooks/webhooks.controller.ts`
- Modify: `api-cobranca/src/webhooks/webhooks.controller.spec.ts`
- Modify: `api-cobranca/src/platform-channels/platform-channels.service.ts`

**Interfaces:**
- Produces: `PlatformChannelsService.getResolvedEmailConfig(): Promise<ResolvedEmailConfig>`.
- Changes: `EmailService.handleWebhookEvent(rawBody, headers)` removes optional `companyId`.
- Removes: `/webhooks/resend/:companyId`.

- [ ] **Step 1: Write failing global-email tests**

```typescript
it('envia cobranca com a conta global e preserva o contexto da empresa', async () => {
  channels.getResolvedEmailConfig.mockResolvedValue({
    apiKey: 're_global',
    webhookSecret: 'whsec_global',
    from: 'Cifra+ <cobranca@ciframais.com.br>',
  });

  await service.send(collectionEmailInput);

  expect(mailer.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    apiKey: 're_global',
    from: 'Cifra+ <cobranca@ciframais.com.br>',
  }));
  expect(prisma.company.findUnique).not.toHaveBeenCalled();
});

it('notificacao de pagamento usa o remetente global', async () => {
  await service.notifyPaidInvoice('company-1', 'invoice-1');
  expect(mailer.sendEmail).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: 're_global' }),
  );
});
```

- [ ] **Step 2: Run e-mail tests and verify RED**

Run: `cd api-cobranca && npm test -- email.service.spec.ts payment-notifications.service.spec.ts webhooks.controller.spec.ts --runInBand`

Expected: FAIL because both services read Resend fields from `Company`.

- [ ] **Step 3: Resolve the singleton configuration once per send**

Use record ID `default`. Throw `PlatformEmailNotConfiguredError` when absent, disabled, or missing a successful health check. Format `from` from `fromName` and `fromEmail`; keep `companyId` only in invoice/event/attempt queries.

- [ ] **Step 4: Make the Resend webhook global**

Remove `@Post('resend/:companyId')` and the `companyId` argument throughout. Verify with the singleton webhook secret. Locate `CollectionAttempt` by external email ID and derive `companyId` from the attempt before creating `EmailEvent`.

- [ ] **Step 5: Run e-mail tests GREEN**

Run: `cd api-cobranca && npm test -- email.service.spec.ts payment-notifications.service.spec.ts webhooks.controller.spec.ts --runInBand`

Expected: PASS and no test fixture contains tenant Resend credentials.

- [ ] **Step 6: Commit global e-mail**

```bash
git add api-cobranca/src/email api-cobranca/src/payment/payment-notifications.service.ts api-cobranca/src/payment/payment-notifications.service.spec.ts api-cobranca/src/webhooks api-cobranca/src/platform-channels
git commit -m "feat: send all emails through platform resend account"
```

---

### Task 7: Templates globais e régua sem escolha de template

**Files:**
- Modify: `api-cobranca/prisma/schema.prisma`
- Modify: `api-cobranca/src/templates/templates.service.ts`
- Modify: `api-cobranca/src/templates/templates.service.spec.ts`
- Modify: `api-cobranca/src/templates/templates.controller.ts`
- Create: `api-cobranca/src/templates/templates.controller.spec.ts`
- Modify: `api-cobranca/src/templates/templates.module.ts`
- Modify: `api-cobranca/src/email/email-templates.service.ts`
- Modify: `api-cobranca/src/email/email-templates.service.spec.ts`
- Modify: `api-cobranca/src/email/email-templates.controller.ts`
- Modify: `api-cobranca/src/email/email.module.ts`
- Modify: `api-cobranca/src/templates/template-catalog.ts`
- Create: `api-cobranca/src/templates/whatsapp-template-deployment.service.ts`
- Test: `api-cobranca/src/templates/whatsapp-template-deployment.service.spec.ts`
- Modify: `api-cobranca/src/billing/collection-profile.service.ts`
- Modify: `api-cobranca/src/billing/collection-profile.service.spec.ts`
- Modify: `api-cobranca/src/billing/billing.controller.ts`
- Modify: `api-cobranca/src/billing/billing.service.ts`
- Modify: `api-cobranca/src/queue/workers/message.worker.ts`

**Interfaces:**
- Changes: template service methods no longer accept `companyId`.
- Produces: `resolveTemplateSlugForScheduleDay(day: number): TemplateSlug` with exact catalog mapping.
- Produces: one `WhatsAppTemplateDeployment` per global template and unique configured/tested WABA.
- Changes: client rule-step input excludes `templateId`.

- [ ] **Step 1: Write failing global-template tests**

```typescript
it('cria defaults uma unica vez para toda a plataforma', async () => {
  await service.ensureDefaultTemplates();

  expect(prisma.messageTemplate.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { slug: { in: TEMPLATE_SLUGS } } }),
  );
  expect(prisma.messageTemplate.createMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.arrayContaining([
        expect.not.objectContaining({ companyId: expect.any(String) }),
      ]),
    }),
  );
});

it.each([
  [-30, 'cobranca-emissao'],
  [-1, 'pre-vencimento'],
  [0, 'vencimento-hoje'],
  [2, 'atraso-primeiro-aviso'],
  [10, 'atraso-recorrente'],
  [30, 'atraso-critico'],
])('resolve dia %s para %s', (day, slug) => {
  expect(resolveTemplateSlugForScheduleDay(day)).toBe(slug);
});

it('publica o template em cada WABA configurado uma unica vez', async () => {
  prisma.platformWhatsAppSender.findMany.mockResolvedValue([
    sender({ businessAccountId: 'waba-1' }),
    sender({ businessAccountId: 'waba-1' }),
    sender({ businessAccountId: 'waba-2' }),
  ]);

  const result = await deployments.publishToAllConfiguredWabas('template-1');

  expect(result.map((item) => item.businessAccountId)).toEqual([
    'waba-1',
    'waba-2',
  ]);
});
```

- [ ] **Step 2: Run template/rule tests and verify RED**

Run: `cd api-cobranca && npm test -- templates.service.spec.ts email-templates.service.spec.ts collection-profile.service.spec.ts --runInBand`

Expected: FAIL because services still require `companyId` and rule input accepts `templateId`.

- [ ] **Step 3: Globalize template persistence and admin controllers**

As a compile-time transition before the final migration, make both template `companyId` relations optional, make each `slug` globally unique, and remove the composite tenant uniqueness. Change service lookups to `slug`, remove every template `companyId` filter, use the platform WhatsApp sender selected for WABA template publication, and guard both template controllers with `PlatformAdminGuard`. Maintain one active WhatsApp and one active e-mail template for each slug. Task 8 removes the now-unused nullable tenant fields and creates the sole SQL migration.

For publication, group all configured senders that passed a health test by `businessAccountId`, including disabled backups. Choose the lowest-priority healthy sender token in each group, upsert one deployment per WABA, and synchronize status per deployment. The template admin response returns the deployment status list; editing provider-relevant fields resets every deployment to `LOCAL` and automatically disables affected senders until approval is restored.

- [ ] **Step 4: Make schedule-to-template resolution deterministic**

```typescript
export function resolveTemplateSlugForScheduleDay(day: number): TemplateSlug {
  if (day <= -30) return 'cobranca-emissao';
  if (day < 0) return 'pre-vencimento';
  if (day === 0) return 'vencimento-hoje';
  if (day <= 2) return 'atraso-primeiro-aviso';
  if (day >= 30) return 'atraso-critico';
  return 'atraso-recorrente';
}
```

Compute cumulative schedule day when resolving sequential rule delays. Remove `templateId` from public controller DTO/type and from `setSteps`; keep internal template selection in the send path by global slug.

- [ ] **Step 5: Run template/billing tests GREEN**

Run: `cd api-cobranca && npm run prisma:generate && npx prisma validate --schema=prisma/schema.prisma && npm test -- templates.service.spec.ts templates.controller.spec.ts email-templates.service.spec.ts collection-profile.service.spec.ts billing.service.spec.ts message.worker.spec.ts --runInBand`

Expected: PASS; company users receive 403 from template controllers.

- [ ] **Step 6: Commit global templates**

```bash
git add api-cobranca/src/templates api-cobranca/src/email api-cobranca/src/billing api-cobranca/src/queue/workers
git commit -m "feat: centralize communication templates"
```

---

### Task 8: Remover configuração de canal do domínio de clientes

**Files:**
- Modify: `api-cobranca/prisma/schema.prisma`
- Create: `api-cobranca/prisma/migrations/20260818120000_centralize_platform_communication_channels/migration.sql`
- Modify: `api-cobranca/src/admin/admin.service.ts`
- Modify: `api-cobranca/src/admin/admin.service.spec.ts`
- Modify: `api-cobranca/src/admin/dto/admin-client.dto.ts`
- Modify: `api-cobranca/src/admin/admin.module.ts`
- Modify: `api-cobranca/src/billing/billing.controller.ts`
- Modify: `api-cobranca/src/health/indicators/meta.indicator.ts`
- Modify: `api-cobranca/src/health/health.service.spec.ts`
- Modify: `api-cobranca/src/health/health.module.ts`
- Modify: `api-cobranca/src/config/env.validation.ts`
- Modify: `api-cobranca/src/config/env.validation.spec.ts`
- Modify: `api-cobranca/src/email/email.controller.ts`
- Modify: `api-cobranca/.env.example`
- Modify: `AGENTS.md`

**Interfaces:**
- Changes: `CreateAdminClientDto` and `UpdateAdminClientDto` contain no `meta`, `whatsapp`, or Resend fields.
- Changes: health indicator reports global sender count/health instead of company integration health.

- [ ] **Step 1: Rewrite admin tests first to reject channel ownership**

```typescript
it('cria cliente sem campos de whatsapp ou resend', async () => {
  await service.createClient(createClientDto);

  expect(prisma.company.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.not.objectContaining({
        metaPhoneNumberId: expect.anything(),
        resendApiKeyEncrypted: expect.anything(),
      }),
    }),
  );
});
```

- [ ] **Step 2: Run backend legacy-boundary tests and verify RED**

Run: `cd api-cobranca && npm test -- admin.service.spec.ts health.service.spec.ts --runInBand`

Expected: FAIL while admin DTO/service still accept tenant channel data.

- [ ] **Step 3: Remove legacy backend paths**

Delete tenant WhatsApp controller/config DTO and all admin mappings for Meta/Resend. Remove the tenant `email/send-test` endpoint because channel tests belong to `/admin/channels`. Remove tenant connectivity preconditions from manual billing endpoints. Update the health indicator to count enabled and healthy `PlatformWhatsAppSender` rows and report global e-mail activation without exposing config.

Now remove the legacy channel columns from `Company`, remove tenant `WhatsAppConversation`, `WhatsAppMessage`, `MessagingUsage`, and `WhatsAppInteraction`, remove unused `WhatsappStatus`, `WhatsappProvider`, and `WhatsAppInteractionDirection` enums, and remove `companyId` from both template models. Make template slugs globally unique and remove single-WABA status fields now represented by `WhatsAppTemplateDeployment`. Create the sole migration SQL file: create all global tables/relations first, discard legacy conversations/templates/configuration, then drop old columns/tables/enums. The application code in this task must contain no read fallback to the removed structures.

Modify `api-cobranca/src/config/env.validation.ts` in this task. Remove `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, and `RESEND_WEBHOOK_SECRET` as runtime credential sources because these values move to the platform singleton records. Keep `PAYMENT_SECRET_KEY`, `META_GRAPH_API_VERSION`, `META_WEBHOOK_BASE_URL`, Redis, database, JWT, and bootstrap settings required to decrypt or expose platform config. Update `.env.example` and `AGENTS.md` to match.

- [ ] **Step 4: Prove no executable tenant credential path remains**

Run: `cd api-cobranca && rg -n "metaAccessTokenEncrypted|resendApiKeyEncrypted|resendWebhookSecretEncrypted|metaPhoneNumberId|whatsappInstanceId|whatsappStatus" src --glob '*.ts'`

Expected: matches exist only on the new platform models/service names where applicable; no match reads these fields from `company`.

- [ ] **Step 5: Run backend tests GREEN**

Run: `cd api-cobranca && npm run prisma:generate && npx prisma validate --schema=prisma/schema.prisma && npm test -- admin.service.spec.ts billing.service.spec.ts health.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit backend legacy removal**

```bash
git add AGENTS.md api-cobranca/.env.example api-cobranca/prisma api-cobranca/src/admin api-cobranca/src/billing api-cobranca/src/config api-cobranca/src/email/email.controller.ts api-cobranca/src/health api-cobranca/src/whatsapp
git commit -m "refactor: remove tenant-owned communication channels"
```

---

### Task 9: Cliente de API e painel administrativo de canais

**Files:**
- Modify: `front-cobranca/src/lib/api-client.ts`
- Create: `front-cobranca/src/lib/__tests__/api-client-platform-channels.test.ts`
- Create: `front-cobranca/src/app/(dashboard)/admin/canais/page.tsx`
- Create: `front-cobranca/src/app/(dashboard)/admin/canais/__tests__/page.test.tsx`
- Modify: `front-cobranca/src/components/ui/Sidebar.tsx`
- Modify: `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`
- Modify: `front-cobranca/src/middleware.ts`

**Interfaces:**
- Produces: typed `PlatformWhatsAppSender`, `PlatformEmailConfig`, create/update/reorder/test API methods.
- Produces: platform route `/admin/canais`.

- [ ] **Step 1: Write failing API-client and page tests**

```typescript
it('reordena os remetentes pela API administrativa', async () => {
  await apiClient.reorderPlatformWhatsappSenders(['backup', 'primary']);

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/admin/channels/whatsapp/order'),
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ senderIds: ['backup', 'primary'] }),
    }),
  );
});

it('mostra a ordem e nunca renderiza o token', async () => {
  render(<AdminChannelsPage />);

  expect(await screen.findByText('WhatsApp principal')).toBeInTheDocument();
  expect(screen.queryByText('encrypted-token')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `cd front-cobranca && npx jest src/lib/__tests__/api-client-platform-channels.test.ts 'src/app/(dashboard)/admin/canais/__tests__/page.test.tsx' --runInBand`

Expected: FAIL because types, methods and page do not exist.

- [ ] **Step 3: Add strict API types and methods**

Define write inputs separately from read models so secrets cannot appear on response types. Parse API errors through the existing centralized `fetch` path. Remove public methods `configureMetaWhatsapp`, `getWhatsappStatus`, `getWhatsappUsage`, and `disconnectWhatsapp`.

- [ ] **Step 4: Build responsive channel administration UI**

Create tabs “WhatsApp” and “E-mail”. WhatsApp shows the write-only Meta app secret and webhook verify token, callback URL, plus ordered sender cards with status, priority, number, WABA, limit, cooldown, last test, last error, enable/disable, test, edit and move up/down actions. E-mail shows sender, enabled state, secret fields that stay blank on load, and test recipient. Disable save/test buttons while requests run and show friendly errors.

- [ ] **Step 5: Expose the route only to platform admins**

Add `/admin/canais` to `PLATFORM_ADMIN_ALLOWED_PATHS` and `adminItems`. The company navigation must not include WhatsApp, templates or inbox links.

- [ ] **Step 6: Run frontend tests GREEN**

Run: `cd front-cobranca && npx jest src/lib/__tests__/api-client-platform-channels.test.ts 'src/app/(dashboard)/admin/canais/__tests__/page.test.tsx' src/components/ui/__tests__/Sidebar.test.tsx --runInBand`

Expected: PASS.

- [ ] **Step 7: Commit channel UI**

```bash
git add front-cobranca/src/lib front-cobranca/src/app/'(dashboard)'/admin/canais front-cobranca/src/components/ui front-cobranca/src/middleware.ts
git commit -m "feat: add platform channel settings page"
```

---

### Task 10: Templates administrativos e régua simplificada no frontend

**Files:**
- Rename: `front-cobranca/src/app/(dashboard)/configuracoes/templates/page.tsx` to `front-cobranca/src/app/(dashboard)/admin/templates/page.tsx`
- Rename: `front-cobranca/src/app/(dashboard)/configuracoes/templates/__tests__/page.test.tsx` to `front-cobranca/src/app/(dashboard)/admin/templates/__tests__/page.test.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/configuracoes/regua/page.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/configuracoes/regua/__tests__/page.test.tsx`
- Modify: `front-cobranca/src/lib/api-client.ts`
- Modify: `front-cobranca/src/components/ui/Sidebar.tsx`
- Modify: `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`
- Modify: `front-cobranca/src/middleware.ts`

**Interfaces:**
- Changes: template API methods point to admin endpoints and remain callable only from `/admin/templates`.
- Changes: `CollectionRuleStep` and `setRuleSteps` omit `templateId`.

- [ ] **Step 1: Change tests first for platform-only templates and no template picker**

```typescript
it('permite editar templates no painel da plataforma', async () => {
  render(<AdminTemplatesPage />);
  expect(await screen.findByRole('heading', { name: 'Templates globais' }))
    .toBeInTheDocument();
});

it('salva a etapa da regua sem templateId', async () => {
  render(<CollectionRulesPage />);
  await user.click(await screen.findByRole('button', { name: 'Salvar regua' }));

  expect(mockSetRuleSteps).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([expect.not.objectContaining({ templateId: expect.anything() })]),
  );
});
```

- [ ] **Step 2: Run template/rule UI tests and verify RED**

Run: `cd front-cobranca && npx jest 'src/app/(dashboard)/admin/templates/__tests__/page.test.tsx' 'src/app/(dashboard)/configuracoes/regua/__tests__/page.test.tsx' --runInBand`

Expected: FAIL because the admin route does not exist and the rule UI still sends `templateId`.

- [ ] **Step 3: Move and adapt the template page**

Change headings/copy to global ownership, remove company-specific integration warnings, keep WhatsApp approval and e-mail publishing states, and rely on admin API methods. Add `/admin/templates` to middleware and admin sidebar.

- [ ] **Step 4: Remove template choice from rules**

Delete template dropdown state, loading, validation and payload fields. Keep day/delay, time range, channel and active state. Add explanatory copy: “O Cifra+ aplica automaticamente o template global adequado a cada etapa.”

- [ ] **Step 5: Run UI tests GREEN**

Run: `cd front-cobranca && npx jest 'src/app/(dashboard)/admin/templates/__tests__/page.test.tsx' 'src/app/(dashboard)/configuracoes/regua/__tests__/page.test.tsx' src/components/ui/__tests__/Sidebar.test.tsx --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit global template UI**

```bash
git add front-cobranca/src/app/'(dashboard)'/admin/templates front-cobranca/src/app/'(dashboard)'/configuracoes front-cobranca/src/lib/api-client.ts front-cobranca/src/components/ui front-cobranca/src/middleware.ts
git commit -m "feat: move templates to platform administration"
```

---

### Task 11: Inbox administrativo e remoção das páginas legadas

**Files:**
- Rename: `front-cobranca/src/app/(dashboard)/inbox/page.tsx` to `front-cobranca/src/app/(dashboard)/admin/atendimento/page.tsx`
- Create: `front-cobranca/src/app/(dashboard)/admin/atendimento/__tests__/page.test.tsx`
- Delete: `front-cobranca/src/app/(dashboard)/configuracoes/whatsapp/page.tsx`
- Modify: `front-cobranca/src/lib/api-client.ts`
- Modify: `front-cobranca/src/components/ui/Sidebar.tsx`
- Modify: `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`
- Modify: `front-cobranca/src/middleware.ts`
- Modify: `front-cobranca/src/app/(dashboard)/admin/clientes/page.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/admin/clientes/__tests__/page.test.tsx`

**Interfaces:**
- Changes: conversation API methods use `/admin/support`.
- Produces: admin route `/admin/atendimento` with company/invoice/sender context.
- Removes: `/inbox`, `/configuracoes/whatsapp`, and `/configuracoes/templates`.

- [ ] **Step 1: Write failing central-inbox tests**

```typescript
it('mostra contexto da empresa e cobranca em cada mensagem', async () => {
  render(<AdminSupportPage />);

  expect(await screen.findByText('Escola Horizonte')).toBeInTheDocument();
  expect(screen.getByText('Cobranca INV-1042')).toBeInTheDocument();
  expect(screen.getByText('Enviado por WhatsApp backup 1')).toBeInTheDocument();
});

it('sidebar de cliente nao exibe atendimento ou configuracao de canais', () => {
  renderSidebarAs('COMPANY_ADMIN');
  expect(screen.queryByText('Inbox WhatsApp')).not.toBeInTheDocument();
  expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument();
  expect(screen.queryByText('Templates')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run inbox/sidebar tests and verify RED**

Run: `cd front-cobranca && npx jest 'src/app/(dashboard)/admin/atendimento/__tests__/page.test.tsx' src/components/ui/__tests__/Sidebar.test.tsx 'src/app/(dashboard)/admin/clientes/__tests__/page.test.tsx' --runInBand`

Expected: FAIL because inbox is tenant-scoped and client admin form still has Meta/Resend fields.

- [ ] **Step 3: Adapt the global support page**

Use typed context from `/admin/support`: company name, invoice ID/status, debtor name, sender label, delivery status and service-window expiry. Keep responsive list/detail behavior, search and status filters. Friendly errors must distinguish unavailable channel, expired service window and failed load.

- [ ] **Step 4: Remove all tenant channel UI**

Delete legacy pages and navigation entries. Remove WhatsApp status, phone/WABA/token, Resend API key/webhook/from fields and payload construction from the admin client form. Add `/admin/atendimento` to platform middleware and sidebar.

- [ ] **Step 5: Run frontend tests GREEN**

Run: `cd front-cobranca && npx jest 'src/app/(dashboard)/admin/atendimento/__tests__/page.test.tsx' src/components/ui/__tests__/Sidebar.test.tsx 'src/app/(dashboard)/admin/clientes/__tests__/page.test.tsx' --runInBand`

Expected: PASS; company sessions have no rendered path to communication administration.

- [ ] **Step 6: Commit inbox and UI cleanup**

```bash
git add front-cobranca/src/app/'(dashboard)'/admin/atendimento front-cobranca/src/app/'(dashboard)'/inbox/page.tsx front-cobranca/src/app/'(dashboard)'/configuracoes/whatsapp/page.tsx front-cobranca/src/app/'(dashboard)'/admin/clientes front-cobranca/src/lib/api-client.ts front-cobranca/src/components/ui/Sidebar.tsx front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx front-cobranca/src/middleware.ts
git commit -m "feat: restrict communication support to platform admins"
```

---

### Task 12: Verificação integrada e limpeza residual

**Files:**
- Modify: `api-cobranca/test/cobrapix-flow.e2e-spec.ts`
- Create: `api-cobranca/scripts/verify-centralized-channel-migration.sh`
- Modify: `api-cobranca/src/config/env.validation.spec.ts`
- Modify: `api-cobranca/README.md`
- Modify: `front-cobranca/README.md`

**Interfaces:**
- Verifies: platform admin configures channels; tenant cannot; queued charge resolves sender; webhook updates context; global inbox receives reply; global e-mail sends.

- [ ] **Step 1: Add a failing end-to-end authorization and dispatch scenario**

```typescript
it('centraliza canais e impede configuracao pelo cliente', async () => {
  await request(app.getHttpServer())
    .get('/admin/channels/whatsapp')
    .set('Authorization', `Bearer ${companyToken}`)
    .expect(403);

  await request(app.getHttpServer())
    .get('/admin/channels/whatsapp')
    .set('Authorization', `Bearer ${platformToken}`)
    .expect(200);
});
```

- [ ] **Step 2: Create the disposable database verification script**

Create `scripts/verify-centralized-channel-migration.sh` with `set -euo pipefail`. It must start a new `postgres:16-alpine` container bound to a Docker-assigned localhost port, store its exact generated container name in `CHANNELS_TEST_CONTAINER`, install an EXIT trap that removes only that container, wait for `pg_isready`, and run the following with both `DATABASE_URL` and `DIRECT_URL` pointed to that disposable database:

```bash
npm run prisma:deploy
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
npm run test:e2e:smoke
```

The script must abort if `docker run` fails and must never read or mutate the repository's configured Neon URL.

- [ ] **Step 3: Run the focused E2E test against the disposable database and verify RED**

Run: `cd api-cobranca && bash scripts/verify-centralized-channel-migration.sh`

Expected: FAIL in the new authorization/dispatch assertion until fixtures create global channel configuration and the TestingModule registers the new controllers/services.

- [ ] **Step 4: Update E2E fixtures and environment documentation**

Seed test-only global sender/e-mail records with encrypted fixture secrets. Mock only Meta/Resend network boundaries. Update README setup to say channel credentials are configured in `/admin/canais`; environment retains database, Redis, encryption root, JWT and static provider version settings. Re-run `bash scripts/verify-centralized-channel-migration.sh`; expected PASS.

- [ ] **Step 5: Run residual legacy searches**

Run:

```bash
rg -n -i "evolution|/whatsapp/meta|/whatsapp/status|/whatsapp/disconnect|/webhooks/resend/:companyId|company\.(meta|resend|whatsapp)|senderKey" api-cobranca/src front-cobranca/src
rg -n "href: \"/inbox\"|/configuracoes/whatsapp|/configuracoes/templates" front-cobranca/src
```

Expected: no executable legacy route, tenant credential access, tenant inbox link, or preselected sender remains. Text in migration history is allowed.

- [ ] **Step 6: Run the complete verification suite**

Run:

```bash
cd api-cobranca && npm run prisma:generate
cd api-cobranca && npx prisma validate --schema=prisma/schema.prisma
cd api-cobranca && npm test -- --runInBand
cd api-cobranca && npm run lint
cd api-cobranca && npm run build
cd api-cobranca && bash scripts/verify-centralized-channel-migration.sh
cd front-cobranca && npx jest --runInBand
cd front-cobranca && npm run lint
cd front-cobranca && npm run build
```

Expected: every command exits 0; migration history and schema have no diff, and there are no TypeScript, Prisma, lint, test or build errors.

- [ ] **Step 7: Inspect the final diff for accidental user-change capture**

Run: `git status --short && git diff --check && git log --oneline --decorate --max-count=15`

Expected: the isolated worktree is clean and the task commits contain only centralized-channel implementation files.

- [ ] **Step 8: Commit final E2E and documentation changes**

```bash
git add api-cobranca/test/cobrapix-flow.e2e-spec.ts api-cobranca/scripts/verify-centralized-channel-migration.sh api-cobranca/src/config/env.validation.spec.ts api-cobranca/README.md front-cobranca/README.md
git commit -m "test: verify centralized communication channels"
```
