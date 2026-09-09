# AGENTS.md

## Architecture

- **front-cobranca**: Next.js 16 frontend (port 3000)
- **api-cobranca**: NestJS backend (port 3001)
- **Meta Cloud API**: WhatsApp oficial via Graph API e webhook `/webhooks/meta`
- **Evolution API**: legado opcional para migração (port 8080)
- **Neon Database**: PostgreSQL cloud (não requer Docker)
- **Redis**: Para filas de mensagens (port 6379)

## Prerequisites

1. Start Redis (and Evolution only if testing the legacy path):
   ```bash
   docker run -d -p 6379:6379 redis:alpine  # Redis para filas
   # Opcional legado:
   # cd api-cobranca && docker-compose up -d  # Evolution API (port 8080)
   ```
2. Set up `.env` from `.env.example` in each package
3. Required env vars in api-cobranca:
   - `DATABASE_URL`, `DIRECT_URL`
   - `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`
   - `META_GRAPH_API_VERSION` (default `v23.0`)
   - `PAYMENT_SECRET_KEY` (criptografia das credenciais do gateway)
   - `EFI_PLATFORM_CLIENT_ID`, `EFI_PLATFORM_CLIENT_SECRET`
   - `EFI_PLATFORM_PAYEE_CODE`, `EFI_PLATFORM_SPLIT_PERCENTAGE`
   - `EFI_WEBHOOK_BASE_URL`
   - `RESEND_WEBHOOK_SECRET` (signing secret do webhook Resend em producao)
   - `REDIS_HOST`, `REDIS_PORT` (para filas)

## Commands

```bash
# Frontend (Next.js)
cd front-cobranca
npm run dev        # port 3000
npm run build
npm run lint

# Backend (NestJS)
cd api-cobranca
npm run dev        # port 3001
npm run build
npm run test
npm run lint
```

## Payment API (Efí Bank)

Endpoints para geração de PIX e Boleto:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payments/create` | Cria cobrança PIX CobV |
| POST | `/payments/create-batch` | Cria cobranças em lote |
| POST | `/payments/boleto` | Cria boleto |
| POST | `/payments/boleto-batch` | Cria múltiplos boletos |
| GET | `/payments/invoice/:id` | Consulta status |
| POST | `/payments/invoice/:id/status` | Atualiza status |
| GET | `/payments/status` | Verifica configuração |

**Payload example:**
```json
{
  "invoiceId": "uuid-aqui",
  "billingType": "PIX" | "BOLETO"
}
```

## Webhooks

| Endpoint | Description |
|----------|-------------|
| GET/POST | `/webhooks/meta` | Webhook oficial Meta Cloud API |
| POST | `/webhooks/evolution` | Status conexão WhatsApp legado |
| POST | `/webhooks/efi/pix` | Notificações de pagamento Pix |
| POST | `/webhooks/efi/cobrancas` | Notificações de cobranças/boleto |
| POST | `/webhooks/resend` | Eventos de email Resend (entrega, abertura, clique, bounce, falha) |

## Prisma Schema

**Canonical schema**: `api-cobranca/prisma/schema.prisma`

Prisma belongs exclusively to the NestJS backend. The frontend must not keep a Prisma schema, migrations, seed, Prisma Client, or direct database access.

To apply schema changes:
```bash
cd api-cobranca && npm run prisma:migrate -- --name <name>
cd api-cobranca && npm run prisma:generate
```

## Seed Data

After `npx prisma db seed --schema=prisma/schema.prisma` in api-cobranca:
- Company: "Empresa Teste MVP"
- Login: admin@cobrapix.com / senha123

## Testing

```bash
# Frontend - no explicit test script, but Jest is installed
cd front-cobranca && npx jest

# Backend
cd api-cobranca && npm test
```

## Key Files

- `api-cobranca/prisma/schema.prisma` - Database schema (source of truth)
- `api-cobranca/src/health/` - Health check endpoints
- `api-cobranca/src/payment/` - Payment service (PIX/Boleto)
- `api-cobranca/src/queue/` - Message queue (BullMQ)
- `api-cobranca/src/whatsapp/` - Meta Cloud API client/configuração oficial

## Removed Files

- `front-cobranca/docker-compose.yml` - Redundant (use api-cobranca/)
- `front-cobranca/src/lib/prisma.ts` - Not needed in frontend
- `front-cobranca/src/lib/billing.ts` - Moved to backend
- `front-cobranca/src/lib/auth-utils.ts` - Moved to backend
