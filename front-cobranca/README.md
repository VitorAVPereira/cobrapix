# front-cobranca

Frontend Next.js do CobraPix. Esta aplicacao entrega a experiencia do lojista e consome exclusivamente a API NestJS em `../api-cobranca`.

## Arquitetura

- Next.js 16 App Router com TypeScript strict mode.
- NextAuth v5 para sessao do lojista.
- TailwindCSS v4 para UI.
- `src/lib/api-client.ts` como cliente HTTP central da API NestJS.
- Sem Prisma no frontend: nenhum schema, migration, seed, Prisma Client ou acesso direto ao banco.

## Setup Local

1. Configure e suba o backend em `../api-cobranca` na porta `3001`.
2. Configure `NEXT_PUBLIC_API_URL` se a API nao estiver em `http://localhost:3001`.
3. Configure `AUTH_API_URL` quando o servidor Next.js precisar chamar a API por uma URL interna diferente.
4. Instale dependencias e rode o front:

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## Comandos

```bash
npm run dev
npm run build
npm run start
npm run lint
npx jest
```

## Fluxo de Dados

- Autenticacao, faturas, WhatsApp, pagamentos, templates e webhooks vivem no backend.
- O frontend persiste templates de cobranca por `/templates`.
- Alteracoes de banco devem ser feitas somente em `../api-cobranca/prisma/schema.prisma`.

## Credenciais de Desenvolvimento

Apos executar o seed no backend:

- Email: `admin@cobrapix.com`
- Senha: `senha123`
