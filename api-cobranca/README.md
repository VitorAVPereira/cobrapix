# api-cobranca

Backend NestJS do CobraPix. Irmão do `../front-cobranca` (Next.js).

## Estrutura

```
src/
├── config/env.validation.ts     # Validação zod das env vars
├── prisma/                      # PrismaService global (Neon serverless adapter)
├── health/                      # GET /health (indicators: Database + Evolution API)
├── app.module.ts
└── main.ts                      # Porta 3001 (configurável via PORT)
```

## Comandos

```bash
npm run dev           # nest start --watch (sobe em :3001)
npm run build         # produção (dispara prisma:generate antes)
npm run start:prod    # node dist/main
npm test              # Jest
npm run lint

# Prisma
npm run prisma:generate   # copia schema do front + prisma generate
npm run prisma:sync-schema # apenas sincroniza o schema
```

### Schema do Prisma

O schema canônico é `../front-cobranca/prisma/schema.prisma`. Esse schema é copiado para `prisma/schema.prisma` automaticamente (via `postinstall`, `predev` e `prebuild`) e usado para gerar o client local em `node_modules/@prisma/client`. **Não edite** `api-cobranca/prisma/schema.prisma` — ele é regenerado.

Quando mudar o schema:

```bash
cd ../front-cobranca && npx prisma migrate dev --name <nome>
cd ../api-cobranca && npm run prisma:generate
```

## Endpoints

- `GET /health` — status 200 (healthy/degraded) ou 503 (unhealthy). Shape: `{ status, timestamp, checks[] }`.

## Environment

Copie `.env.example` para `.env`. A `DATABASE_URL` é a mesma do front (único Neon).

## Porta

Default `3001`. Configurável via `PORT` no `.env`.
