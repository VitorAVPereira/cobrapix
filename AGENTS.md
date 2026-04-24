# AGENTS.md

## Architecture

- **front-cobranca**: Next.js 16 frontend (port 3000)
- **api-cobranca**: NestJS backend (port 3001)
- **Evolution API**: WhatsApp integration via Docker (port 8080)
- **Neon Database**: PostgreSQL cloud (não requer Docker)
- **Redis**: Para filas de mensagens (port 6379)

## Prerequisites

1. Start Docker containers (in api-cobranca dir):
   ```bash
   docker-compose up -d  # Evolution API (port 8080)
   docker run -d -p 6379:6379 redis:alpine  # Redis para filas
   ```
2. Set up `.env` from `.env.example` in each package
3. Required env vars in api-cobranca:
   - `DATABASE_URL`, `DIRECT_URL`
   - `EVOLUTION_API_KEY`, `EVOLUTION_JWT_SECRET`
   - `PAYMENT_SECRET_KEY` (criptografia das credenciais do gateway)
   - `EFI_PLATFORM_CLIENT_ID`, `EFI_PLATFORM_CLIENT_SECRET`
   - `EFI_PLATFORM_PAYEE_CODE`, `EFI_PLATFORM_SPLIT_PERCENTAGE`
   - `EFI_WEBHOOK_BASE_URL`
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
| POST | `/webhooks/evolution` | Status conexão WhatsApp |
| POST | `/webhooks/efi/pix` | Notificações de pagamento Pix |
| POST | `/webhooks/efi/cobrancas` | Notificações de cobranças/boleto |

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
- `front-cobranca/src/lib/evolution.ts` - WhatsApp client

## Removed Files

- `front-cobranca/docker-compose.yml` - Redundant (use api-cobranca/)
- `front-cobranca/src/lib/prisma.ts` - Not needed in frontend
- `front-cobranca/src/lib/billing.ts` - Moved to backend
- `front-cobranca/src/lib/auth-utils.ts` - Moved to backend
