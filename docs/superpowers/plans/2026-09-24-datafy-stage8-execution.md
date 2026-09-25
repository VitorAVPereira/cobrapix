# Execução da etapa 8 — verificação integrada e preparação da publicação

Plano: `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`, somente etapa 8.

> Atualização 25/09/2026: a Meta direta foi removida ([Datafy exclusivo](2026-09-25-datafy-only-execution.md)). As menções abaixo a `META_DIRECT`, ao webhook Meta e à publicação em duas janelas descrevem o estado desta etapa, não o atual.

## Decisões

- Ruling: continuar no checkout `dev`, sem commit, deploy ou mensagem real. Toda verificação roda em PostgreSQL 16 e Redis 7 descartáveis (containers rotulados, portas aleatórias em 127.0.0.1, senhas geradas) e com o provedor simulado por `fetch`; nenhuma URL de produção é lida.
- Ruling: o e2e usa um runner próprio (`test/e2e-disposable.cjs`) que cria os containers, aplica as 33 migrations e sobrescreve `DATABASE_URL`/`DIRECT_URL`/`REDIS_*` para o Jest. A spec recusa rodar sem a marca `CIFRAMAIS_DISPOSABLE_E2E` e monta o módulo com `ignoreEnvFile`. Limpeza no `finally` e também em SIGINT/SIGTERM, só de containers com o rótulo da execução.
- Ruling: `DATAFY_WEBHOOK_SECRET_PREVIOUS` (opcional) permite rotação sem perda: durante a troca o webhook aceita assinatura do segredo atual ou do anterior. A inicialização recusa anterior sem o atual, igual ao atual ou fora do formato `whsec_`.
- Correção encontrada pelo e2e (defeito da etapa 3, ainda não publicado): `app.use('/webhooks/datafy', json())` criava uma camada chamada `jsonParser`, e o Nest deixava de registrar o parser JSON global; login e todas as rotas JSON recebiam corpo vazio. O parser da rota agora é um wrapper nomeado (`datafyBodyParser`), com teste de regressão que documenta a causa.
- Correção: `POST /webhooks/meta` respondia 201; agora 200, como a Meta espera.
- Ruling: `package.ps1` recusa gerar pacote com arquivo do backend alterado ou não versionado (o pacote seleciona por `git ls-files` e omitiria migrations novas em silêncio), grava `RELEASE` (`AAAAMMDD-<commit>`) no pacote e inclui `backup.sh` e `DATAFY.md`. Usa o `tar.exe` do Windows explicitamente.
- Ruling: publicação em duas janelas (runbook `infra/interserver/DATAFY.md`): A publica o código mantendo `META_DIRECT`; B troca para `DATAFY` com a fila Meta vazia e o canal pausado, porque intenções criadas em outro transporte vão para revisão e nunca são reenviadas automaticamente.
- Limitação registrada: o teste de fumaça antigo `test/cobrapix-flow.e2e-spec.ts` (anterior a esta frente) está desatualizado em relação ao ciclo de cobrança com taxa e conta Efí por empresa (commit `460d5e8`). Foram corrigidos DI do `EmailService`, CPF obrigatório, perfil de cobrança padrão e o estado inicial `DRAFT`; a geração da cobrança agora exige conta Efí ativada (`EFI_ONBOARDING_REQUIRED`). Reescrever o fixture Efí fica fora do escopo (não alterar Efí por causa do WhatsApp). As regressões de cobrança/Efí seguem cobertas pelos unitários e por `payment-postgres.cjs`.

## Checklist

- [x] Cenário completo com dois tenants e um telefone: cobrança pela fila real e worker, webhook citado, webhook ambíguo, classificação, resposta admin, leitura isolada e anexo protegido.
- [x] Eventos repetidos, status invertidos (termina `read`), worker interrompido com job perdido no Redis e recuperado pelo PostgreSQL, erro após aceitação externa (`UNCERTAIN`, sem novo envio). Mensagens, intenções, contadores e auditoria conferidos.
- [x] Modo direto e Datafy; rotação do segredo com recebimento pelos dois durante a transição; eventos Datafy e Meta do mesmo `wamid` deduplicados sem depender do nome do transporte.
- [x] Regressões: suíte unitária completa (cobrança/primeiro envio, opt-out, templates, Efí, Resend, autenticação) e harnesses PostgreSQL. Nenhuma chamada externa real.
- [x] Retenção e leitura paginada por índice; consultas A/B e ingestão medidas com 50 mil conversas e 400 mil mensagens sintéticas.
- [x] Release identificável, migrations revisadas (aditivas), exemplos de ambiente sem segredos, backup testado com restauração e runbook.

## Entregas

- `api-cobranca/test/datafy-communications.e2e-spec.ts` (11 cenários) e `test/e2e-disposable.cjs`; script `npm run test:e2e:datafy`.
- `test/datafy-volume-postgres.cjs` (volume, `EXPLAIN` e ingestão) e `test/backup-restore-postgres.cjs` (dump, tar, restauração em banco e diretório novos, leitura com as chaves originais e recusa com outras).
- `src/webhooks/datafy-body-parser.ts` (+ spec), `main.ts`, rotação em `datafy-webhook.service.ts` e `env.validation.ts` (+ specs), `HttpCode(200)` no webhook Meta.
- Infra: `infra/interserver/backup.sh`, `DATAFY.md`, `package.ps1`, `api.env.example`, referência no `README.md`; `.env.example` do backend atualizado.

## Revisão das migrations

`20260923180000_datafy_communication_context`, `20260924120000_datafy_webhook_recovery`, `20260924180000_datafy_outbound_dispatch`, `20260924210000_datafy_tenant_attribution`, `20260924230000_datafy_communication_media`:

- Somente `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, `ADD COLUMN` (anuláveis ou com `DEFAULT`), chaves estrangeiras e `CHECK` em colunas novas. Nenhum `DROP`, `UPDATE`, `DELETE`, `RENAME` ou troca de tipo; nenhum seed.
- Índices em `CommunicationMessage` existente são criados sem `CONCURRENTLY` (bloqueio curto de escrita); aplicar fora do horário das cobranças agendadas.
- Migração sobre dados legados comprovada por `communications-postgres.cjs` (mensagens existentes ficam `LEGACY`, sem atribuição). A imagem anterior continua funcionando sobre o banco migrado, o que permite retorno sem restaurar backup.

## Medições (dados sintéticos, sem promessa de capacidade da VPS)

PostgreSQL 16 descartável com 1,5 GiB de RAM e `shared_buffers=256MB`; 50 mil conversas, 400 mil mensagens, ~10 mil anexos (empresa A: 18.572 mensagens em 4.643 conversas).

| Consulta | `EXPLAIN ANALYZE` | Serviço (mediana) |
| --- | --- | --- |
| Conversas da empresa, 1ª/5ª página | 60 ms | ~40 ms |
| Mensagens da conversa (`tenant_conversation_cursor_idx`) | 0,13 ms | ~5,4 ms |
| Pendências de classificação (admin) | 58 ms | ~110 ms (contagem domina) |
| Retenção, limpeza de anexos, resposta por ID externo, respostas dependentes | < 0,2 ms, index scan | — |
| Fila de mídia (bitmap em estado/data) | 0,77 ms | — |
| Uso de mídia (seq scan em anexos) | 1,9 ms | — |

Ingestão: 5,8 ms por entrega até persistir; 229 mensagens/s processadas com concorrência 4; RSS +178 MB incluindo aquecimento. PostgreSQL 367 MiB de RAM; banco 407 MB (mensagens 371 MB); carga de dados 61 s.

## Como validar

```powershell
# api-cobranca
npm run prisma:generate
npm test -- --runInBand
npm run test:e2e:datafy
node test/communications-postgres.cjs
node test/backup-restore-postgres.cjs
node test/datafy-volume-postgres.cjs
npx eslint src test/*.ts
npm run build

# front-cobranca
npx jest --runInBand
npm run lint
npm run build
```

## Verificação

- Backend: 85 suítes / 553 testes; `nest build` sem erros; ESLint sem erros em `src` e nos testes `.ts`. Os scripts `.cjs` de harness não fazem parte do projeto TypeScript e o ESLint os reporta como erro de parsing (situação anterior, igual para `payment-postgres.cjs`).
- E2E Datafy em infraestrutura descartável: 11/11 (~16 s), containers removidos ao final.
- `communications-postgres.cjs` (33 migrations, inclui webhook, envio, conversas por empresa e mídia): PASS. `payment-postgres.cjs`: PASS. `backup-restore-postgres.cjs`: PASS (anexo decifrado após restauração com as chaves originais e recusado, 422, com outras).
- Frontend: 35 suítes / 123 testes; `next build` e lint sem erros (1 aviso antigo em `InvoiceTable.tsx`, TanStack Table).
- `package.ps1`: recusou o checkout atual (102 arquivos do backend pendentes); em worktree limpa do `HEAD` gerou o pacote com `RELEASE`, `backup.sh`, `DATAFY.md` e migrations. `backup.sh` passa em `bash -n`, com finais LF.
- Smoke antigo `cobrapix-flow.e2e-spec.ts`: falha em `EFI_ONBOARDING_REQUIRED` (ver Decisões); não bloqueia esta etapa.
- Não verificado (depende da VPS e do painel Datafy): token e `/me` reais, entrega real do webhook, download real de mídia, capacidade da VPS. Passos no runbook.
