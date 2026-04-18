# CobraPix - Plataforma de Cobrança Automatizada via WhatsApp

SaaS B2B de automação de cobranças via WhatsApp, focado em clínicas e pequenos lojistas. MVP com arquitetura multi-tenant, tipagem estrita em TypeScript e custo zero de infraestrutura local.

## 🏗️ Arquitetura

- **Frontend**: Next.js 16.2.3 (App Router) com TypeScript strict mode
- **Backend**: API Routes integradas no Next.js
- **Autenticação**: NextAuth v5 (beta) com estratégia credentials
- **Database**: Neon Database (PostgreSQL serverless - Free Tier)
- **ORM**: Prisma 7.7.0
- **WhatsApp**: Evolution API via Docker local
- **Estilização**: TailwindCSS v4
- **UI Components**: TanStack Table, Lucide Icons, react-dropzone

### Funcionalidades Implementadas

- ✅ Autenticação multi-tenant (Company + User)
- ✅ Upload de CSV com validação robusta
- ✅ Dashboard de cobranças com métricas e filtros
- ✅ Conexão WhatsApp via QR code
- ✅ Execução manual de cobranças via WhatsApp
- ✅ Webhook para Evolution API
- ✅ Logs de cobrança auditáveis
- ✅ Schema multi-tenant completo

## 🚀 Setup Local

### Pré-requisitos

- Node.js 20+ 
- Docker e Docker Compose
- npm, yarn ou pnpm
- Conta no Neon Database (Free Tier)

### 1. Configurar Neon Database

1. Acesse [console.neon.tech](https://console.neon.tech/)
2. Crie um projeto PostgreSQL
3. Copie a connection string
4. No arquivo `.env` (veja `.env.example` na raiz do projeto):

```bash
DATABASE_URL="postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

### 2. Configurar Variáveis de Ambiente

Copie o template de variáveis de ambiente:

```bash
cp ../.env.example .env
```

Edite o arquivo `.env` e preencha:
- `DATABASE_URL` e `DIRECT_URL` (do Neon)
- `EVOLUTION_API_KEY` (gerar uma chave aleatória)
- `EVOLUTION_JWT_SECRET` (gerar uma chave aleatória)
- `AUTH_SECRET` (gerar com `openssl rand -base64 32`)

### 3. Iniciar Evolution API (Docker)

Na raiz do projeto (`c:/micro-saas`):

```bash
docker-compose up -d
```

Verifique se o container está rodando:

```bash
docker-compose ps
```

A Evolution API estará disponível em `http://localhost:8080`

### 4. Instalar Dependências

```bash
cd front-cobranca
npm install
```

### 5. Executar Migrations do Prisma

```bash
npx prisma migrate dev
```

### 6. Executar Seed (Dados Iniciais)

```bash
npx prisma db seed
```

Isso criará:
- Empresa teste: `Empresa Teste MVP`
- Usuário admin: `admin@cobrapix.com` / `senha123`

### 7. Iniciar Servidor de Desenvolvimento

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000)

## 📁 Estrutura do Projeto

```
c:/micro-saas/
├── docker-compose.yml          # Orquestração Docker (Evolution API)
├── .env.example               # Template de variáveis de ambiente
└── front-cobranca/            # Aplicação Next.js
    ├── src/
    │   ├── app/
    │   │   ├── (dashboard)/   # Rotas protegidas
    │   │   │   ├── cobrancas/ # Dashboard de cobranças
    │   │   │   └── configuracoes/whatsapp/ # Configuração WhatsApp
    │   │   ├── api/          # API Routes
    │   │   │   ├── auth/     # NextAuth
    │   │   │   ├── billing/  # Execução de cobranças
    │   │   │   ├── invoices/ # Gestão de faturas
    │   │   │   ├── whatsapp/ # Integração WhatsApp
    │   │   │   └── webhooks/ # Webhooks externos
    │   │   ├── login/        # Página de login
    │   │   └── layout.tsx    # Layout raiz
    │   ├── components/
    │   │   ├── features/     # Componentes de negócio
    │   │   ├── providers/    # Providers React
    │   │   └── ui/           # Componentes UI reutilizáveis
    │   ├── lib/
    │   │   ├── auth.ts       # Configuração NextAuth
    │   │   ├── auth-utils.ts # Utilitários de autenticação
    │   │   ├── evolution.ts  # Cliente Evolution API
    │   │   ├── message-templates.ts # Templates de mensagens
    │   │   └── prisma.ts     # Cliente Prisma
    │   ├── middleware.ts     # Middleware de autenticação
    │   └── globals.css       # Estilos globais
    ├── prisma/
    │   ├── schema.prisma     # Schema do banco de dados
    │   ├── seed.ts           # Seed de dados iniciais
    │   └── migrations/       # Migrations do Prisma
    ├── package.json
    ├── tsconfig.json
    └── .env                  # Variáveis de ambiente (não commitar)
```

## 🔐 Credenciais de Desenvolvimento

Após executar o seed:

- **Email**: `admin@cobrapix.com`
- **Senha**: `senha123`

## 🧪 Testar Funcionalidades

### 1. Upload de CSV

Use o template disponível na página de importação ou crie um CSV com colunas:
- `Nome`, `WhatsApp`, `Email`, `Valor`, `Vencimento`

Exemplo:
```csv
Nome,WhatsApp,Email,Valor,Vencimento
João Silva,5511999999999,joao@email.com,150.50,2025-12-01
Maria Santos,5511888888888,maria@email.com,200.00,2025-12-05
```

### 2. Conectar WhatsApp

1. Acesse `/configuracoes/whatsapp`
2. Clique em "Gerar QR Code"
3. Escaneie com o WhatsApp do celular
4. Aguarde a confirmação de conexão

### 3. Executar Cobranças

1. Acesse `/cobrancas`
2. Clique em "Executar Cobrança"
3. Mensagens serão enviadas para devedores com faturas vencidas

## 🛠️ Comandos Úteis

```bash
# Desenvolvimento
npm run dev              # Inicia servidor Next.js
npm run build            # Build para produção
npm run start            # Inicia servidor de produção
npm run lint             # Executa ESLint

# Testes
npm run test             # Executa testes
npm run test:watch       # Executa testes em modo watch
npm run test:coverage    # Executa testes com coverage

# Prisma
npx prisma studio        # Abre UI do Prisma Studio
npx prisma migrate dev   # Cria e aplica migration
npx prisma migrate reset # Reseta banco (cuidado!)
npx prisma db seed       # Executa seed

# Docker
docker-compose up -d      # Inicia Evolution API
docker-compose down       # Para Evolution API
docker-compose logs -f    # Ver logs da Evolution API
docker-compose ps         # Status dos containers
```

## 🔧 Troubleshooting

### Evolution API não conecta

Verifique se o Docker está rodando:
```bash
docker-compose ps
docker-compose logs evolution-api
```

Teste a API:
```bash
curl http://localhost:8080/health
```

### Erro de conexão com banco

Verifique se `DATABASE_URL` está configurada corretamente no `.env`

### Webhook não recebe eventos

Verifique se `EVOLUTION_WEBHOOK_URL` está configurada como `http://host.docker.internal:3000/api/webhooks/evolution`

### QR Code não aparece

- Verifique se Evolution API está rodando
- Verifique logs do container: `docker-compose logs -f evolution-api`
- Tente desconectar e reconectar a instância

## 🚧 Roadmap

### Concluído (MVP)
- ✅ Docker Compose para orquestração local
- ✅ Health check migrado para serviço dedicado em `../api-cobranca` (NestJS, porta 3001)
- ✅ Cobranças automáticas via Vercel Cron (`/api/cron/billing`, schedule em `vercel.json`)
- ✅ Estrutura de testes (Jest + React Testing Library)
- ✅ Autenticação multi-tenant
- ✅ Upload CSV com validação
- ✅ Dashboard de cobranças
- ✅ Integração WhatsApp via QR code
- ✅ Execução manual de cobranças
- ✅ Webhook Evolution API
- ✅ Logs auditáveis

### Próximos Passos
- [ ] Integração com gateway de pagamento (Pix)
- [ ] Dashboard administrativo multi-tenant
- [ ] Relatórios e analytics
- [ ] Configuração de templates de mensagem personalizáveis
- [ ] Testes E2E (Playwright)
- [ ] CI/CD pipeline
- [ ] Deploy em produção

## 📄 Licença

Este projeto é proprietário. Todos os direitos reservados.

## 🤝 Suporte

Para questões técnicas, consulte a documentação ou entre em contato com a equipe de desenvolvimento.
