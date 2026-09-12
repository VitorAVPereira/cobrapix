# Implantação da abertura Efí

Esta pasta contém a imagem da API, o Compose com Redis privado e o Nginx para o hostname público e o hostname exclusivo dos webhooks Efí. A configuração mantém `EFI_ONBOARDING` desligada no banco até a habilitação explícita no painel administrativo.

## Preparação da instância

Provisionar Lightsail de 2 GB em São Paulo, instalar Docker com Compose, apontar os dois hostnames reais para a instância e liberar externamente apenas 80/443. Substituir `api.ciframais.example` e `efi-webhooks.ciframais.example` em `nginx.conf` pelos hostnames aprovados. Manter API e Redis apenas na rede `backend` do Compose; não publicar 3001 nem 6379.

Criar `/opt/ciframais/secrets/api.env`, `/opt/ciframais/secrets/efi/` e `/opt/ciframais/secrets/tls/` com acesso restrito ao operador e sem incluí-los no repositório ou em backups em texto puro. Preencher o arquivo de ambiente conforme `api-cobranca/.env.example`, com `NODE_ENV=production`, `EFI_ENV=production`, `EFI_LEGAL_APPROVED=false`, chaves de criptografia versionadas, credenciais centrais Meta/Resend/Efí e URLs HTTPS. Os caminhos `EFI_OPENING_CERT_PATH` e `EFI_PLATFORM_CERT_PATH` devem apontar para os P12 montados dentro do contêiner em `/run/efi/`. O certificado TLS público e sua chave ficam em `tls/api-fullchain.pem`, `tls/api-key.pem`, `tls/efi-fullchain.pem` e `tls/efi-key.pem`.

O arquivo `tls/efi-client-ca.pem` deve conter a cadeia oficial de CA indicada pela Efí para o ambiente escolhido. Conferir origem e fingerprint fora do servidor antes da instalação; a CA gerada por `test-mtls.cjs` serve exclusivamente aos testes locais. O Nginx exige certificado de cliente no hostname dedicado e o NestJS aceita a asserção mTLS apenas do IP fixo do proxy configurado no Compose.

## Verificação local e subida

Na raiz do repositório, executar:

```bash
cd api-cobranca
npm ci
npm test -- --runInBand
npm run build
cd ..
node infra/efi/test-database.cjs
docker build -t ciframais-efi-local:verification api-cobranca
node infra/efi/test-runtime.cjs
node infra/efi/test-mtls.cjs
docker compose -f infra/efi/compose.yaml config --quiet
```

Os scripts de banco e runtime criam e removem contêineres de teste próprios. Eles nunca devem usar a URL do Neon de produção. Antes de subir a aplicação, criar um backup identificado do Neon e um snapshot da instância, com restauração ensaiada. Aplicar somente as migrações aditivas por `docker compose -f infra/efi/compose.yaml run --rm api npm run prisma:deploy`, conferir o resultado e subir com `docker compose -f infra/efi/compose.yaml up -d`. Confirmar `/health`, a conexão com Redis, as filas e os estados pausados em `/admin/integrations/health`.

Consulte [ROLLOUT.md](ROLLOUT.md) para seed mínimo, instalação dos timers, backup cifrado, inventário de corte, smoke, monitoramento e reversão.

## Homologação e liberação

1. Aprovar os textos de autorização, termos e privacidade e substituir as versões `draft-v1`. Definir `EFI_LEGAL_APPROVED=true` somente após essa aprovação.
2. Confirmar com a Efí os escopos da aplicação integradora, a disponibilidade da API de abertura, os webhooks e a cadeia mTLS oficial. Homologar o fluxo completo, inclusive recusa, timeout ambíguo, conta existente e secundária.
3. Emitir e liquidar Pix e Bolix nas combinações de taxa fixa e percentual. Boleto tradicional fica somente no histórico, por decisão do produto. Conferir split, tarifa efetiva, webhooks e substituição manual da cobrança vencida.
4. Fazer o teste mTLS **externo** com certificado Efí válido e sem certificado; confirmar que o hostname público rejeita callbacks falsificados. O teste local não substitui esta etapa.
5. Fazer backup identificado dos tenants de teste, revisar a lista e dependências, e só então excluí-los. A migração de remoção dos campos legados deve ser preparada e revisada sobre esse estado conhecido; nunca executá-la durante a implantação aditiva.
6. Configurar os segredos reais de produção, executar um smoke test com empresa controlada e habilitar novas aberturas no painel administrativo. Monitorar durante a primeira semana onboarding, filas, saúde da conta, certificados, divergências de tarifa e callbacks.

Manter snapshots diários da instância e backups criptografados do Neon e segredos, com retenção máxima de 30 dias para cópias que incluam credenciais de clientes desligados. A política de snapshots e a remoção de backups antigos precisam ser configuradas no provedor; o Compose não as agenda. Em incidente, pausar `EFI_ONBOARDING` e `EFI_PAYMENTS` pelo painel, preservando cobranças já emitidas. Restaurar um backup em ambiente isolado antes de qualquer rollback de banco.
