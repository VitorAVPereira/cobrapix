# Backend na InterServer com PostgreSQL local

Preparação para uma VPS Ubuntu com aproximadamente 6 GB de RAM, banco vazio e
frontend hospedado separadamente. Reutiliza o Dockerfile da API e o modelo Nginx
com mTLS de `infra/efi`; não altera a implantação existente com Neon.

| Serviço | Persistência | Porta publicada no servidor |
| --- | --- | --- |
| PostgreSQL 16 | Volume `ciframais_postgres` | Nenhuma |
| Redis 7 / BullMQ no banco 0 | Volume `ciframais_redis`, AOF a cada segundo | Nenhuma |
| API NestJS | Banco PostgreSQL; certificados montados para leitura | Nenhuma |
| Nginx | Configuração e certificados em `/opt/ciframais/secrets` | 80 e 443, após configuração |

API e Nginx têm o perfil `app`. O primeiro comando inicia **somente PostgreSQL e
Redis**. A API usa um usuário PostgreSQL próprio, sem superusuário; ambos os
endereços `DATABASE_URL` e `DIRECT_URL` apontam para o banco local. As senhas são
geradas na VPS, e não fazem parte do pacote de código.

## 1. Preparar o pacote no Windows

No PowerShell local, dentro deste projeto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\micro-saas\infra\interserver\package.ps1
scp -i "$env:USERPROFILE\.ssh\interserver_deploy" C:\micro-saas\deploy-interserver.tar.gz deploy@163.245.215.41:/home/deploy/
```

O pacote inclui os arquivos de código versionados necessários ao build e os
arquivos desta implantação. Não inclui `.env`, certificados, `node_modules`,
frontend ou arquivos de banco. Novos arquivos de código ainda não versionados
precisam ser adicionados ao Git antes de gerar pacotes futuros.

## 2. Extrair na VPS

Na sessão SSH como `deploy`:

```bash
sudo docker compose version
sudo docker ps
mkdir -m 750 ~/ciframais
tar -xzf ~/deploy-interserver.tar.gz -C ~/ciframais
cd ~/ciframais
```

Se `mkdir` informar que a pasta já existe, pare e confira seu conteúdo antes de
extrair novamente. Não use este procedimento para sobrescrever um deploy ativo.

## 3. Inicializar somente banco e Redis

Execute um comando por vez, avançando somente se terminar sem erro:

```bash
sudo bash infra/interserver/setup.sh
sudo bash infra/interserver/compose.sh --profile app config --quiet
sudo bash infra/interserver/compose.sh up -d --wait --wait-timeout 180 postgres redis
sudo bash infra/interserver/compose.sh ps
```

Os dois serviços devem aparecer como `healthy`. O teste de saúde do PostgreSQL
faz uma consulta autenticada como o usuário da aplicação. O Redis responde a
`PING`. `5432/tcp` ou `6379/tcp` sem um mapeamento `IP:porta->porta` na coluna
PORTS são portas internas, não publicações na internet.

`setup.sh` cria arquivos `0600` em `/opt/ciframais/secrets`, recusa sobrescrever
arquivos existentes e recusa gerar credenciais para um volume PostgreSQL já
existente. Não execute novamente para atualizar a aplicação ou trocar senhas.
Editar a senha no arquivo não muda a senha dentro de um banco inicializado.

Em caso de falha, não apague os volumes; inspecione os serviços:

```bash
sudo bash infra/interserver/compose.sh logs --tail 60 postgres redis
```

## 4. Criar as tabelas, depois de validar a etapa anterior

O build baixa dependências e pode levar alguns minutos. Estes comandos não
iniciam o servidor HTTP nem habilitam integrações:

```bash
sudo bash infra/interserver/compose.sh build api
sudo bash infra/interserver/compose.sh run --rm --no-deps api npm run prisma:deploy
sudo bash infra/interserver/compose.sh run --rm --no-deps api npx prisma migrate status --schema=prisma/schema.prisma
```

O comando de migração aplica os arquivos canônicos de `api-cobranca/prisma`.
Não use `prisma migrate dev`, `db push` ou o seed de testes em produção.

## 5. Configurar a API e criar o primeiro administrador

Este passo exige os domínios reais, os certificados Efí e as credenciais dos
serviços usados pelo sistema. Complete diretamente na VPS:

```bash
sudo nano /opt/ciframais/secrets/api.env
```

As variáveis necessárias estão no arquivo, inicialmente vazias. Use valores
reais, mantendo `EFI_LEGAL_APPROVED=false` até concluir a etapa de homologação.
Mantenha `NODE_ENV=production` na VPS: ele controla a execução do servidor,
enquanto `EFI_ENV=homologation` seleciona o ambiente de testes da Efí. Com essa
combinação, o administrador pode liberar novas ativações no painel sem marcar
os textos como aprovados. A liberação ainda depende do registro do webhook na
Efí; uma falha nesse registro mantém as ativações pausadas. Para a Efí de
produção, a liberação exige `EFI_LEGAL_APPROVED=true` após a aprovação dos textos.
Configure `FRONTEND_URL` com a URL HTTPS do frontend e `ALLOWED_ORIGINS` com a
mesma origem (sem barra final); caso haja mais de uma, separe por vírgulas, sem
espaços. O CORS da API lê `ALLOWED_ORIGINS`, não `FRONTEND_URL`.
`EFI_ENV` e as credenciais/certificados precisam corresponder ao mesmo ambiente.
Credenciais com `$`, `#` ou espaços devem ser colocadas entre aspas simples no
arquivo de ambiente, conforme as regras do Docker Compose.

Copie os certificados cliente Efí para
`/opt/ciframais/secrets/efi/opening.p12` e `platform.p12`, conforme os caminhos
configurados. Dê a esses arquivos proprietário `1000:1000` e modo `0400` para
permitir leitura pelo usuário `node` do container. Os certificados TLS do
Nginx são diferentes dos certificados cliente usados pela API para chamar a Efí.

Crie `/opt/ciframais/secrets/seed.env` com permissão `0600`, contendo:

```dotenv
SEED_CORPORATE_NAME='Razao social real'
SEED_COMPANY_CNPJ=00000000000000
SEED_COMPANY_EMAIL=administracao@seu-dominio.com
SEED_COMPANY_PHONE=5511999999999
SEED_ADMIN_EMAIL=seu-email@seu-dominio.com
SEED_ADMIN_PASSWORD='SUBSTITUA por uma senha unica com pelo menos 20 caracteres'
```

Substitua todos os exemplos. O seed de produção cria uma empresa e um
administrador, exige troca da senha inicial e mantém as integrações pausadas.
Execute primeiro sem `--apply` para validar os campos:

```bash
sudo bash infra/interserver/compose.sh run --rm --no-deps --env-from-file /opt/ciframais/secrets/seed.env api npm run seed:production
sudo bash infra/interserver/compose.sh run --rm --no-deps --env-from-file /opt/ciframais/secrets/seed.env api npm run seed:production -- --apply
sudo rm /opt/ciframais/secrets/seed.env
sudo bash infra/interserver/compose.sh up -d --wait --wait-timeout 180 api
```

O seed exige banco sem empresas. Não o repita após a criação inicial. A opção
`--env-from-file` exige uma versão atual do Docker Compose; confirme em
`sudo docker compose run --help` antes desta etapa.

## 6. Publicar o HTTPS em uma etapa separada

Siga [HTTPS.md](HTTPS.md) para instalar a configuração dos domínios reais,
conectar o certificado `ciframais-api` ao Nginx, escolher a cadeia oficial da Efí
e testar a renovação automática por webroot. A configuração inicial criada por
`setup.sh` ainda é um modelo; o script `setup-https.sh` a substitui nesta etapa.

O endereço fixo `172.29.42.10`, a validação mTLS e o tratamento do cabeçalho
`X-Efi-Client-Verify` são preservados: fazem parte da validação dos webhooks.

Antes de receber clientes: validar HTTPS/webhooks e o frontend apontando para a
API nova; configurar backup externo com restauração testada. A publicação e a
ativação das integrações não são realizadas pelos scripts desta pasta.

## Persistência e operação

- Os volumes sobrevivem à recriação dos containers, mas não substituem backup.
- Não execute `down -v` nem remova os volumes: isso apaga os dados.
- Guarde uma cópia protegida das chaves em `api.env`, além do backup do banco.
  Sem as chaves de criptografia, credenciais gravadas no banco ficam ilegíveis.
- Anexos do WhatsApp ficam cifrados em `/var/lib/ciframais/communication-media`,
  único caminho gravável da API além de `/tmp`, montado só no container `api`
  (nunca no Nginx). Em instalação nova, `setup.sh` cria o diretório; em uma VPS
  já configurada, crie-o antes de recriar a API, senão o Docker o cria como root
  e a API não consegue gravar:
  `sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ciframais/communication-media`.
  O limite operacional é `COMMUNICATION_MEDIA_LIMIT_BYTES` (padrão 5 GiB); o
  `/health` mostra o uso e fica degradado a partir de 80%. Ao atingir o limite,
  novos anexos ficam indisponíveis e a mensagem continua registrada. Arquivos
  expirados pelo prazo de retenção são apagados de hora em hora.
- Backup completo (dump + anexos + SHA256): `sudo bash infra/interserver/backup.sh`.
  Publicação das conversas por empresa e troca para Datafy: `DATAFY.md`.
- Backup dos anexos: copie o diretório inteiro junto com o dump do PostgreSQL do
  mesmo momento (por exemplo,
  `sudo tar -C /var/lib/ciframais -czf anexos-AAAAMMDD.tgz communication-media`).
  Os arquivos são cifrados com chaves derivadas de `PAYMENT_ENCRYPTION_KEYS`:
  sem o `api.env` correspondente eles não podem ser lidos. Na restauração,
  restaure banco, diretório (dono UID 1000, modo 700) e `api.env` juntos; um
  arquivo sem linha no banco é ignorado e uma linha sem arquivo aparece como
  anexo indisponível, sem afetar a mensagem.
- PostgreSQL 16 está fixado por versão principal. Uma atualização para 17/18
  exige migração; não basta trocar a tag mantendo o mesmo volume.
- Redis usa `noeviction`: ao atingir o limite, pode recusar novas gravações em
  vez de descartar dados das filas. Monitore memória e disco e ajuste conforme o uso.
- Os limites iniciais somam cerca de 3,25 GiB para os quatro containers,
  deixando espaço para o Ubuntu na VPS de 6 GB. Build e picos também consomem RAM;
  esses limites não equivalem a uma estimativa de quantidade de clientes.
- Use sempre `infra/interserver/compose.sh` nesta VPS. O Compose da raiz do
  backend é de desenvolvimento; o de `infra/efi` mantém a configuração anterior.

Referências: [imagem oficial PostgreSQL](https://hub.docker.com/_/postgres),
[perfis do Compose](https://docs.docker.com/compose/how-tos/profiles/) e
[backups PostgreSQL](https://www.postgresql.org/docs/16/backup.html).
