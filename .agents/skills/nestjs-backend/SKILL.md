---
name: nestjs-backend
description: Acionada ao criar ou modificar Controllers, Services, Modules, Guards ou integrações no backend do CobraPix (NestJS).
---
# NestJS Architecture & Security Rules
- Siga o padrão modular estrito. Services contêm a regra de negócios, Controllers apenas validam e roteiam.
- MULTI-TENANCY OBRIGATÓRIO: Toda e qualquer consulta ao banco de dados (Prisma) DEVE conter a restrição `where: { companyId }`. Nunca faça um `findMany`, `update` ou `delete` sem filtrar a empresa do usuário logado.
- Proteja as rotas com `@UseGuards(JwtAuthGuard)` e recupere o usuário utilizando o decorator customizado `@GetUser()`.
- Segurança Anti-Vazamento: Nunca trafegue tokens de API, JWT Secrets ou chaves criptográficas em texto plano ou logs de console.