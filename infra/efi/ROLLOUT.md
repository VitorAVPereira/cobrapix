# Execução e reversão da entrega

## Estado da entrega

O escopo local entrega imagem, Compose, mTLS, testes, seed mínimo, backup diário e inventário de corte. Publicação na AWS/Vercel, execução no Neon, exclusão de tenants e ativação bancária são etapas de operação com evidências externas. Não executar o seed de desenvolvimento em produção. A decisão vigente é Bolix por padrão e Pix opcional; Boleto tradicional fica apenas no histórico.

## Implantação reproduzível

1. Provisionar Lightsail Linux com 2 GB em `sa-east-1`, IP estático, DNS público e DNS exclusivo Efí. Restringir SSH ao IP do operador e expor somente 80/443. Instalar Docker/Compose pelo procedimento oficial da distribuição. Manter uma cópia do último digest implantado e o commit da release.
2. Construir a imagem em CI ou máquina de desenvolvimento; os 2 GB da instância são destinados ao runtime. Publicar a imagem no registry escolhido e usar um tag imutável em `RELEASE_TAG`. Transferir a imagem com `docker save`/`docker load` quando não houver registry. Não fazer build do Next.js nessa instância; ele permanece na Vercel.
3. Instalar os segredos descritos em `README.md`. Diretórios `0700`, arquivos `0600`; permitir leitura dos P12 ao UID 1000 do contêiner, sem permitir acesso de outros usuários. Conferir `ALLOWED_ORIGINS` com o domínio exato da Vercel. Substituir ambos os hostnames `.example` no Nginx. Não criar certificados de produção com a CA dos testes.
4. Configurar backup e snapshots conforme a próxima seção. Fazer e restaurar um backup em banco isolado antes da primeira migração. Registrar objeto, hash SHA-256, data, responsável e resultado da restauração no registro de corte.
5. Validar Compose com `docker compose -f infra/efi/compose.yaml config --quiet` (não imprimir os segredos resolvidos). Aplicar a expansão com `docker compose -f infra/efi/compose.yaml run --rm --no-deps api npm run prisma:deploy`. Não executar migrações de remoção na expansão. Subir Redis/API/Nginx com `up -d --no-build`; conferir saúde e `nginx -t` no contêiner.
6. Em banco vazio, fornecer `SEED_CORPORATE_NAME`, `SEED_COMPANY_CNPJ`, `SEED_COMPANY_EMAIL`, `SEED_COMPANY_PHONE`, `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` por arquivo temporário `0600`, nunca argumentos de shell. Executar `npm run seed:production` para simulação; depois `npm run seed:production -- --apply` no contêiner. O seed não altera um banco com empresas, exige senha inicial de 20 caracteres, força sua troca e pausa as quatro integrações. Remover o arquivo temporário de seed após registrar o resultado.
7. Entrar como administrador e trocar a senha. Configurar tarifas contratadas de Pix/Bolix; habilitar canais centrais apenas quando seus templates e credenciais estiverem verificados. Conferir todos os gates externos antes de habilitar `EFI_ONBOARDING` e `EFI_PAYMENTS`.

Exemplo de simulação do seed com arquivos de ambiente já instalados no host (substituir TAG pelo tag imutável):

```bash
docker run --rm --env-file /opt/ciframais/secrets/api.env --env-file /opt/ciframais/secrets/seed.env ciframais-api:TAG npm run seed:production
```

Para aplicar, acrescentar `-- --apply` ao comando acima após revisar a simulação. O contêiner precisa alcançar somente o banco para esse comando; o seed não envia avisos nem abre contas.

## Backup, retenção e restauração

Instalar `pg_dump` compatível com a versão do Neon, `age`, AWS CLI e Node no host. Criar bucket S3 **dedicado, privado, sem versionamento e sem Object Lock**, na região aprovada. Restringir a credencial de backup a listar o prefixo `ciframais/database/`, consultar versionamento e gravar/excluir seus objetos. O backup aplica também SSE-S3; o conteúdo já chega cifrado por `age`. Manter a chave privada age fora da instância e testar a recuperação antes do corte.

Copiar `backup.env.example` para `/opt/ciframais/secrets/backup.env`, com acesso root. O serviço PostgreSQL em `pg_service.conf` deve exigir TLS e usar o endpoint direto do Neon. Não gravar a URL com senha em logs ou no histórico do shell. O cronograma usa arquivos `ciframais-backup.service` e `.timer`: instalar em `/etc/systemd/system`, executar `systemctl daemon-reload` e `systemctl enable --now ciframais-backup.timer`. A release fica em `/opt/ciframais/current`. Rodar uma vez `systemctl start ciframais-backup.service` e conferir seu resultado antes de confiar no timer.

`backup.sh` faz `pg_dump` e cifra em fluxo, sem arquivo de banco em texto puro; o temporário cifrado é removido ao terminar. `expire-backups.cjs` simula por padrão e, com `--apply`, remove somente objetos reconhecidos do prefixo após 29 dias. Não opera em buckets versionados. Configurar alerta externo para serviço falho e ausência de backup há 26 horas; falha de acesso ao storage exige intervenção para respeitar a retenção máxima de 30 dias. Configurar também regra S3 de expiração de 29 dias como defesa adicional, sem depender da execução assíncrona dessa regra como única garantia.

Habilitar snapshots automáticos da instância com o comando abaixo, após substituir o nome pelo recurso real:

```bash
aws lightsail enable-add-on --region sa-east-1 --resource-name NOME_DA_INSTANCIA --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=05:00}'
```

A AWS mantém os sete snapshots automáticos mais recentes. Snapshots manuais e cópias não têm a mesma expiração: não criar cópias permanentes de segredos e remover as cópias identificadas antes de 30 dias. Discos e snapshots do Lightsail têm criptografia em repouso gerenciada pela AWS. [Agendamento oficial](https://docs.aws.amazon.com/cli/latest/reference/lightsail/enable-add-on.html), [retenção automática](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-snapshots-in-amazon-lightsail.html), [criptografia](https://aws.amazon.com/lightsail/faq/).

Para ensaiar restauração: baixar o objeto cifrado identificado, conferir seu hash, descriptografar com a chave age offline e restaurar com `pg_restore --exit-on-error --no-owner --no-acl` em banco vazio **isolado**. Manter API/workers sem saída externa e integrações pausadas. Conferir contagens do inventário, constraints e estado de onboarding. Uma restauração pode trazer credenciais de clientes já desligados: reaplicar o registro de desligamentos e invalidar essas credenciais antes de liberar rede. Registrar tempo de recuperação e descartar a cópia de ensaio conforme a mesma política.

## Corte de tenants de teste e remoção de legado

Pausar novas operações antes do backup final. O comando abaixo é somente leitura, exige URL separada e allowlist explícita e não sobrescreve um relatório existente:

```bash
node infra/efi/cutover-inventory.cjs --companies=UUID1,UUID2 --out=cutover-manifest.json
```

Definir `CUTOVER_DATABASE_URL` por segredo do operador. O relatório contém IDs, hash do CNPJ, contagens por tabela, dependências e cobranças abertas; não exporta contatos ou credenciais. Identificar o backup cifrado correspondente, reconciliar cobranças pendentes na Efí e revisar o SQL exato de exclusão contra a cópia restaurada. Preservar catálogo global e retenção de comunicações/auditoria. Não transformar uma falha ambígua em nova emissão.

A remoção física dos campos Meta/Resend/taxas antigos pertence à migração de contração: precisa ocorrer junto da remoção de todas as referências desses campos no schema e código. Esta release usa expansão compatível e não contém um `DROP COLUMN` prematuro. A execução da contração e a exclusão de tenants continuam gates do corte, não parte de `prisma:deploy` desta release.

## Homologação, smoke e primeira semana

Registrar para cada cenário: ambiente, commit/digest, IDs sintéticos, horário, resposta sanitizada e responsável. Validar com provedores reais: aviso Meta aceito antes do POST Efí; conta existente e secundária; recusa/correção; conta ACTIVE somente após certificado/EVP/escopos/webhooks; Pix/Bolix fixo e percentual com liquidação, split e tarifa efetiva; devolução no painel Efí; cobrança vencida substituída manualmente. A troca entre Boleto tradicional e Bolix não deve ser acionada em produção por esta aplicação.

Externamente, confirmar certificado de servidor e cadeia oficial Efí no hostname dedicado. Requisição sem certificado de cliente deve falhar; só a chamada Efí real comprova a cadeia cliente correta. O hostname público deve devolver 403 para as rotas Pix/abertura mesmo com cabeçalho falsificado. Confirmar callback Cobranças no hostname público, protegido pelo segredo e pela consulta autenticada da notificação.

Antes de ativar: empresa controlada troca senha, salva/sai/retoma rascunho, consente versões jurídicas aprovadas, conclui onboarding e emite uma cobrança de valor acordado. Conferir beneficiário, valor bruto, taxa e líquido. Nas primeiras 24h revisar painel e filas a cada hora; nos seis dias seguintes, ao menos início/fim do expediente. Verificar erros de abertura, solicitações incertas, filas paradas/falhas, duas falhas consecutivas de saúde, vencimento de certificado, divergências de tarifa, espaço/memória e último backup.

## Reversão

Pausar `EFI_ONBOARDING` e `EFI_PAYMENTS` pelo painel; manter callbacks e conciliação das cobranças existentes. Registrar cobranças/aberturas aceitas no intervalo. Reimplantar o digest anterior somente se compatível com a expansão; não executar migração SQL reversa automaticamente. Confirmar saúde e callback. Se o banco exigir recuperação, restaurar em novo banco isolado e reconciliar o intervalo com a Efí antes de apontar a aplicação. Nunca repetir POST de abertura ou emissão com resultado incerto. A reversão de código não desfaz contas ou cobranças criadas no provedor.
