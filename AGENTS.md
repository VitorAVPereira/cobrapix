# AGENTS.md

## Architecture

- **front-cobranca**: Next.js 16 frontend (port 3000)
- **api-cobranca**: NestJS backend (port 3001)
- **Datafy**: único transporte do WhatsApp oficial (API compatível com a Cloud API da Meta) e webhook `/webhooks/datafy`; não há integração direta com a Meta
- **Neon Database**: PostgreSQL cloud (não requer Docker)
- **Redis**: Para filas de mensagens (port 6379)

## Prerequisites

1. Start Redis:
   ```bash
   docker run -d -p 6379:6379 redis:alpine  # Redis para filas
   ```
2. Set up `.env` from `.env.example` in each package
3. Required env vars in api-cobranca:
   - `DATABASE_URL`, `DIRECT_URL`
   - `DATAFY_API_TOKEN` (`sk_live_`), `DATAFY_WEBHOOK_SECRET` (`whsec_`), `DATAFY_WEBHOOK_BASE_URL` (obrigatórias em produção)
   - `META_PHONE_NUMBER_ID`, `META_BUSINESS_ACCOUNT_ID` (IDs da WABA, conferidos contra o `/me` do Datafy)
   - `COMMUNICATION_MEDIA_DIR`, `COMMUNICATION_MEDIA_LIMIT_BYTES` (anexos cifrados, opcionais)
   - `PAYMENT_ENCRYPTION_KEYS`, `PAYMENT_ACTIVE_KEY_VERSION` (credenciais e certificados dos clientes cifrados no banco)
   - `EFI_PLATFORM_PAYEE_CODE`, `EFI_PLATFORM_ACCOUNT_NUMBER`, `EFI_PLATFORM_CNPJ` (conta CifraMais que recebe a remuneração por split)
   - `EFI_OPENING_ENABLED` (`false` enquanto a API de abertura não for liberada; ativação manual pelo admin)
   - `EFI_WEBHOOK_BASE_URL` (Pix, mTLS) e `EFI_CHARGES_WEBHOOK_BASE_URL` (Cobranças)
   - `PLATFORM_ALERT_EMAIL` (alertas de certificado)
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
| POST | `/webhooks/datafy` | Mensagens, status e templates do WhatsApp (assinatura Datafy) |
| POST | `/webhooks/efi/pix` | Notificações de pagamento Pix |
| POST | `/webhooks/efi/cobrancas` | Notificações de cobranças/boleto (`account=` identifica a conta emissora) |
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
- `api-cobranca/src/whatsapp/` - Transporte Datafy, envios e templates (ver `transport/README.md`)
- `infra/interserver/DATAFY.md` - Publicação na VPS e configuração do Datafy
- `api-cobranca/src/financial-activation/` - Ativação financeira manual (perfil, credenciais, validação, elegibilidade)
- `api-cobranca/src/settlements/` - Lançamentos e conciliação
- `docs/operations/financial-activation.md` - Runbook de ativação, emissão e conciliação

## Removed Files

- `front-cobranca/docker-compose.yml` - Redundant (use api-cobranca/)
- `front-cobranca/src/lib/prisma.ts` - Not needed in frontend
- `front-cobranca/src/lib/billing.ts` - Moved to backend
- `front-cobranca/src/lib/auth-utils.ts` - Moved to backend
