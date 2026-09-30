# Catálogo WhatsApp importado da Meta e liberações por empresa

Runbook da publicação que troca o catálogo interno de templates WhatsApp pelo
catálogo aprovado na Meta (importado pelo Datafy), com liberação por empresa,
padrões por finalidade e pendências revisadas pelo administrador.

**O que muda para quem opera**

| Antes | Depois |
| --- | --- |
| Templates WhatsApp criados/submetidos pelo painel da CifraMais | Criados e aprovados no WhatsApp Manager; o painel só importa, mapeia variáveis e libera |
| Toda empresa via o catálogo inteiro | Nenhuma empresa vê nada até a liberação pelo admin |
| Empresa personalizava saudação/instruções/assinatura no WhatsApp | Só leitura no WhatsApp; a personalização continua apenas no e-mail |
| Etapa sem template usava um fallback | Etapa usa o padrão da finalidade ou um template liberado; sem isso, a mensagem fica **pendente**, nunca é trocada |
| Avisos de ativação usavam `EFI_ONBOARDING_*_TEMPLATE` | Usam os padrões `ACTIVATION_NOTICE` e `ACTIVATION_REMINDER` da empresa |

Regras que o runbook não pode violar:

- Transporte somente pelo Datafy; nenhum passo chama a Meta diretamente.
- Nenhuma liberação ou padrão é criado automaticamente (nem pela migration, nem pela transição).
- Corrigir liberação/variáveis **não** retoma envios; só a confirmação do admin retoma.
- Envios `ACCEPTED`, `SENDING` ou `UNCERTAIN` nunca são retomados nem alterados.
- O e-mail continua com `GlobalEmailTemplate` e as preferências da empresa.
- Nenhum passo deste runbook dispara cobrança ou mensagem real automaticamente.

Convenções: blocos `powershell` rodam no Windows local, dentro do repositório;
blocos `bash` rodam na VPS como `deploy`, **um comando por vez**, avançando só sem
erro. Credenciais só em `/opt/ciframais/secrets/api.env`. Guarde apenas relatórios
sem dados sensíveis (os comandos abaixo imprimem só contagens e IDs de etapas).

## Migrations e transição

| Migration | Efeito | Pode falhar se |
| --- | --- | --- |
| `20260927140000_collection_rule_email_templates` | Etapas EMAIL passam a apontar para `GlobalEmailTemplate` (`emailTemplateId`) | Houver etapa EMAIL sem template de e-mail com o mesmo slug (lista os IDs e não altera nada) |
| `20260927150000_whatsapp_template_catalog_access` | Colunas do catálogo importado, revisões de variáveis, liberações, padrões, auditoria, estado da sincronização | — |
| `20260927160000_whatsapp_template_pending_sends` | Estado `BLOCKED`, resultado da transmissão, pendências e revisões de retomada | — |
| `20260927170000_whatsapp_rule_selection` | Etapas WhatsApp existentes ficam `UNCONFIGURED` (referência antiga e finalidade reconhecida preservadas) | — |

O script `dist/scripts/transition-whatsapp-templates.js` (npm `templates:transition`)
não inicia a API, cron, filas ou chamadas ao provedor:

| Modo | Escreve? | Quando | Saída esperada |
| --- | --- | --- | --- |
| `--preflight` | Não | Antes e depois das migrations; funciona no schema anterior | `canApply: true`, `blockers: []` (código de saída 2 se houver bloqueio) |
| `--apply` | Sim, idempotente | Depois das migrations, com o canal WhatsApp pausado e nenhum envio `SENDING` | Contagens de templates arquivados, etapas `UNCONFIGURED`, intenções retidas |
| `--verify` | Não | Depois do `--apply` | `ok: true`, `violations: []` (código 2 se houver violação) |

`--apply` arquiva o catálogo interno (`LEGACY_INTERNAL`), deixa `UNCONFIGURED` as
etapas que ainda apontem explicitamente para ele e transforma em pendência
(`LEGACY_PAYLOAD`) as intenções de template antigas que comprovadamente nunca foram
transmitidas (`PENDING` sem snapshot). Aceitas e incertas ficam intactas. Recusa
executar sem as migrations, com o canal ativo ou com envio `SENDING`. Repetir não
muda nada. Jobs antigos `send-message` ainda no Redis são retidos pelo worker como
`LEGACY_PAYLOAD` ao serem processados; padrões novos não os soltam.

## 1. Conferir commit, testes e gerar o pacote (Windows)

```powershell
git status --short
git log --oneline -1
npm --prefix api-cobranca test -- --runInBand
npm --prefix api-cobranca run build
Push-Location api-cobranca; npx eslint "src/**/*.ts" "test/**/*.ts"; Pop-Location
npm --prefix front-cobranca exec -- jest --runInBand
npm --prefix front-cobranca run build
npm --prefix front-cobranca run lint
```

Com Docker local (bancos e Redis descartáveis; nunca usam o `.env` nem a VPS):

```powershell
cd api-cobranca
npm run test:template-email-migration:postgres
npm run test:template-catalog:postgres
npm run test:template-pending:postgres
npm run test:template-transition:postgres
npm run test:collection-rules:postgres
node test/e2e-disposable.cjs template-access.e2e-spec.ts template-catalog-flow.e2e-spec.ts datafy-communications.e2e-spec.ts
cd ..
```

**Parar** se algum comando falhar ou se `git status` mostrar alteração do backend.
Gere e envie o pacote (preserve antes um pacote anterior que ainda sirva de volta):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\micro-saas\infra\interserver\package.ps1
scp -i "$env:USERPROFILE\.ssh\interserver_deploy" C:\micro-saas\deploy-interserver.tar.gz deploy@163.245.215.41:/home/deploy/
```

Anote `Release:` e `SHA256`. O pacote contém o backend (inclusive migrations e
scripts), `RELEASE` e este runbook; não contém `.env`, certificados nem frontend.
Na VPS, em pasta nova (a pasta em uso é o caminho de volta):

```bash
sha256sum ~/deploy-interserver.tar.gz
mkdir -m 750 ~/ciframais-catalogo
tar -xzf ~/deploy-interserver.tar.gz -C ~/ciframais-catalogo
cat ~/ciframais-catalogo/RELEASE
```

**Parar** se o SHA256 diferir do exibido no Windows.

## 2. Pausar o canal WhatsApp

Obtenha `ADMIN_JWT` como em `infra/interserver/DATAFY.md` (passo 9) e pause o canal
central (a rota usa o nome histórico `meta`; o envio continua pelo Datafy):

```bash
curl -fsS -X PUT https://api.ciframais.com.br/admin/integrations/meta -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' -d '{"enabled":false}'
curl -fsS 'https://api.ciframais.com.br/communications/admin/outbound-intents?limit=100' -H "Authorization: Bearer $ADMIN_JWT"
```

A lista traz intenções `PENDING`, `SENDING`, `FAILED`, `UNCERTAIN` e `BLOCKED`.
Esperado: nenhuma `SENDING` depois de alguns minutos (o lease é de 60 s; um lease
expirado vira `UNCERTAIN` e fica para triagem). O preflight do passo 3 confirma com
`intentsSending: 0`. Não altere certificados,
DNS, Nginx ou configurações Efí para esta publicação. Mantenha a sessão SSH aberta.

## 3. Build e preflight (sem escrita)

```bash
cd ~/ciframais-catalogo
sudo docker tag ciframais-api:local ciframais-api:antes-catalogo
sudo bash infra/interserver/compose.sh --profile app config --quiet
sudo bash infra/interserver/compose.sh build api
sudo bash infra/interserver/compose.sh run --rm --no-deps api npm run templates:transition -- --preflight
```

Esperado: `canApply: true`, `blockers: []` e `pendingMigrations: 4`. Bloqueios
possíveis e o que fazer:

- **Etapas EMAIL sem template de e-mail correspondente**: com a API **anterior**
  ainda em execução, abra o catálogo de e-mail (`GET /email/templates`, tela de
  templates) para que as definições conhecidas sejam gravadas; confira o conteúdo
  efetivo e repita o preflight. Slug desconhecido ou ambíguo continua bloqueando:
  revise a etapa listada; não crie conversão aproximada.
- **Migration anterior ausente**: publique antes a versão com
  `20260927130000_collection_rules_global_templates`.
- **Envio em andamento**: aguarde o passo 2 concluir.

O preflight não inicia a API e não altera dados.

## 4. Parar a API antiga e fazer o backup

```bash
sudo bash infra/interserver/compose.sh stop api
sudo bash infra/interserver/backup.sh
```

Copie a pasta criada em `/var/backups/ciframais/<data>` para fora da VPS, com uma
cópia protegida de `/opt/ciframais/secrets/api.env` (e dos demais segredos, como em
`DATAFY.md` passo 4). Confira `sha256sum -c SHA256SUMS` na pasta e restaure o dump
em um banco isolado (container descartável), sem tocar no banco atual. O backup
precisa ser do instante **posterior** à parada da API e **anterior** às migrations.
**Parar** se a restauração isolada falhar.

## 5. Migrations

```bash
sudo bash infra/interserver/compose.sh run --rm --no-deps api npx prisma migrate status --schema=prisma/schema.prisma
sudo bash infra/interserver/compose.sh run --rm --no-deps api npm run prisma:deploy
sudo bash infra/interserver/compose.sh run --rm --no-deps api npx prisma migrate status --schema=prisma/schema.prisma
```

O primeiro `status` deve listar como pendentes exatamente as migrations da tabela
acima (termina com código de erro, esperado só nele). Use os nomes exibidos, não
um número fixo. Qualquer erro no `deploy` interrompe a sequência: não use
`migrate dev`, `db push`, reset ou seed. A migration de e-mail roda numa transação
e não altera nada se falhar. O último `status` deve informar o banco atualizado.

## 6. Aplicar e verificar a transição

```bash
sudo bash infra/interserver/compose.sh run --rm --no-deps api npm run templates:transition -- --preflight
sudo bash infra/interserver/compose.sh run --rm --no-deps api npm run templates:transition -- --apply
sudo bash infra/interserver/compose.sh run --rm --no-deps api npm run templates:transition -- --verify
```

Esperado no `--apply`: `archivedTemplates` igual ao número de templates internos,
`blockedSends` igual às intenções de template antigas não transmitidas,
`preservedAccepted`/`preservedUncertain` iguais aos contados antes e
`unreadablePayloads: 0`. No `--verify`: `ok: true`,
`activeLegacyWhatsappTemplates: 0`, `automaticGrants: 0`,
`legacyTemplateIntentsPending: 0`. Guarde as duas saídas (só contagens). Repetir o
`--apply` deve retornar zeros. **Parar** se `--verify` apontar violação.

## 7. Subir a API e publicar o frontend

```bash
sudo bash infra/interserver/compose.sh up -d --no-deps --wait --wait-timeout 180 api
sudo bash infra/interserver/compose.sh ps
sudo bash infra/interserver/compose.sh logs --tail 80 api
sudo bash infra/interserver/compose.sh exec -T nginx nginx -t
sudo bash infra/interserver/compose.sh exec -T nginx nginx -s reload
curl -fsS https://api.ciframais.com.br/health
```

Faça o reload do Nginx só se o teste passar. Publique `front-cobranca` do mesmo
commit em `main` (domínio principal da Vercel). O WhatsApp continua **pausado**
enquanto você confere telas e isolamento: empresa sem liberação vê
"Nenhum template liberado para sua empresa."; a régua mostra etapas pendentes; o
admin vê o catálogo, as liberações e as pendências em **Catálogo de templates**
(`/admin/templates`).

Remova de `api.env` as variáveis descontinuadas `EFI_ONBOARDING_NOTICE_TEMPLATE` e
`EFI_ONBOARDING_REMINDER_TEMPLATE` (a API as ignora).

## 8. Importar o catálogo real (sem envio)

Em **Catálogo de templates → Sincronizar catálogo** (ou
`POST /admin/whatsapp-templates/sync`). Confira para cada template aprovado apenas
metadados: nome, idioma, formato de parâmetros (`parameter_format`), componentes e
se aparece como suportado. Um template marcado **Formato não suportado** mostra o
componente que bloqueia: ajuste o template na Meta; **não** altere texto no código.
O teste de autenticação (`/whatsapp/admin/test-integration`) sozinho não comprova
que o template real é interpretado corretamente; a importação e a prévia sim.

## 9. Mapear, liberar, ajustar régua e revisar pendências

1. **Configurar variáveis** de cada template e conferir a **prévia fictícia**.
   Templates com variáveis numeradas (`{{1}}`) ou com nome (`{{nome_devedor}}`) são
   aceitos; um template importado antes desta versão que aparece como "Formato
   NAMED não suportado" é reclassificado ao clicar em **Sincronizar catálogo**.
2. Em **Disponibilidade por empresa**, liberar os templates para as empresas de
   teste e definir os padrões por finalidade (inclusive `Aviso de ativação` e
   `Lembrete de ativação`, se usados).
3. Com a empresa de teste, ajustar a régua: cada etapa WhatsApp usa o padrão da
   finalidade ou um template liberado; etapas antigas aparecem pendentes até a escolha.
4. Em **Envios pendentes de WhatsApp**, revisar as pendências `LEGACY_PAYLOAD` e as
   demais. Selecione explicitamente, revise a prévia e confirme apenas o que deve ser
   enviado; cobrança paga é encerrada sem mensagem.
5. Antes de reativar o canal, confirme que não há trabalho legado reenviável:
   `--verify` com `legacyTemplateIntentsPending: 0` e nenhuma pendência que você não
   pretenda enviar marcada para retomada.
6. Reative o canal (`{"enabled":true}` na rota do passo 2) e faça **um** envio
   explicitamente acionado para um destinatário controlado (por exemplo, resposta com
   template no atendimento central para o seu telefone). Confira `ACCEPTED`, o status
   no histórico e o webhook do Datafy.

## 10. Acompanhamento, falhas e recuperação

Acompanhe por códigos e IDs, nunca por conteúdo de mensagem:

- `GET /communications/admin/template-pending/summary`: pendências por empresa,
  template e motivo (`NOT_GRANTED`, `DEFAULT_MISSING`, `REVIEW_REQUIRED`,
  `VERSION_CHANGED`, `CONTEXT_CHANGED`, `LEGACY_PAYLOAD`...).
- `GET /admin/whatsapp-templates/sync-state`: última reconciliação completa,
  sincronização em andamento e último erro.
- `GET /communications/admin/outbound-intents`: fila, `UNCERTAIN` e conflitos.
- Registros de cobrança `WHATSAPP_TEMPLATE_HELD` (mensagem retida) e recusas do
  provedor 132xxx nas intenções (`lastErrorCode`).

### "Enfileirou, mas não entregou": em que etapa está

Emitir o pagamento, enfileirar, transmitir, entregar e pagar são eventos
diferentes. Siga a cobrança pela fatura:

| Onde aparece | Etapa e motivo | O que fazer |
| --- | --- | --- |
| `INITIAL_CHARGE_PAYMENT_FAILED` no histórico da fatura | A emissão Efí falhou; nenhuma mensagem foi preparada. O texto traz o motivo (ex.: telefone do pagador recusado) | Corrigir o cadastro e enviar de novo; a fila não repete uma emissão recusada ou incerta. Emissão incerta: Operação → Emissões para conciliar |
| `INITIAL_CHARGE_SKIPPED` | Ativação financeira pendente, primeira cobrança automática desligada (vale só para criação, importação e recorrência; o envio selecionado pelo usuário segue) ou template retido | Conferir a mensagem do registro |
| `WHATSAPP_OPT_IN_REQUIRED` | Devedor sem opt-in | Obter o opt-in |
| Pendência de template (`template-pending/summary`) | `BLOCKED`: sem template padrão `EMISSION` liberado, mapeamento ou contexto alterado | Revisar e confirmar as pendências; mudar capacidade ou liberação não as retoma sozinho |
| Intenção `PENDING` | Na fila, ainda não transmitida. `lastErrorCode`: `CHANNEL_CAPACITY_EXHAUSTED` (capacidade central esgotada), `PROVIDER_RATE_LIMIT` (limite informado pelo WhatsApp), `CHANNEL_CONTROL_UNAVAILABLE` (Redis/banco) ou `WAITING_FOR_CHANNEL` (canal pausado ou ritmo de envio) | Aguardar; conferir a capacidade em Admin → Visão geral |
| Intenção `FAILED` | Recusa antes ou na transmissão (`lastErrorCode`: janela fechada, cobrança não pendente, template, destinatário pausado) | Agir conforme o motivo; não há reenvio automático |
| Intenção `ACCEPTED`, mensagem sem `delivered` | O Datafy aceitou; entrega e leitura dependem do webhook | Conferir os eventos do webhook; aceito não é entregue |
| Intenção `UNCERTAIN` | Pode ter sido aceita | Nunca reenviar sem conciliar com o Datafy |

Antes de transmitir, o worker revalida canal, opt-out, janela, fatura ainda
pendente, opt-in e o template fixado; cobrança paga ou cancelada enquanto
esperava na fila não é enviada. O pagamento já emitido é reaproveitado; um
reenvio de mensagem não gera nova emissão.

Em qualquer falha, **pause o WhatsApp primeiro** (passo 2). Depois:

- **Correção adiante (preferida)**: publique uma release corrigida seguindo este
  runbook; as migrations são aditivas e o `--apply` é idempotente.
- **Reversão antes de qualquer envio** pela release nova: é possível restaurar o
  backup do passo 4 junto com a imagem `ciframais-api:antes-catalogo`, numa janela
  controlada. Voltar **só a imagem** não é compatível: o schema e os payloads novos
  (`BLOCKED`, snapshots, pendências) não são entendidos pela versão antiga.
- **Recuperação depois de envios**: antes de restaurar, exporte os IDs das intenções
  `ACCEPTED` e `UNCERTAIN` criadas após o backup e concilie-os com o Datafy; após a
  restauração, garanta que essas comunicações não voltem a ser enviadas (mantenha o
  canal pausado e marque-as antes de reativar). Um backup não pode ressuscitar envios.

## Testes locais

`npm run test:template-transition:postgres` ensaia a transição num PostgreSQL 16
descartável: schema anterior com catálogo interno em dois idiomas, etapa EMAIL e
etapa tentada; preflight somente leitura; migrations; recusas (sem migrations, canal
ativo, envio em andamento); `--apply` com intenções `PENDING`, `ACCEPTED` e
`UNCERTAIN`; `--verify`; repetição idempotente; e restauração de uma cópia anterior
ao `--apply` seguida da mesma transição. `template-catalog-flow.e2e-spec.ts`
percorre o fluxo completo com duas empresas por HTTP.
