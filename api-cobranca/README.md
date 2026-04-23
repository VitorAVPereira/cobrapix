# api-cobranca

Backend NestJS do CobraPix. Irmao do `../front-cobranca` (Next.js).

## Estrutura

```text
src/
├── config/env.validation.ts     # Validacao zod das env vars
├── prisma/                      # PrismaService global
├── health/                      # GET /health
├── templates/                   # CRUD de MessageTemplate
├── app.module.ts
└── main.ts                      # Porta 3001 configuravel via PORT
```

## Comandos

```bash
npm run dev           # nest start --watch (sobe em :3001)
npm run build         # producao (dispara prisma:generate antes)
npm run start:prod    # node dist/main
npm test              # Jest
npm run lint

# Prisma
npm run prisma:generate
npm run prisma:migrate -- --name <nome>
npm run prisma:deploy
npm run prisma:studio
```

## Schema do Prisma

O schema canonico e `prisma/schema.prisma`. O Prisma pertence exclusivamente ao backend NestJS; o frontend consome dados pela API e nao mantem schema, migrations, seed ou Prisma Client.

Quando mudar o schema:

```bash
cd ../api-cobranca
npm run prisma:migrate -- --name <nome>
npm run prisma:generate
```

## Endpoints

- `GET /health` retorna status geral da API.
- `GET/POST/PUT /templates` gerencia templates de mensagem por empresa autenticada.

## Environment

Copie `.env.example` para `.env` e configure `DATABASE_URL`, `DIRECT_URL`, Evolution API, Asaas e Redis.

## Porta

Default `3001`. Configuravel via `PORT` no `.env`.
