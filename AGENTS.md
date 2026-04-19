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
   - `ASAAS_API_KEY` (para pagamentos)
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

## Payment API (Asaas)

Endpoints para geração de PIX e Boleto:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payments/create` | Cria cobrança PIX |
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
| POST | `/webhooks/asaas` | Notificações de pagamento |

## Prisma Schema

**Canonical schema**: `front-cobranca/prisma/schema.prisma`

Schema is auto-synced to `api-cobranca/prisma/schema.prisma` via:
- `postinstall` hook
- `prebuild` hook  
- `npm run prisma:sync-schema`
- `npm run prisma:generate`

To apply schema changes:
```bash
cd front-cobranca && npx prisma migrate dev --name <name>
cd api-cobranca && npm run prisma:generate
```

## Seed Data

After `npx prisma db seed` in front-cobranca:
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

- `front-cobranca/prisma/schema.prisma` - Database schema (source of truth)
- `api-cobranca/src/health/` - Health check endpoints
- `api-cobranca/src/payment/` - Payment service (PIX/Boleto)
- `api-cobranca/src/queue/` - Message queue (BullMQ)
- `front-cobranca/src/lib/evolution.ts` - WhatsApp client

## Removed Files

- `front-cobranca/docker-compose.yml` - Redundant (use api-cobranca/)
- `front-cobranca/src/lib/prisma.ts` - Not needed in frontend
- `front-cobranca/src/lib/billing.ts` - Moved to backend
- `front-cobranca/src/lib/auth-utils.ts` - Moved to backend