# Princípios de Desenvolvimento (CobraPix)

### 1. Qualidade de Código
- **Tipagem Estrita:** Proibido o uso de `any`. Toda função deve ter tipos de entrada e saída definidos.
- **Clean Code:** Priorizar funções pequenas, nomes de variáveis semânticos e o princípio de responsabilidade única (SRP).
- **Testes:** Todo novo Service ou Controller no NestJS deve vir acompanhado de testes unitários em Jest.

### 2. Segurança
- **Multi-tenancy:** Toda e qualquer consulta ao banco de dados DEVE incluir o filtro por `companyId` para evitar vazamento de dados entre clientes.
- **Validação:** Usar `class-validator` e `Pipes` no NestJS para validar rigorosamente todo dado que chega das APIs.
- **Sensitive Data:** Nunca trafegar ou registrar em logs chaves de API ou segredos (usar variáveis de ambiente).

### 3. Escalabilidade
- **Arquitetura Assíncrona:** Tarefas pesadas (disparos de 6.000+ mensagens) devem obrigatoriamente usar Filas (BullMQ/Redis) para não travar o event loop.
- **Performance de Banco:** Evitar consultas N+1. Usar `include` ou `select` do Prisma de forma consciente para otimizar o consumo do Neon Database.
- **Processamento em Lotes:** Uploads de arquivos grandes devem ser processados em chunks (pedaços) para evitar estouro de memória ou timeouts.