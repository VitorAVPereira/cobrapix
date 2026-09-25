# Publicação: WhatsApp via Datafy e conversas por empresa

Roteiro manual para publicar na VPS Interserver a release das etapas 1–8. O
WhatsApp da plataforma usa **somente o Datafy**: não há mais integração direta com a
Meta (sem token Graph, sem webhook `/webhooks/meta`, sem `WHATSAPP_TRANSPORT`). Como a
produção ainda não envia mensagens reais, a publicação é feita de uma vez, sem
janela de transição.

Convenções: comandos `bash` rodam na VPS como `deploy`, um por vez, avançando
só sem erro. Credenciais Datafy (token `sk_live_…` e segredo `whsec_…`) são
digitadas **apenas** em `/opt/ciframais/secrets/api.env`; nunca em chat, ticket,
commit ou histórico do shell.

## O que esta release muda na VPS

| Item | Mudança | Ação |
| --- | --- | --- |
| Banco | 5 migrations aditivas (`20260923180000` a `20260924230000`): novos enums, tabelas, colunas com valor padrão e índices. Nenhum `DROP`, `UPDATE`, `DELETE` ou troca de tipo. | `prisma:deploy` após backup |
| Disco | Anexos cifrados em `/var/lib/ciframais/communication-media` (limite padrão 5 GiB) | Criar diretório (UID 1000, modo 700) |
| `api.env` | Novas: `DATAFY_*`, `COMMUNICATION_MEDIA_*`. Obsoletas: `WHATSAPP_TRANSPORT`, `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_BASE_URL`, `META_GRAPH_API_VERSION` | Editar na VPS |
| Compose | Novo volume do diretório de anexos no serviço `api` | Recriar o container `api` |
| Nginx | Nenhuma: `/webhooks/datafy` já passa por `location /` de `api.ciframais.com.br` (corpo até 3 MiB; a API limita a 1 MiB). `/webhooks/meta` passa a responder 404. | — |
| Frontend (Vercel) | Páginas `/communications` e `/admin/communications`; `/inbox` redireciona para `/admin/communications`; página `/configuracoes/whatsapp` removida | Publicar depois da API |

O envio de respostas é só pelo administrador da plataforma em
`/admin/communications`; a inbox antiga não envia.

## 1. Painel Datafy (antes da publicação)

1. Gere o token de API de produção (`sk_live_…`).
2. Cadastre o webhook com a URL `https://api.ciframais.com.br/webhooks/datafy`,
   eventos de mensagens (`messages`, que inclui status de entrega/leitura) e de
   templates (`message_template_status_update`, `template_category_update` e
   demais `message_template_*` disponíveis). Guarde o segredo `whsec_…`.
3. Anote o ID do número e o ID da WABA exibidos pelo Datafy: vão em
   `META_PHONE_NUMBER_ID` e `META_BUSINESS_ACCOUNT_ID`. A API recusa o token se o
   `/me` do Datafy devolver outros IDs.

Até a API nova subir (passo 8), entregas do Datafy podem falhar; o Datafy reenvia
conforme a política dele. Se preferir, ative o webhook no painel só depois do passo 8.

## 2. Gerar o pacote (Windows)

O pacote seleciona o backend por `git ls-files`. Faça commit das alterações de
`api-cobranca` (inclusive as 5 pastas novas em `prisma/migrations`) antes de
empacotar; o script recusa gerar pacote com arquivo do backend pendente e lista
os arquivos. Os arquivos de `infra/interserver` são lidos do disco.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\micro-saas\infra\interserver\package.ps1
scp -i "$env:USERPROFILE\.ssh\interserver_deploy" C:\micro-saas\deploy-interserver.tar.gz deploy@163.245.215.41:/home/deploy/
```

Anote a linha `Release:` e o `SHA256` exibidos. Na VPS, confira o hash:

Antes de gerar/enviar, preserve qualquer pacote anterior que ainda seja necessário
para recuperação: os comandos acima reutilizam o nome `deploy-interserver.tar.gz`
tanto no computador quanto na VPS. Não confunda um pacote antigo já presente no
disco com a release recém-gerada.

```bash
sha256sum ~/deploy-interserver.tar.gz
```

## 3. Extrair a nova release em pasta nova

Não sobrescreva a pasta em uso (normalmente `~/ciframais`): ela é o caminho de volta.

```bash
mkdir -m 750 ~/ciframais-nova
tar -xzf ~/deploy-interserver.tar.gz -C ~/ciframais-nova
cat ~/ciframais-nova/RELEASE
```

O projeto Compose tem nome fixo `ciframais`: os volumes do PostgreSQL e do Redis
são os mesmos, qualquer que seja a pasta usada.

## 4. Backup antes de qualquer mudança

Se o banco já existe na VPS:

```bash
sudo bash ~/ciframais-nova/infra/interserver/backup.sh
```

Copie a pasta criada em `/var/backups/ciframais/<data>` para fora da VPS, junto
com uma cópia protegida de `/opt/ciframais/secrets/api.env` (sem ela, as
credenciais Efí gravadas e os anexos ficam ilegíveis). Preserve também
`postgres.env`, certificados Efí e configuração/certificados do Nginx para
recuperar a instalação completa, com o mesmo controle de acesso aos segredos.
O script não copia esses arquivos. Ele valida o catálogo do dump com
`pg_restore --list`; isso não comprova a restauração desse backup. O procedimento
foi testado localmente em containers descartáveis; confira também o backup desta
publicação em um banco isolado antes das migrations, sem substituir o banco atual.

## 5. Diretório de anexos

`setup.sh` só cria o diretório em instalação nova. Nesta VPS, crie-o antes de
recriar a API; sem isso o Docker o cria como root e a API não consegue gravar:

```bash
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ciframais/communication-media
sudo ls -ld /var/lib/ciframais/communication-media
```

Esperado: `drwx------ … 1000 1000`.

## 6. Variáveis em `api.env`

```bash
sudo nano /opt/ciframais/secrets/api.env
```

Acrescente ou confira (modelo em `infra/interserver/api.env.example`):

```dotenv
DATAFY_API_TOKEN=sk_live_...        # do painel Datafy
DATAFY_WEBHOOK_SECRET=whsec_...     # do painel Datafy
DATAFY_WEBHOOK_SECRET_PREVIOUS=
DATAFY_WEBHOOK_BASE_URL=https://api.ciframais.com.br/webhooks/datafy
META_PHONE_NUMBER_ID=<id do número>
META_BUSINESS_ACCOUNT_ID=<id da WABA>
COMMUNICATION_MEDIA_DIR=/var/lib/ciframais/communication-media
COMMUNICATION_MEDIA_LIMIT_BYTES=5368709120
```

Apague as linhas obsoletas `WHATSAPP_TRANSPORT`, `META_ACCESS_TOKEN`,
`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_BASE_URL` e
`META_GRAPH_API_VERSION`. A API as ignora, mas não há motivo para manter um token
Meta guardado. Mantenha `PAYMENT_ENCRYPTION_KEYS`/`PAYMENT_ACTIVE_KEY_VERSION`,
Efí e Resend como estão. Confira `ALLOWED_ORIGINS` e `FRONTEND_URL` com o domínio
do frontend publicado na Vercel. Em produção a API não inicia sem `DATAFY_*` e os
IDs; o log mostra o nome da variável que falta. O arquivo deve continuar `0600`:

```bash
sudo stat -c '%a %U' /opt/ciframais/secrets/api.env
```

## 7. Imagem de retorno, build e migrations

Se já existe uma imagem da API, guarde-a com uma tag de retorno (a nova release
reutiliza a tag `local`):

```bash
sudo docker image ls ciframais-api
sudo docker tag ciframais-api:local ciframais-api:antes-datafy
```

```bash
cd ~/ciframais-nova
sudo bash infra/interserver/compose.sh --profile app config --quiet
sudo bash infra/interserver/compose.sh build api
sudo bash infra/interserver/compose.sh run --rm --no-deps api npx prisma migrate status --schema=prisma/schema.prisma
```

`migrate status` deve listar exatamente as 5 migrations Datafy como pendentes; com
pendências ele termina com código de erro, o que é esperado só nesse primeiro
comando. Se listar outras migrations, pare e confira antes de continuar. Então aplique:

```bash
sudo bash infra/interserver/compose.sh run --rm --no-deps api npm run prisma:deploy
sudo bash infra/interserver/compose.sh run --rm --no-deps api npx prisma migrate status --schema=prisma/schema.prisma
```

Nunca use `migrate dev`, `db push`, seed ou reset em produção. As migrations criam
índices sem `CONCURRENTLY`; com o volume atual o bloqueio de escrita é curto.

## 8. Recriar a API

```bash
sudo bash infra/interserver/compose.sh up -d --wait --wait-timeout 180 api
sudo bash infra/interserver/compose.sh ps
sudo bash infra/interserver/compose.sh logs --tail 80 api
sudo bash infra/interserver/compose.sh exec -T nginx nginx -t
sudo bash infra/interserver/compose.sh exec -T nginx nginx -s reload
curl -fsS https://api.ciframais.com.br/health
```

Execute o reload somente se o teste de configuração passar. O Nginx atual resolve
`api:3001` ao carregar a configuração; recriar a API pode mudar seu IP interno.
O reload atualiza esse endereço sem reiniciar PostgreSQL ou Redis.

No `/health`, esperado `overall: healthy`, o item `WhatsApp via Datafy` como
`healthy` com `authentication: NOT_CHECKED` (configuração local completa; o token
é verificado no passo 9) e o item de anexos com uso baixo. O item de anexos é
consultivo: a partir de 80% há alerta; atingir o limite ou não conseguir gravar no
diretório impede novos anexos. A API continua atendendo as demais operações.

## 9. Validar o Datafy

Na VPS, entre como administrador da plataforma. O comando pede e-mail e senha
sem exibi-los nem gravá-los no histórico e guarda só o token da sessão:

```bash
ADMIN_JWT=$(python3 -c 'import getpass, json, sys, urllib.request
sys.stderr.write("E-mail: "); sys.stderr.flush(); email = sys.stdin.readline().strip()
password = getpass.getpass("Senha: ")
request = urllib.request.Request("https://api.ciframais.com.br/auth/login", json.dumps({"email": email, "password": password}).encode(), {"Content-Type": "application/json"})
print(json.load(urllib.request.urlopen(request))["access_token"])')
```

1. Autenticação e identidade (não envia mensagem):

   ```bash
   curl -fsS -X POST https://api.ciframais.com.br/whatsapp/admin/test-integration -H "Authorization: Bearer $ADMIN_JWT"
   ```

   Esperado `transport: DATAFY` e `authentication: AUTHENTICATED`.
2. Webhook: envie, do seu próprio telefone, uma mensagem para o número da
   plataforma. Ela deve aparecer em `/admin/communications` (sem empresa, para
   classificação). Backlog e falhas de entrega do webhook:

   ```bash
   curl -fsS 'https://api.ciframais.com.br/webhooks/admin/datafy/deliveries?limit=20' -H "Authorization: Bearer $ADMIN_JWT"
   unset ADMIN_JWT
   ```

   Respostas 401 nos logs para `/webhooks/datafy` indicam segredo divergente
   entre painel e `api.env`.
3. O primeiro envio real (cobrança ou resposta do administrador) é decisão sua;
   acompanhe-o em `/admin/communications`. Envios com resultado incerto aparecem como
   `UNCERTAIN` e **não** são repetidos automaticamente; confira no painel Datafy
   antes de qualquer ação manual.

## 10. Frontend na Vercel

Publique `front-cobranca` do mesmo commit. Não há variável nova no frontend e
nenhuma credencial Datafy vai para a Vercel; confira só `NEXT_PUBLIC_API_URL`
apontando para `https://api.ciframais.com.br`. Valide:

- empresa: login, `/communications` lista apenas conversas da própria empresa;
- administrador da plataforma: `/admin/communications` lista pendências de
  classificação e permite responder;
- `/inbox` e `/configuracoes/whatsapp` redirecionam.

## 11. Limpeza da integração Meta antiga

- Se existe um app próprio no painel de desenvolvedores da Meta com callback
  `https://api.ciframais.com.br/webhooks/meta`, remova esse callback ou a assinatura
  desse app na WABA: a rota não existe mais e a Meta ficaria reenviando para um 404.
  **Não** altere a conexão do Datafy com a WABA.
- Se o token Meta (usuário do sistema) foi criado só para a integração direta,
  revogue-o no Business Manager.

## Rotação do segredo do webhook Datafy

1. Gere o novo segredo no painel, mas mantenha o antigo ativo se o painel permitir.
2. Em `api.env`: `DATAFY_WEBHOOK_SECRET_PREVIOUS=<antigo>` e
   `DATAFY_WEBHOOK_SECRET=<novo>`; recrie a API:
   `sudo bash infra/interserver/compose.sh up -d --wait --wait-timeout 180 --force-recreate api`.
   A API passa a aceitar os dois.
3. Ative o novo segredo no painel e confirme entregas aceitas (passo 9.2).
4. Esvazie `DATAFY_WEBHOOK_SECRET_PREVIOUS` e recrie a API outra vez.

A inicialização recusa segredo anterior igual ao atual, fora do formato `whsec_`
ou sem o segredo atual.

## Pausar envios

Para suspender todos os envios WhatsApp sem perder nada (as intenções ficam
pendentes e são enviadas uma vez ao retomar):

Com `ADMIN_JWT` obtido como no passo 9:

```bash
curl -fsS -X PUT https://api.ciframais.com.br/admin/integrations/meta -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' -d '{"enabled":false}'
```

Retome com `{"enabled":true}`. O nome `meta` na rota é o identificador histórico do
canal WhatsApp no banco; o envio continua sendo pelo Datafy.

## Monitoramento

- `/health`: banco e configuração do canal (núcleo) e uso do disco de anexos
  (consultivo, degradado a partir de 80% de `COMMUNICATION_MEDIA_LIMIT_BYTES`).
- `GET /webhooks/admin/datafy/deliveries`: entregas pendentes, com falha ou em
  triagem. Corpos brutos processados são apagados após 7 dias.
- Painel da empresa: o consumo das últimas 24 h vem das mensagens registradas pelo
  webhook Datafy.
- Disco: `sudo du -sh /var/lib/ciframais/communication-media` e
  `sudo docker system df`. Anexos expirados são apagados de hora em hora.
- Backup: rode `backup.sh` com a frequência desejada e copie para fora da VPS
  com o `api.env` correspondente.

## Retorno

As migrations são aditivas, mas isso, isoladamente, não garante que uma imagem
antiga consiga processar corretamente os registros novos. Priorize corrigir a
release Datafy ou retornar a outra imagem Datafy validada, mantendo saídas
pausadas enquanto houver dúvida sobre envios.

A imagem anterior com Meta direta não recebe `/webhooks/datafy`. Usá-la pode
interromper a ingestão e exige verificar configuração, compatibilidade dos novos
registros e processamento das filas antes de iniciá-la. Os comandos abaixo são
somente a mecânica de retorno da imagem, depois dessas verificações:

```bash
sudo docker tag ciframais-api:antes-datafy ciframais-api:local
cd ~/ciframais
sudo bash infra/interserver/compose.sh up -d --no-build --force-recreate --wait --wait-timeout 180 api
sudo bash infra/interserver/compose.sh exec -T nginx nginx -t
sudo bash infra/interserver/compose.sh exec -T nginx nginx -s reload
```

A imagem anterior usa as variáveis antigas: qualquer retorno exige prepará-las
**antes** de iniciar o container, a partir da cópia protegida do backup. Isso não
reconecta automaticamente a integração Meta nem autoriza retomar disparos por
ela. Restaurar o dump substitui o que foi gravado depois do backup; essa operação
é recuperação de dados planejada, não um passo automático de rollback.

Depois de alguns dias estáveis, a pasta antiga pode ser arquivada e a nova
renomeada para `~/ciframais`.

## Medições locais (sem promessa de capacidade da VPS)

Dados sintéticos em PostgreSQL 16 descartável limitado a 1,5 GiB de RAM
(`shared_buffers=256MB`): 50 mil conversas, 400 mil mensagens, ~10 mil anexos.

| Operação | Resultado |
| --- | --- |
| Conversas da empresa (1ª e 5ª páginas) | ~40 ms no serviço; índice usado |
| Mensagens de uma conversa | ~5 ms no serviço (0,13 ms de consulta) |
| Pendências de classificação do admin | ~110 ms, dominado pela contagem |
| Retenção, limpeza de anexos, respostas por ID | busca por índice, < 0,2 ms |
| Ingestão de webhook | 5,8 ms por entrega para persistir; 229 mensagens/s processadas com concorrência 4 |
| Tamanho | banco 407 MB (tabela de mensagens 371 MB), PostgreSQL 367 MiB de RAM |

Os limites comerciais continuam valendo: o teto do número compartilhado
(60 mensagens/h) é o limite efetivo da plataforma.
