# Execução — etapa 2 do plano Datafy

Plano: `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`.

## Escopo e decisões

- Somente schema, migração aditiva, contratos de contexto e serviços internos de persistência; sem endpoints, envio, workers, UI ou deploy.
- Ruling: continuar no checkout `C:\micro-saas`, branch `dev`, conforme preferência já expressa pelo usuário. Preservar a etapa 1 e alterações anteriores de Efí/infra.
- Ruling: histórico recebe origem `LEGACY`; canal, atribuição e timestamps não comprováveis permanecem nulos. Não inferir empresa nem reescrever retenção. Não há backfill de vínculos por telefone.
- Ruling: consultas globais dos serviços internos são necessárias para o canal compartilhado; contextos de empresa usam filtros e FKs. Classificação manual exige administrador confirmado no banco; não há rota pública nova nesta etapa.
- Pre-flight: a etapa 3 consumirá a tabela de entregas e a etapa 4 consumirá intenções. As estruturas preparadas aqui não substituem ainda os escritores/filas existentes.
- Ruling: gerar SQL com `prisma migrate diff` entre o schema anterior e o novo, ambos locais, e aplicar no PostgreSQL descartável — evita que `migrate dev` alcance o `DIRECT_URL` configurado no projeto. Nenhuma migration foi aplicada na VPS.
- Ruling: `reserve` apenas persiste e devolve o estado; não é autorização para transmitir. A aquisição de trabalho e o tratamento de `UNCERTAIN` pertencem à etapa 4. O consumidor futuro precisa respeitar esse contrato para não duplicar envios.

## Implementação

- Migration `20260923180000_datafy_communication_context`: campos de mensagem, quatro tabelas novas, enums, índices de consulta e unicidade, FKs e checks de integridade. Preserva os campos antigos e a identidade da conversa por canal/destinatário, independente do transporte.
- `message-context.ts`: telefone internacional com hash compatível com o legado; BSUID opaco com namespace próprio; contexto nullable; serialização JSON determinística sem descartar valores inválidos.
- `OutboundIntentService.reserve`: valida destinatário e vínculos no tenant; cria mensagem/intenção na mesma transação; unicidade no PostgreSQL resolve concorrência, sem mensagens órfãs. Payload e destinatário usam a criptografia existente. Mudanças de conteúdo, contexto ou transporte com a mesma chave retornam 409; reordenação de chaves JSON não altera a identidade. Repetição não estende retenção nem reinicia estado incerto.
- `CommunicationAttributionService.assignKnownContext`: primitiva interna para contexto já conhecido, com revisão esperada, validação do administrador no banco, vínculos e destinatário. Atualização e auditoria são atômicas; aceita contexto nulo e recusa modificar contexto de intenção existente. Nenhuma rota ou atribuição automática foi adicionada.
- Anexos e entregas têm persistência preparada; ingestão, download, limpeza e processamento permanecem nas etapas correspondentes.

## Como validar localmente

No diretório `api-cobranca`, com Docker Desktop Linux iniciado e a imagem `postgres:16-alpine` disponível:

```powershell
npm run prisma:generate
npm run test:communications:postgres
npm test -- --runInBand
npm run build
```

O harness cria um container com nome, credencial e etiqueta exclusivos, publica PostgreSQL somente em `127.0.0.1` numa porta aleatória e remove apenas o container/volume criado por aquela execução após conferir sua etiqueta. Não usa `DATABASE_URL`, `DIRECT_URL`, contexto remoto Docker ou credenciais da aplicação. A criptografia recebe uma chave aleatória de teste. Os primeiros 28 scripts SQL são aplicados antes das fixtures; a nova migration é aplicada sobre esse histórico. Não executa seed/reset de bancos existentes.

Para uso futuro, `context` pode ser vazio ou conter `companyId`, `invoiceId` e `debtorId`. Cobrança/devedor exigem empresa; cobrança resolve seu devedor e ambos são validados contra o destinatário. BSUID sem identidade conciliada permanece sem empresa. `reserve` recebe conversa existente, destinatário tipado, transporte/ID estável do canal, chave idempotente, conteúdo/tipo/payload e expiração; retorna apenas ID da intenção, mensagem, estado e expiração. Não retorna dados criptografados nem envia mensagens.

As tabelas adicionais precisam existir antes de executar a nova imagem do backend contra o banco definitivo. Essa aplicação será feita pelo roteiro de deploy, com `prisma migrate deploy`, não pelo harness. O transporte da VPS continua como estava; esta etapa não habilita o fluxo Datafy completo.

## Verificação

- Baseline: 65 suítes / 395 testes passaram.
- Docker local iniciado para PostgreSQL descartável; nenhum banco existente ou da VPS será usado.
- RED observado: o harness falhou pela ausência de `CommunicationWebhookDelivery` antes da migration; o teste de identidade falhou pela ausência do helper antes da implementação.
- PostgreSQL 16: 29 migrations, histórico A/B/sem empresa preservado; oito reservas concorrentes geram uma intenção/mensagem; cinco entregas simultâneas geram uma entrega; conflitos de conteúdo/contexto/transporte; FKs entre empresas; revisão concorrente; rollback quando a auditoria falha; anonimização; retenção; estado incerto; BSUID; anexos e paginação com filtro de empresa passaram.
- Prisma Client gerado e `npm run build` passou.
- Revisão independente somente leitura: sem achados críticos, importantes ou menores no escopo da etapa 2.
- Final: Ruling: autenticação/ingestão/recuperação/ordenação de eventos (3), envio/limites/troca dos escritores (4), resolução de referências/API/autorização de cursores/projeções (5), mídia e expiração dos arquivos (7), limpeza e deploy continuam nas etapas previstas. A revisão não atesta esses fluxos como prontos; o custo de antecipar seu uso seria operar sem as proteções posteriores. Alterações anteriores de Datafy, Efí e infra também ficaram fora desta revisão.
- Suíte geral: `npm test -- --runInBand` — 66 suítes / 403 testes passaram (24/09/2026).
- ESLint dos cinco arquivos TypeScript novos/alterados nesta etapa, `node --check test/communications-postgres.cjs` e `git diff --check` passaram.
- Etapa 2 concluída e checklist atualizado. Alterações mantidas no checkout local, sem commit, push ou deploy; nenhuma etapa posterior foi implementada.
