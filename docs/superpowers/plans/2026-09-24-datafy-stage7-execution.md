# Execução da etapa 7 — mídias protegidas e armazenamento

Plano: `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`, somente etapa 7.

## Decisões

- Ruling: continuar no checkout `dev`, preservando alterações locais; sem commit, deploy ou download real. `infra/interserver/` recebe apenas as alterações pedidas pela etapa (volume, `setup.sh`, README), sem tocar no restante.
- Ruling: fila durável no PostgreSQL. O anexo nasce `PENDING` na ingestão do webhook (etapa 3); um processo periódico reclama anexos com lease (`FOR UPDATE SKIP LOCKED`), baixa fora da transação do webhook e registra o resultado com compare-and-set. Assim a confirmação do evento nunca espera o download e vários processos da API não baixam o mesmo arquivo.
- Ruling: criptografia AES-256-GCM por arquivo, com chave derivada (HKDF, finalidade `communication-media`) das mesmas chaves versionadas de `PAYMENT_ENCRYPTION_KEYS`. Não há segredo novo: o backup de `api.env` já exigido cobre os arquivos; a rotação segue as versões existentes. O id do anexo entra como dado autenticado, então um arquivo trocado de lugar não decifra.
- Ruling: caminho sempre derivado do id gerado pelo servidor (`ab/<uuid>.bin`), nunca de nome enviado pelo usuário; a chave é validada por padrão e o caminho resolvido precisa ficar dentro do diretório raiz.
- Ruling: tipos aceitos por assinatura (magic bytes) e coerentes com o tipo declarado: JPEG, PNG, WebP, PDF e áudio (OGG/Opus, MP3, MP4/M4A, AAC, AMR). Vídeo, SVG, HTML e outros documentos ficam `UNAVAILABLE` com código explícito. Nada é renderizado como HTML/SVG.
- Ruling: limite operacional de 5 GiB (configurável por `COMMUNICATION_MEDIA_LIMIT_BYTES`), alerta a partir de 80% no healthcheck (degradado, sem derrubar o container) e em log. Limite atingido, falta de espaço ou falha de download afetam só o anexo.
- Ruling: resposta do download com `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, CSP `default-src 'none'; sandbox`; imagens e áudio `inline`, PDF sempre como `attachment`. Anexo de outra empresa ou de outra mensagem responde 404 sem ler o armazenamento.
- Ruling: o healthcheck de mídia é consultivo: pode deixar o status geral "degradado", mas nunca mascara falha do banco ou do canal (um banco fora do ar continua respondendo 503).
- Ruling: a fila roda em todos os processos da API a cada 15 s (até 10 anexos por ciclo); a limpeza por expiração, de hora em hora. O arquivo é apagado quando a retenção termina; a mensagem e os metadados do anexo continuam, como `EXPIRED`.

## Checklist

- [x] Download de imagem, documento (PDF) e áudio pelo ID recebido no webhook validado, em fila durável com lease, cinco tentativas e espera exponencial; `/media/{id}/download` com token só no servidor.
- [x] Volume privado `/var/lib/ciframais/communication-media` (UID 1000, modo 700) montado só na API; restante do filesystem continua somente leitura; Nginx sem acesso.
- [x] Arquivos cifrados, caminho derivado do id, limite de 16 MiB, assinatura/tipo conferidos, sem redirecionamento (transporte já recusa), HTML/SVG nunca servidos.
- [x] `GET /communications/messages/:messageId/attachments/:attachmentId` com autorização por empresa ou admin antes de ler o arquivo; cache privado sem armazenamento, headers seguros, sem URL do provedor.
- [x] Testes: anexo de B pedido por A, id de anexo de outra mensagem, path traversal, tipo falso, arquivo grande, mídia expirada, download interrompido, arquivo trocado, reinício com o mesmo volume.
- [x] Uso monitorado no `/health`, limite de 5 GiB com alerta em 80%, limpeza por expiração; backup/restauração documentados com arquivos e chaves.
- [x] Tela: `MessageAttachment` carrega sob demanda, mostra imagem/áudio, oferece PDF só para download e explica pendente, expirado e indisponível sem perder a mensagem.

## Entregas

- Backend: `communication-media.service.ts` (fila, download, validação, cifragem, leitura autorizada, expiração, uso), `communication-media-format.ts` (assinaturas e AES-256-GCM), `communication-media-storage.ts` (armazenamento atômico e contido), `communications-media.controller.ts`, indicador `health/indicators/communication-media.indicator.ts`, `PaymentCryptoService.derivedKey` (HKDF por finalidade), código `MEDIA_TOO_LARGE` no transporte e `errorCode` dos anexos nas respostas da empresa e do admin.
- Migration aditiva `20260924230000_datafy_communication_media`: fila do anexo (`attempts`, `nextAttemptAt`, lease, `errorCode`, `sha256`, `storedAt`) e índice por estado/próxima tentativa. Aplicada só nos bancos descartáveis.
- Variáveis opcionais `COMMUNICATION_MEDIA_DIR` (caminho absoluto) e `COMMUNICATION_MEDIA_LIMIT_BYTES`, validadas e documentadas em `.env.example` e `infra/interserver/api.env.example`.
- Infra: bind mount no `compose.yaml` (apenas serviço `api`), criação do diretório em `setup.sh`, instruções para VPS existente e backup/restauração no `infra/interserver/README.md`. `package.ps1` já empacota esses arquivos; não foi alterado.
- Frontend: `MessageAttachment.tsx` (+ teste), `ApiClient.fetchAttachment` e envio autenticado comum (`send`), que também corrige a leitura do corpo de erro que não era JSON.

## Como validar

```powershell
# api-cobranca
npm run prisma:generate
npm test -- --runInBand
npm run test:communications:postgres
npx eslint src
npm run build

# front-cobranca
npx jest --runInBand
npm run lint
npm run build
```

`test/communication-media-postgres.cjs` usa o PostgreSQL descartável do harness e um diretório temporário próprio, removido ao final; o transporte é simulado.

## Verificação

- Backend: 84 suítes / 549 testes; ESLint e build sem erros; tipagem dos specs sem erros novos. Teste de fumaça de injeção de dependências de `CommunicationsModule` e `HealthModule` resolvendo os serviços novos.
- Harness PostgreSQL 16 (33 migrations): dois processos esvaziam a fila com um download por arquivo; arquivo cifrado em disco e com permissão 600; tipo falso (HTML declarado como PDF) e download interrompido tratados; empresa A só abre o próprio anexo, B e ids trocados recebem 404, pendente 409, indisponível 422, e nenhum desses pedidos lê o armazenamento; admin abre qualquer anexo, PDF como `attachment`; arquivo lido por um novo processo (reinício); arquivo copiado sobre outro anexo detectado e marcado `STORAGE_CORRUPTED`; expiração apaga o arquivo, responde 410 e preserva a mensagem.
- Unitários: assinaturas aceitas e recusadas (SVG, HTML, MP4 de vídeo, DOCX), coerência de tipo declarado, cifragem vinculada ao id e leitura com versão de chave anterior, bloqueio de path traversal, escrita atômica, estados 404/409/410/422, códigos de falha, espera exponencial, limite de armazenamento, headers do download, healthcheck consultivo e validação de ambiente.
- Frontend: 35 suítes / 123 testes (`MessageAttachment`: carregamento sob demanda, revogação da URL, PDF só para download, SVG recusado, 404/410/422 sem perder a mensagem, estados sem botão); `next build` e lint sem erros.
- `compose.yaml` validado com `docker compose config`; `setup.sh` com `bash -n` e finais de linha LF.
- Não verificado: download real do Datafy/Meta e o volume na VPS (etapas 8/9).

## Limitações e pendências

- Na VPS já configurada, o diretório precisa ser criado manualmente antes de recriar a API (instrução no README); `setup.sh` só roda em instalação nova.
- O empacotamento (`package.ps1`) usa `git ls-files`: os arquivos novos das etapas 1–7 só entram no pacote depois de versionados.
- Vídeo e documentos que não sejam PDF ficam indisponíveis com motivo explícito.
- A fila por processo baixa em série (até 10 por ciclo de 15 s) e usa a quota de consultas do Datafy (60/min); volume alto de mídia exigirá medir na etapa 8.
