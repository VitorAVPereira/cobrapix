# Correção das réguas para o catálogo global

`GET /billing/rules` é usado por Clientes e Régua de cobrança. Ao criar os
perfis iniciais, o serviço recebia IDs de `GlobalMessageTemplate`, mas a chave
estrangeira de `CollectionRuleStep.templateId` ainda apontava para
`MessageTemplate`. Isso causava P2003 / HTTP 400 / "Referencia invalida".

A correção usa o catálogo global na persistência, na validação das escolhas e
na resolução do template para WhatsApp e e-mail. A personalização continua
restrita à empresa. Requisições simultâneas reutilizam os perfis iniciais.

## Publicação na VPS

1. Faça commit da correção, incluindo a nova migração, antes de gerar o pacote
   com `infra/interserver/package.ps1`. Envie e extraia em uma pasta nova,
   seguindo o [procedimento de publicação](../../infra/interserver/README.md).
2. Pause os disparos durante a manutenção. Faça um backup atualizado do banco,
   anexos e segredos, valide a restauração e mantenha uma cópia fora da VPS.
3. Antes da migração, execute esta consulta na pasta da release, na VPS:

   ```bash
   sudo bash infra/interserver/compose.sh exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
   SELECT COUNT(*) AS vinculos_que_exigem_revisao
   FROM "CollectionRuleStep" step
   JOIN "CollectionProfile" profile ON profile."id" = step."profileId"
   JOIN "MessageTemplate" legacy ON legacy."id" = step."templateId"
   LEFT JOIN "GlobalMessageTemplate" catalog ON catalog."slug" = legacy."slug"
   WHERE catalog."id" IS NULL OR legacy."companyId" <> profile."companyId";
   SQL
   ```

   O resultado precisa ser **zero**. Havendo vínculos sem correspondência,
   revise a escolha do template antes de prosseguir. Não copie conteúdo
   particular de uma empresa para o catálogo compartilhado como atalho.
4. Preserve a imagem anterior, faça o build e valide o ambiente da nova API.
   Pare somente a API antes de aplicar
   `20260927130000_collection_rules_global_templates` com `prisma migrate deploy`.
   Confira `prisma migrate status`. A migração troca os IDs antigos pelos globais
   com o mesmo `slug`, mantendo perfis, etapas e tentativas. Tudo ocorre em uma
   transação; uma correspondência ausente interrompe a migração sem alterar dados.
5. Recrie somente a API com `compose.sh up -d --no-deps --wait --wait-timeout 180 api`.
   Teste a configuração do Nginx (`nginx -t`) e recarregue-o (`nginx -s reload`)
   dentro do container, pois o endereço interno da API pode ter mudado.
6. Confira `/health`, abra Clientes e Régua de cobrança e confirme HTTP 200
   em `/billing/rules` no navegador autenticado. Salve uma régua de teste e
   recarregue a página para conferir a seleção dos templates.

Não basta republicar o frontend. Após trocar a chave estrangeira, voltar
somente à imagem antiga também não é um rollback compatível: ela ainda consulta
a tabela antiga. Prefira uma correção adicional; se for necessário restaurar,
planeje a volta conjunta do banco e da API usando o backup da manutenção.

## Testes locais

Dentro de `api-cobranca`:

```bash
npm run prisma:generate
npx jest --runInBand src/billing/billing.service.spec.ts src/billing/collection-profile.service.spec.ts
npm run test:collection-rules:postgres
```

O último teste exige Docker local e cria um PostgreSQL 16 descartável, com senha
aleatória e porta publicada apenas em `127.0.0.1`. Ignora `DATABASE_URL` e
`DIRECT_URL`, não envia mensagens e remove somente o container que criou.
Verifica a migração, a preservação do histórico, leituras concorrentes, gravação
dos templates e rejeição de alterações entre empresas.
