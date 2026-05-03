### 🛠️ 1. Tech Stack (O Ecossistema)

- **Frontend:** Next.js (App Router), React, TypeScript (Strict Mode, sem tipagem `any`), Tailwind CSS, `lucide-react` (ícones). Hospedado em ambiente Serverless (Vercel).
    
- **Backend:** NestJS (Node.js framework), TypeScript. Hospedado em VPS (Ubuntu/Docker).
    
- **Database (Relacional):** PostgreSQL (Neon DB - Serverless Postgres).
    
- **ORM:** Prisma (Tipagem estática ponta a ponta).
    
- **In-Memory & Queues:** Redis (Bancos lógicos separados: ex. `/0` para cache, `/1` para filas) e BullMQ (processamento assíncrono).
    
- **Contêinerização:** Docker e Docker Compose para padronização do ambiente do Backend e Redis.
    

---

### 🏛️ 2. Arquitetura de Software e Padrões

- **Micro-serviços Isolados:** Separação clara entre a API principal (NestJS), a UI (Next.js) e os Workers de Fila (BullMQ) operando em processos assíncronos para não bloquear o Event Loop.
    
- **Fallback Hierárquico (Configurações):** O padrão "Configuration over Hardcoding" foi implementado via Arrays e Enums no Prisma.
    
    - A entidade `Company` define `allowedPaymentMethods: PaymentMethod[]` (ex: `[PIX, BOLIX]`).
        
    - A entidade `Debtor` possui `overridePaymentMethods: PaymentMethod[]`. Se preenchido, sobrescreve a regra global no momento da geração da fatura.
        
- **Imutabilidade de Faturas (Snapshotting):** As taxas de gateway e SaaS não são calculadas em _runtime_ durante o pagamento. No momento da emissão da cobrança, o `BillingService` tira um "snapshot" da configuração atual e salva os valores absolutos na entidade `Invoice`, garantindo segurança em auditorias.
    
- **Componentização UI:** Front-end utiliza renderização condicional pesada (ex: `isUploadingCSV` em `cobrancas/page.tsx` alternando entre `InvoiceTable` e `UploadCSV`) para manter o estado da página (SPA feel) sem recarregamentos desnecessários.
    

---

### 🔌 3. Integrações Externas e APIs

- **Motor de Mensageria (Meta Cloud API):**
    
    - Integração direta via requisições HTTP RESTful oficiais.
        
    - Autenticação via _Permanent Token_ do Business Manager.
        
    - O backend expõe uma rota `/webhooks/meta` para receber eventos (ex: `delivered`, `read`) da Meta.
        
    - Remoção completa de dependências de scraping web (Baileys/Puppeteer/Evolution API).
        
- **Motor Financeiro de BaaS (Efí Bank):**
    
    - Integração baseada em mTLS (Mutual TLS). O NestJS é configurado para carregar certificados `.p12` na construção da requisição via SDK ou Axios customizado.
        
    - Utilização dos endpoints de criação de subconta White-Label e geração de cobrança com payload de **Split de Pagamento Atômico** embarcado na requisição.
        

---

### ⚙️ 4. Fluxos Assíncronos e Processamento (BullMQ)

- **Upload em Massa (CSV Parser):** O endpoint de upload recebe o arquivo, armazena no buffer (ou S3/Storage) e joga o ID para uma fila. Um _Worker_ consome a fila, aplica o `class-validator` nas linhas, aplica a lógica de _fallback_ de métodos de pagamento e faz `insertMany` no banco.
    
- **Motor de Disparo (Cron & Queues):**
    
    - Um CronJob no NestJS acorda diariamente.
        
    - Realiza uma query buscando faturas ativas cruzando com a tabela `MessageTemplate` (Régua de Cobrança).
        
    - Cria _Jobs_ no BullMQ para cada devedor.
        
    - O _Worker_ de disparo consome a fila, resolve o Spintax (variáveis dinâmicas), gera o link de pagamento na Efí (se não existir), e dispara o POST para a Meta Cloud API.
        

---

### 🛡️ 5. Resiliência de Ambiente e DevOps

- **Gestor de Pacotes:** `packageManager: "npm@latest"` forçado no `package.json` para estabilizar ambientes de _sandbox_ de agentes LLM via Corepack.
    
- **Isolamento de Tenant:** Todas as queries do Prisma nos serviços _core_ exigem `companyId` obrigatório no predicado `where`, prevenindo vazamento de dados (Cross-Tenant Data Leak).
    
- **Rate Limiting:** Prevenção de estouro de requisições na API da Efí e Meta através de controle de concorrência (`concurrency` limit no BullMQ).