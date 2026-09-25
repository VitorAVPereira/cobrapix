# Execução — etapa 1 do plano Datafy

Plano: `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`.

## Escopo e decisões

- Implementar somente transporte e configuração, conforme pedido de 23/09/2026.
- Ruling: trabalhar no checkout `C:\micro-saas`, branch `dev`, conforme “implementar aqui”; preservar alterações anteriores. Sem publicação ou commit nesta tarefa.
- Ruling: a referência a `/webhooks/datafy` na etapa 1 define a configuração futura; a rota pertence à etapa 3. Nesta etapa o status Datafy informa que o recebimento ainda não está implementado.
- Ruling: ao dispensar `META_APP_SECRET` no modo Datafy, o webhook Meta existente deve recusar pedidos sem segredo. Isso evita transformar a validação condicional em um endpoint de produção sem autenticação.
- Ruling: quotas comerciais por empresa não são substituídas pelo tier do número compartilhado. A consulta do canal usa o transporte; atualizar a quota da empresa a partir dele não seria uma simples mudança de transporte.
- Pre-flight: transporte será consumido pelas futuras etapas 3/4; contratos expõem IDs e resultados seguros/incertos, sem implementar persistência, filas novas, webhooks Datafy ou UI agora.

## Verificação

- Baseline backend: `npm test -- --runInBand` — 60 suítes e 351 testes passaram.
- Testes RED iniciais: 12 falhas de contrato esperadas (modo Datafy, validação e saúde); regressão de assinatura e consulta do tier também reproduzidas antes da correção.
- Teste de segurança adicional reproduziu vazamento de texto arbitrário em `fbtrace_id`; erros agora preservam somente códigos numéricos do provedor.
- Etapa 1 concluída: `npm test -- --runInBand` — 65 suítes e 395 testes passaram. Requisições externas foram simuladas; nenhum disparo real ou alteração da VPS.
- `npm run build` — passou, incluindo geração do Prisma Client, sem migrations.
- ESLint nos arquivos alterados e módulo WhatsApp — passou sem erros ou avisos.
- `git diff --check` — passou. Diferenças anteriores de Efí e `.gitignore` preservadas.
- Revisão independente de código: nenhum achado acionável na etapa 1.
- Revisão: envio incerto ainda pode ser repetido pelo worker existente e o catálogo ainda consome a primeira página. Ruling: manter as implementações de idempotência persistente e paginação completa na etapa 4, conforme escopo explícito; Datafy não deve operar cobranças na VPS antes da fundação completa. README e exemplos de ambiente registram esse limite.

## Limitação de verificação anterior à etapa

`npx tsc --noEmit --incremental false`, que inclui também arquivos de teste,
permanece com 12 erros em cinco arquivos sem alterações nesta etapa:

- `src/admin/admin.service.spec.ts:179`: fixture com enum aberto como string.
- `src/billing/billing.service.spec.ts:2,289`: import terminado em `.ts` e valor opcional.
- `src/invoices/invoices.service.spec.ts:1`: import terminado em `.ts`.
- `src/queue/workers/message.worker.spec.ts:116,119,122,125`: assinaturas de mocks.
- `src/webhooks/webhooks.controller.spec.ts:35,87,88,91`: assinatura de mock e método opcional em reflexão.

Esses arquivos não foram modificados; a compilação de produção e a execução Jest
completa passam. Nenhum erro de tipagem reportado nos arquivos da etapa 1.

## Arquivos e uso

Contrato e configuração: `api-cobranca/src/whatsapp/transport/README.md`.
Endpoint de teste restrito ao admin: `POST /whatsapp/admin/test-integration`.
Padrão preservado: `WHATSAPP_TRANSPORT=META_DIRECT`.
Mudanças permanecem no checkout local, sem commit, push ou deploy.
