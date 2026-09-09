# Resend Webhook Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Resend email sending and delivery tracking production-safe by using `send` for dispatch and a verified `/webhooks/resend` endpoint for asynchronous email events.

**Architecture:** Keep runtime email sending on `resend.emails.send()` and do not use Resend webhook create/list/update APIs inside the billing flow. Register the webhook once in Resend Dashboard, verify every production webhook with `RESEND_WEBHOOK_SECRET`, store events idempotently by `svix-id`, and update `CollectionAttempt` status only for known email message ids.

**Tech Stack:** NestJS, ConfigModule with Zod validation, Resend Node SDK, Prisma/PostgreSQL, Jest.

---

## File Structure

- Modify `api-cobranca/src/config/env.validation.ts`: require `RESEND_WEBHOOK_SECRET` in production and validate its expected `whsec_` format when present.
- Create `api-cobranca/src/config/env.validation.spec.ts`: cover Resend production env validation.
- Modify `api-cobranca/src/email/email.service.ts`: fail closed when the webhook secret is missing in production and normalize missing Svix headers as authentication errors.
- Modify `api-cobranca/src/email/email.service.spec.ts`: cover signature enforcement, duplicate delivery, unknown message ids, and event ordering.
- Modify `api-cobranca/src/webhooks/webhooks.controller.ts`: return 200 on accepted Resend webhook events, map authentication errors to 401, and map malformed payloads to 400 without leaking internals.
- Modify `api-cobranca/src/webhooks/webhooks.controller.spec.ts`: cover `POST /webhooks/resend` behavior beyond route metadata.
- Modify `api-cobranca/.env.example`: document endpoint, event list, and secret source.
- Modify `AGENTS.md`: add `/webhooks/resend` and `RESEND_WEBHOOK_SECRET` to project operating docs.
- Create `docs/resend-webhook-runbook.md`: production setup and testing checklist.

No Prisma migration is required because `EmailEvent`, `CollectionAttempt.externalMessageId`, and the relevant indexes already exist.

---

### Task 1: Production Env Validation

**Files:**
- Modify: `api-cobranca/src/config/env.validation.ts`
- Create: `api-cobranca/src/config/env.validation.spec.ts`
- Modify: `api-cobranca/.env.example`

- [ ] **Step 1: Write failing env validation tests**

Create `api-cobranca/src/config/env.validation.spec.ts`:

```ts
import { validateEnv } from './env.validation';

function buildValidConfig(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return Object.assign({
    NODE_ENV: 'development',
    PORT: '3001',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/cobrapix',
    JWT_SECRET: 'jwt_secret_with_at_least_32_characters',
    FRONTEND_URL: 'http://localhost:3000',
    EFI_ENV: 'homologation',
    EFI_WEBHOOK_SECRET: 'efi_webhook_secret_with_32_characters',
  }, overrides);
}

describe('validateEnv', () => {
  it('exige RESEND_WEBHOOK_SECRET em producao', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          NODE_ENV: 'production',
          RESEND_WEBHOOK_SECRET: undefined,
        }),
      ),
    ).toThrow('RESEND_WEBHOOK_SECRET e obrigatoria em producao');
  });

  it('aceita RESEND_WEBHOOK_SECRET com prefixo whsec', () => {
    const env = validateEnv(
      buildValidConfig({
        NODE_ENV: 'production',
        RESEND_WEBHOOK_SECRET: 'whsec_test_secret',
      }),
    );

    expect(env.RESEND_WEBHOOK_SECRET).toBe('whsec_test_secret');
  });

  it('rejeita RESEND_WEBHOOK_SECRET com formato inesperado', () => {
    expect(() =>
      validateEnv(
        buildValidConfig({
          RESEND_WEBHOOK_SECRET: 'plain-secret',
        }),
      ),
    ).toThrow('RESEND_WEBHOOK_SECRET deve comecar com whsec_');
  });
});
```

- [ ] **Step 2: Run the failing env validation tests**

Run:

```bash
cd api-cobranca && npm test -- env.validation.spec.ts --runInBand
```

Expected: FAIL because `RESEND_WEBHOOK_SECRET` is currently optional and has no format validation.

- [ ] **Step 3: Implement env validation**

Replace the `envSchema` export in `api-cobranca/src/config/env.validation.ts` with this version. Keep the existing imports and `validateEnv` function:

```ts
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    META_GRAPH_API_VERSION: z.string().default('v23.0'),
    META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    META_WEBHOOK_BASE_URL: z.string().url().optional(),
    META_APP_SECRET: z.string().optional(),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    EFI_ENV: z.enum(['homologation', 'production']).default('homologation'),
    EFI_PLATFORM_CLIENT_ID: z.string().optional(),
    EFI_PLATFORM_CLIENT_SECRET: z.string().optional(),
    EFI_PLATFORM_CERT_PATH: z.string().optional(),
    EFI_PLATFORM_CERT_PASSWORD: z.string().optional(),
    EFI_PLATFORM_PAYEE_CODE: z.string().optional(),
    EFI_PLATFORM_ACCOUNT_NUMBER: z.string().optional(),
    EFI_PLATFORM_SPLIT_PERCENTAGE: z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .default(0),
    EFI_WEBHOOK_BASE_URL: z.string().url().optional(),
    EFI_WEBHOOK_SECRET: z
      .string()
      .min(32, 'EFI_WEBHOOK_SECRET deve ter pelo menos 32 caracteres'),
    PAYMENT_SECRET_KEY: z.string().min(32).optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.RESEND_WEBHOOK_SECRET && !env.RESEND_WEBHOOK_SECRET.startsWith('whsec_')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_WEBHOOK_SECRET'],
        message: 'RESEND_WEBHOOK_SECRET deve comecar com whsec_',
      });
    }

    if (env.NODE_ENV === 'production' && !env.RESEND_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_WEBHOOK_SECRET'],
        message: 'RESEND_WEBHOOK_SECRET e obrigatoria em producao',
      });
    }
  });
```

- [ ] **Step 4: Update `.env.example` Resend comments**

Replace the Resend section in `api-cobranca/.env.example` with:

```dotenv
# ============================================
# Resend (e-mail de cobrança)
# ============================================
# A API key e o remetente sao configurados por cliente no Admin.
# O remetente deve usar um dominio verificado na conta Resend do cliente.
# Cadastre no Resend Dashboard um webhook apontando para:
#   https://sua-api.com/webhooks/resend
# Eventos recomendados:
#   email.sent, email.delivered, email.opened, email.clicked,
#   email.bounced, email.complained, email.failed, email.suppressed,
#   email.delivery_delayed
# Copie o signing secret do endpoint de webhook no Resend Dashboard.
RESEND_WEBHOOK_SECRET="whsec_your_resend_webhook_secret"
```

- [ ] **Step 5: Run env validation tests**

Run:

```bash
cd api-cobranca && npm test -- env.validation.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api-cobranca/src/config/env.validation.ts api-cobranca/src/config/env.validation.spec.ts api-cobranca/.env.example
git commit -m "chore: require resend webhook secret in production"
```

---

### Task 2: Email Webhook Service Safety

**Files:**
- Modify: `api-cobranca/src/email/email.service.ts`
- Modify: `api-cobranca/src/email/email.service.spec.ts`

- [ ] **Step 1: Extend webhook test helper**

In `api-cobranca/src/email/email.service.spec.ts`, change the `createWebhookService` options type to include `nodeEnv`:

```ts
function createWebhookService(options?: {
  webhookSecret?: string;
  verifiedPayload?: Record<string, unknown>;
  attemptStatus?: 'SENT' | 'DELIVERED' | 'OPENED' | 'CLICKED' | 'FAILED';
  nodeEnv?: 'development' | 'test' | 'production';
}) {
```

Replace the `configService` mock inside `createWebhookService` with:

```ts
  const configService = {
    get: jest.fn((key: string): string | undefined => {
      if (key === 'RESEND_WEBHOOK_SECRET') return options?.webhookSecret;
      if (key === 'NODE_ENV') return options?.nodeEnv ?? 'test';
      return undefined;
    }),
  } as unknown as ConfigService;
```

Expose `emailEventFindUnique` in the return object:

```ts
    prisma: {
      emailEventFindUnique,
      emailEventCreate,
      collectionAttemptFindFirst,
      collectionAttemptUpdateMany,
    },
```

- [ ] **Step 2: Add failing and regression tests**

Append these tests as the last tests inside the existing `describe('EmailService', () => {` block:

```ts
  it('falha fechado em producao quando RESEND_WEBHOOK_SECRET nao esta configurado', async () => {
    const { service, resendMailer } = createWebhookService({
      nodeEnv: 'production',
    });

    await expect(
      service.handleWebhookEvent(buildWebhookPayload('email.delivered'), {
        id: 'msg_prod_missing_secret',
      }),
    ).rejects.toThrow(
      'Webhook Resend: assinatura obrigatoria em producao',
    );

    expect(resendMailer.verifyWebhookEvent).not.toHaveBeenCalled();
  });

  it('trata svix-id ausente como erro de assinatura', async () => {
    const { service } = createWebhookService();

    await expect(
      service.handleWebhookEvent(buildWebhookPayload('email.delivered'), {}),
    ).rejects.toThrow('Webhook Resend: assinatura ausente');
  });

  it('ignora entrega duplicada pelo mesmo svix-id sem criar novo evento', async () => {
    const { service, prisma } = createWebhookService();
    prisma.emailEventFindUnique.mockResolvedValueOnce({ id: 'event-existing' });

    const result = await service.handleWebhookEvent(
      buildWebhookPayload('email.delivered'),
      { id: 'msg_duplicate' },
    );

    expect(result).toEqual({ processed: true, eventType: 'delivered' });
    expect(prisma.emailEventCreate).not.toHaveBeenCalled();
    expect(prisma.collectionAttemptUpdateMany).not.toHaveBeenCalled();
  });

  it('nao rebaixa status CLICKED quando chega evento delivered atrasado', async () => {
    const { service, prisma } = createWebhookService({
      attemptStatus: 'CLICKED',
    });

    await service.handleWebhookEvent(buildWebhookPayload('email.delivered'), {
      id: 'msg_delivered_after_clicked',
    });

    expect(prisma.emailEventCreate).toHaveBeenCalled();
    expect(prisma.collectionAttemptUpdateMany).not.toHaveBeenCalled();
  });

  it('retorna processed false quando o email_id nao pertence a tentativa conhecida', async () => {
    const { service, prisma } = createWebhookService();
    prisma.collectionAttemptFindFirst.mockResolvedValueOnce(null);

    const result = await service.handleWebhookEvent(
      buildWebhookPayload('email.delivered'),
      { id: 'msg_unknown_email_id' },
    );

    expect(result).toEqual({ processed: false, eventType: 'delivered' });
    expect(prisma.emailEventCreate).not.toHaveBeenCalled();
    expect(prisma.collectionAttemptUpdateMany).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the service tests**

Run:

```bash
cd api-cobranca && npm test -- email.service.spec.ts --runInBand
```

Expected: FAIL on the production missing secret test because unsigned production payloads are currently parsed when the secret is absent.

- [ ] **Step 4: Implement fail-closed webhook processing**

In `api-cobranca/src/email/email.service.ts`, replace the beginning of `handleWebhookEvent` through the payload parsing block with:

```ts
  async handleWebhookEvent(
    rawBody: Buffer,
    headers: SvixHeaders,
  ): Promise<{ processed: boolean; eventType?: string }> {
    const secret = this.configService.get<string>('RESEND_WEBHOOK_SECRET');
    const nodeEnv = this.configService.get<string>('NODE_ENV');

    if (!headers.id) {
      throw new Error('Webhook Resend: assinatura ausente');
    }

    if (!secret && nodeEnv === 'production') {
      throw new Error('Webhook Resend: assinatura obrigatoria em producao');
    }

    const payload = secret
      ? this.resendMailer.verifyWebhookEvent({
          payload: rawBody.toString('utf8'),
          headers,
          webhookSecret: secret,
        })
      : this.parseWebhookPayload(rawBody);
```

Leave the rest of `handleWebhookEvent` unchanged.

- [ ] **Step 5: Run the service tests**

Run:

```bash
cd api-cobranca && npm test -- email.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api-cobranca/src/email/email.service.ts api-cobranca/src/email/email.service.spec.ts
git commit -m "fix: harden resend webhook processing"
```

---

### Task 3: Controller Error Mapping

**Files:**
- Modify: `api-cobranca/src/webhooks/webhooks.controller.ts`
- Modify: `api-cobranca/src/webhooks/webhooks.controller.spec.ts`

- [ ] **Step 1: Add controller behavior tests**

Replace `api-cobranca/src/webhooks/webhooks.controller.spec.ts` with:

```ts
import { HttpException, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { EmailService } from '../email/email.service';

function createController(options?: { emailError?: Error }) {
  const webhooksService = {} as WebhooksService;
  const emailService = {
    handleWebhookEvent: jest.fn(async () => {
      if (options?.emailError) {
        throw options.emailError;
      }
      return { processed: true, eventType: 'delivered' };
    }),
  } as unknown as EmailService;

  return {
    controller: new WebhooksController(webhooksService, emailService),
    emailService: emailService as unknown as {
      handleWebhookEvent: jest.Mock;
    },
  };
}

describe('WebhooksController', () => {
  it('expoe POST /webhooks/resend no modulo de webhooks', () => {
    const handler = Object.getOwnPropertyDescriptor(
      WebhooksController.prototype,
      'handleResendWebhook',
    )?.value;

    expect(Reflect.getMetadata(PATH_METADATA, WebhooksController)).toBe(
      'webhooks',
    );
    expect(handler).toEqual(expect.any(Function));
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('resend');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
  });

  it('encaminha raw body e headers Svix para o EmailService', async () => {
    const { controller, emailService } = createController();
    const rawBody = Buffer.from('{"type":"email.delivered"}', 'utf8');

    await expect(
      controller.handleResendWebhook(
        { type: 'email.delivered' },
        'msg_123',
        '1780000000',
        'v1,signature',
        { rawBody } as never,
      ),
    ).resolves.toEqual({ processed: true, eventType: 'delivered' });

    expect(emailService.handleWebhookEvent).toHaveBeenCalledWith(rawBody, {
      id: 'msg_123',
      timestamp: '1780000000',
      signature: 'v1,signature',
    });
  });

  it('retorna 401 para webhook Resend sem assinatura valida', async () => {
    const { controller } = createController({
      emailError: new Error('Webhook Resend: assinatura ausente'),
    });

    await expect(
      controller.handleResendWebhook(
        {},
        undefined,
        undefined,
        undefined,
        { rawBody: Buffer.from('{}', 'utf8') } as never,
      ),
    ).rejects.toMatchObject<HttpException>({
      message: 'Nao autorizado',
    });
  });

  it('retorna 400 para payload Resend malformado', async () => {
    const { controller } = createController({
      emailError: new Error('Payload webhook Resend invalido: JSON mal formado'),
    });

    await expect(
      controller.handleResendWebhook(
        {},
        'msg_bad_payload',
        undefined,
        undefined,
        { rawBody: Buffer.from('{', 'utf8') } as never,
      ),
    ).rejects.toMatchObject<HttpException>({
      message: 'Payload invalido',
    });
  });
});
```

- [ ] **Step 2: Run the controller tests**

Run:

```bash
cd api-cobranca && npm test -- webhooks.controller.spec.ts --runInBand
```

Expected: FAIL because the controller currently has no explicit 200 status metadata and maps non-signature Resend errors to 500.

- [ ] **Step 3: Implement explicit success status and Resend error mapping**

In `api-cobranca/src/webhooks/webhooks.controller.ts`, add `HttpCode` to the import from `@nestjs/common`:

```ts
  HttpCode,
```

Add `@HttpCode(HttpStatus.OK)` between `@Post('resend')` and `async handleResendWebhook`:

```ts
  @Post('resend')
  @HttpCode(HttpStatus.OK)
  async handleResendWebhook(
```

In `api-cobranca/src/webhooks/webhooks.controller.ts`, add these private helpers inside `WebhooksController`:

```ts
  private isResendUnauthorizedError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.startsWith('Webhook Resend: assinatura')
    );
  }

  private isResendBadRequestError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.startsWith('Payload webhook Resend invalido')
    );
  }
```

Replace the `catch` block in `handleResendWebhook` with:

```ts
    } catch (error) {
      if (this.isResendUnauthorizedError(error)) {
        throw new HttpException('Nao autorizado', HttpStatus.UNAUTHORIZED);
      }

      if (this.isResendBadRequestError(error)) {
        throw new HttpException('Payload invalido', HttpStatus.BAD_REQUEST);
      }

      this.logger.error(
        'Erro ao processar webhook Resend:',
        error instanceof Error ? error.message : 'erro desconhecido',
      );
      throw new HttpException(
        'Falha ao processar webhook',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
```

- [ ] **Step 4: Run the controller tests**

Run:

```bash
cd api-cobranca && npm test -- webhooks.controller.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api-cobranca/src/webhooks/webhooks.controller.ts api-cobranca/src/webhooks/webhooks.controller.spec.ts
git commit -m "fix: map resend webhook errors safely"
```

---

### Task 4: Operational Documentation

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/resend-webhook-runbook.md`

- [ ] **Step 1: Update `AGENTS.md` required env vars**

Add `RESEND_WEBHOOK_SECRET` to the `Required env vars in api-cobranca` list:

```md
   - `RESEND_WEBHOOK_SECRET` (signing secret do webhook Resend em producao)
```

- [ ] **Step 2: Update `AGENTS.md` webhook table**

Add this row to the webhook table:

```md
| POST | `/webhooks/resend` | Eventos de email Resend (entrega, abertura, clique, bounce, falha) |
```

- [ ] **Step 3: Create the Resend runbook**

Create `docs/resend-webhook-runbook.md`:

```md
# Resend Webhook Runbook

## Runtime Decision

O CobraPix usa a API `resend.emails.send()` para disparar emails de cobranca.
O webhook da Resend e usado apenas para eventos assincronos depois do envio.

Nao use as APIs `webhooks.create`, `webhooks.get`, `webhooks.list` ou
`webhooks.update` dentro do fluxo normal de cobranca. O endpoint deve ser
cadastrado uma vez no Resend Dashboard por ambiente.

## Production Setup

1. Publique o backend `api-cobranca` em HTTPS.
2. No Resend Dashboard, crie um webhook com endpoint:

   ```text
   https://sua-api.com/webhooks/resend
   ```

3. Selecione estes eventos:

   ```text
   email.sent
   email.delivered
   email.opened
   email.clicked
   email.bounced
   email.complained
   email.failed
   email.suppressed
   email.delivery_delayed
   ```

4. Copie o signing secret do endpoint e configure:

   ```dotenv
   RESEND_WEBHOOK_SECRET="whsec_live_signing_secret_from_resend"
   ```

5. Reinicie a API para validar o env no bootstrap.

## Local Testing

1. Rode a API:

   ```bash
   cd api-cobranca && npm run dev
   ```

2. Exponha a porta 3001 com um tunnel HTTPS.
3. Cadastre temporariamente no Resend o endpoint:

   ```text
   https://seu-tunnel/webhooks/resend
   ```

4. Envie uma cobranca de teste por email.
5. Confirme que `EmailEvent` recebeu o evento e que `CollectionAttempt.status`
   saiu de `SENT` para `DELIVERED`, `OPENED`, `CLICKED` ou `FAILED`.

## Safety Rules

- Em producao, a API nao inicia sem `RESEND_WEBHOOK_SECRET`.
- Em producao, webhooks sem `svix-id`, `svix-timestamp` ou `svix-signature` devem retornar 401.
- Payload malformado deve retornar 400.
- Evento repetido com o mesmo `svix-id` nao deve criar novo `EmailEvent`.
- Evento de status antigo nao deve rebaixar `CLICKED` para `DELIVERED`.
- Evento com `email_id` desconhecido deve retornar 200 com `processed: false`
  para evitar retry infinito de evento que nao pertence ao CobraPix.
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/resend-webhook-runbook.md
git commit -m "docs: add resend webhook runbook"
```

---

### Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
cd api-cobranca && npm test -- env.validation.spec.ts email.service.spec.ts webhooks.controller.spec.ts --runInBand
```

Expected: PASS for all targeted tests.

- [ ] **Step 2: Run full backend tests**

Run:

```bash
cd api-cobranca && npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run backend build**

Run:

```bash
cd api-cobranca && npm run build
```

Expected: Prisma Client generation and Nest build complete successfully.

- [ ] **Step 4: Manual webhook smoke test in development**

Start the API with no `RESEND_WEBHOOK_SECRET` in development:

```bash
cd api-cobranca && NODE_ENV=development npm run dev
```

In a second terminal, send a fake event with an unknown `email_id`:

```bash
curl -i -X POST http://localhost:3001/webhooks/resend \
  -H 'Content-Type: application/json' \
  -H 'svix-id: msg_local_unknown' \
  -d '{"type":"email.delivered","created_at":"2026-05-28T12:00:00.000Z","data":{"email_id":"unknown-email-id","created_at":"2026-05-28T12:00:00.000Z","to":["teste@example.com"]}}'
```

Expected:

```text
HTTP/1.1 200 OK
```

Response body:

```json
{"processed":false,"eventType":"delivered"}
```

- [ ] **Step 5: Manual production fail-closed smoke test**

Start the API with production env and no Resend secret:

```bash
cd api-cobranca && NODE_ENV=production RESEND_WEBHOOK_SECRET= npm run start
```

Expected: bootstrap fails with `RESEND_WEBHOOK_SECRET e obrigatoria em producao`.

- [ ] **Step 6: Final commit if verification adjustments were needed**

If Task 5 required small fixes, commit only those fixes:

```bash
git add api-cobranca/src api-cobranca/.env.example AGENTS.md docs/resend-webhook-runbook.md
git commit -m "test: verify resend webhook hardening"
```

Skip this commit if there were no changes after Tasks 1-4.

---

## Implementation Notes

- The runtime billing flow should not create, update, retrieve, or list Resend webhooks. Those APIs are useful for provisioning tools, but they add unnecessary operational risk to normal cobrança execution.
- Keep the per-company Resend API key encrypted and backend-only. The frontend should never receive Resend API keys or webhook secrets.
- The webhook endpoint must use the raw request body for signature verification. `NestFactory.create(AppModule, { rawBody: true })` already exists in `api-cobranca/src/main.ts`; keep it enabled.
- The endpoint should return success for known-but-ignored events and unknown `email_id` events to prevent endless retries for events the app cannot process.
