# HTTPS e renovação na VPS

Use este roteiro depois de criar o administrador, preencher as credenciais da
API e instalar os certificados cliente `.p12` da Efí. O certificado público já
emitido é `ciframais-api`, com os dois nomes `api.ciframais.com.br` e
`efi-webhooks.ciframais.com.br`. Ele permanece administrado pelo Certbot em
`/etc/letsencrypt/live/ciframais-api`.

## Copiar os arquivos de configuração atualizados

No PowerShell do computador, envie apenas os arquivos desta etapa:

```powershell
scp -i "$env:USERPROFILE\.ssh\interserver_deploy" C:\micro-saas\infra\interserver\compose.yaml C:\micro-saas\infra\interserver\nginx.conf C:\micro-saas\infra\interserver\setup-https.sh C:\micro-saas\infra\interserver\deploy-certificate.sh C:\micro-saas\infra\interserver\efi-ca.sha256 C:\micro-saas\infra\interserver\HTTPS.md deploy@163.245.215.41:/home/deploy/ciframais/infra/interserver/
```

Não execute `setup.sh` novamente. Os segredos ficam fora do checkout e não são
enviados nesse comando. O Compose mantém os mesmos volumes e acrescenta somente
o diretório público de validação ACME ao Nginx.

## Instalar a configuração de homologação

Na VPS, confirme que `api.env` contém `EFI_ENV=homologation`. Execute:

```bash
cd ~/ciframais
sudo bash infra/interserver/setup-https.sh homologation
sudo bash infra/interserver/compose.sh --profile app config --quiet
```

O script verifica se o ambiente coincide com `api.env`, baixa a cadeia oficial
da Efí por HTTPS e confere seu SHA-256 contra a referência obtida separadamente
no computador em 21/09/2026. Se a Efí atualizar a cadeia, a instalação interrompe
para revisão; não substitua a verificação por uma aceitação automática.

Ele guarda a configuração anterior em `nginx.conf.before-https`, instala a
configuração com os domínios reais e instala um hook de renovação pertencente ao
root. As chaves privadas permanecem com permissão `0600`. A cadeia da Efí é usada
para verificar os clientes dos webhooks; ela não substitui os `.p12` da API.

## Iniciar API e Nginx

Com o administrador criado, credenciais reais preenchidas e `.p12` disponíveis:

```bash
sudo bash infra/interserver/compose.sh up -d --wait --wait-timeout 180 api
sudo bash infra/interserver/compose.sh run --rm --no-deps nginx nginx -t
sudo bash infra/interserver/compose.sh up -d nginx
sudo bash infra/interserver/compose.sh exec -T nginx nginx -t
sudo bash infra/interserver/compose.sh ps
```

Pare no primeiro erro. O teste via `run` é para esta primeira inicialização,
antes de haver um container Nginx em execução. Em atualizações posteriores, use
o teste via `exec` no container existente.

Confira, da VPS e depois de uma máquina externa:

```bash
curl --fail --show-error https://api.ciframais.com.br/health
curl --silent --output /dev/null --write-out '%{http_code}\n' https://api.ciframais.com.br/webhooks/efi/pix
curl --silent --output /dev/null --write-out '%{http_code}\n' https://efi-webhooks.ciframais.com.br/webhooks/efi/pix
```

O primeiro deve retornar saúde da API; o segundo deve retornar `403`; o terceiro
deve ser recusado pela exigência de certificado cliente (normalmente `400`).
Não use `curl -k`: a verificação do certificado HTTPS faz parte do teste.
Essas consultas não simulam um callback autenticado da Efí nem validam a
integração bancária completa.

## Habilitar renovação sem interromper Nginx

A primeira emissão usou `standalone`. Com Nginx ocupando a porta 80, a renovação
passará a usar `webroot`; o Nginx servirá apenas os arquivos de validação ACME
nessa porta. A aplicação e os webhooks continuam disponíveis somente em HTTPS.

Teste primeiro a rota HTTP nos dois domínios:

```bash
sudo install -d -m 755 /var/www/ciframais-acme/.well-known/acme-challenge
printf 'ciframais-acme-ok\n' | sudo tee /var/www/ciframais-acme/.well-known/acme-challenge/ciframais-check >/dev/null
sudo chmod 644 /var/www/ciframais-acme/.well-known/acme-challenge/ciframais-check
curl --fail --show-error http://api.ciframais.com.br/.well-known/acme-challenge/ciframais-check
curl --fail --show-error http://efi-webhooks.ciframais.com.br/.well-known/acme-challenge/ciframais-check
sudo rm /var/www/ciframais-acme/.well-known/acme-challenge/ciframais-check
certbot --version
```

As duas consultas devem retornar `ciframais-acme-ok`. O próximo comando exige
Certbot 2.3.0 ou mais recente; em versão anterior, atualize o Certbot antes de
continuar. `reconfigure` testa a alteração no ambiente de testes da Let's Encrypt
antes de salvar as novas opções de renovação:

```bash
sudo certbot reconfigure --cert-name ciframais-api --authenticator webroot --webroot-path /var/www/ciframais-acme
sudo certbot renew --cert-name ciframais-api --dry-run --run-deploy-hooks
sudo systemctl enable --now certbot.timer
sudo systemctl list-timers --all certbot.timer
```

Esses comandos de timer correspondem à instalação via `apt` usada nesta VPS.
O hook copia o certificado renovado para o diretório montado no container, testa
o Nginx e faz um reload. O teste com `--run-deploy-hooks` usa o certificado válido
atual, preservando a configuração de produção durante a simulação.

Confira também as mensagens do hook: o Certbot pode registrar uma falha do hook
sem usar um código de saída diferente de zero. A renovação só está verificada
depois de passar o teste, executar o hook sem erro e confirmar o timer.

## Mudanças futuras

- Mantenha a porta 80 acessível para a renovação por HTTP-01.
- Monitore a expiração e as falhas do timer/hook; emissão inicial não comprova
  que a renovação continuará funcionando indefinidamente.
- Para passar à Efí de produção, alinhe `EFI_ENV`, credenciais, `.p12` e cadeia
  cliente. O script também aceita `production`, mas não altera nem habilita
  integrações e exige que `EFI_ENV` já corresponda ao ambiente solicitado.
- O certificado HTTPS da Let's Encrypt e a renovação independem do ambiente Efí.

Referências: [renovação do Certbot](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates),
[mudança das opções de renovação](https://eff-certbot.readthedocs.io/en/stable/using.html#modifying-the-renewal-configuration-of-existing-certificates)
e [cadeias oficiais da Efí](https://dev.efipay.com.br/docs/api-pix/webhooks/).
