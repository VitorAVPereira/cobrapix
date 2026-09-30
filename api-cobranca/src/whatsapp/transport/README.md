# Transporte WhatsApp

O WhatsApp da plataforma usa **exclusivamente o Datafy** (API compatível com a Cloud
API da Meta). Não há integração direta com a Meta: não existe token Graph, webhook
`/webhooks/meta` nem seleção de transporte por ambiente. `WhatsappTransportModule`
sempre cria `DatafyTransport`, que concentra HTTP, autenticação, destinos permitidos,
quota e normalização das respostas. As regras de template ficam na política de
templates (`src/templates`), aplicada na preparação e novamente na transmissão.

| Configuração | Valor |
| --- | --- |
| Credencial de envio | `DATAFY_API_TOKEN` (`sk_live_…`) |
| Identidade | `META_PHONE_NUMBER_ID` e `META_BUSINESS_ACCOUNT_ID` (IDs da WABA), conferidos contra `/me` |
| Versão de URL | `/v1` fixo em `https://cloud.datafyapi.com.br` |
| Segredo de webhook | `DATAFY_WEBHOOK_SECRET` (`POST /webhooks/datafy`), com `DATAFY_WEBHOOK_SECRET_PREVIOUS` só durante rotação |
| URL pública | `DATAFY_WEBHOOK_BASE_URL` contém a URL completa `/webhooks/datafy` |

Em produção todas são obrigatórias e o webhook exige domínio HTTPS público, sem
credenciais ou parâmetros na URL. Fora de produção podem ficar vazias: o canal fica
não configurado e cobranças registram o envio como pendente. Tokens não são
parâmetros de métodos nem campos retornados aos clientes. Registros antigos com
`transport = META_DIRECT` continuam no banco como histórico; uma intenção pendente
desse transporte falha antes de transmitir e nunca é enviada pelo Datafy.

## Teste de autenticação

`POST /whatsapp/admin/test-integration`, com a autenticação JWT já utilizada pelo
backend, exige `PLATFORM_ADMIN`. O endpoint consulta `/me` e não envia mensagens;
recusa a integração se os IDs retornados não coincidirem com os configurados. A
resposta expõe apenas a identidade necessária ao administrador, transporte,
`authentication: AUTHENTICATED`, instante da consulta e suporte de webhook. HTTP 201
indica que essa verificação terminou; não confirma recebimento de eventos, entrega
de mensagens ou capacidade de cobrança.

`/health` não chama o fornecedor: informa configuração local completa e
`authentication: NOT_CHECKED`; não é evidência de token válido.

As estatísticas da empresa (`GET /whatsapp/stats`, empresa da sessão) são as
mensagens dela nas últimas 24 horas (janela móvel) no histórico de conversas,
com os status recebidos pelo webhook Datafy: enviadas, entregues, lidas,
falhas e respostas. Não trazem limite, tier, capacidade ou qualidade do número.
`GET /whatsapp/usage` continua respondendo durante a transição, com campos de
cota que não limitam mais nenhum envio.

## Envios, limites e templates (etapa 4)

Todo envio WhatsApp passa por `OutboundDispatcherService`: a mensagem, o contexto e a
intenção (`CommunicationOutboundIntent`) são persistidos antes da transmissão, com chave
idempotente obrigatória. Cobranças (`collection:<empresa>:<fatura>:<etapa>:WHATSAPP`),
respostas administrativas (`admin-reply:<id>`, sempre enfileiradas) e avisos do
onboarding Efí usam o mesmo ciclo. O envio pela inbox antiga
(`POST /whatsapp/conversations/:id/reply`) responde 410.

| Estado | Significado | Reenvio automático |
| --- | --- | --- |
| `PENDING` | Não transmitido; aguarda capacidade, canal pausado, Redis ou banco. `lastErrorCode` diz o motivo (`CHANNEL_CAPACITY_EXHAUSTED`, `PROVIDER_RATE_LIMIT`, `CHANNEL_CONTROL_UNAVAILABLE` ou `WAITING_FOR_CHANNEL`) | Sim, pela recuperação a cada 10 s após `nextAttemptAt` |
| `SENDING` | Reclamado por um worker com lease de 60 s | Não; lease expirado vira `UNCERTAIN` |
| `ACCEPTED` | Provedor aceitou; entrega/leitura chegam por webhook | Não |
| `FAILED` | Rejeitado antes de transmitir ou recusa definitiva | Não; exige nova ação |
| `UNCERTAIN` | Pode ter sido aceito (timeout, falha local após aceitação) | Nunca; triagem em `GET /communications/admin/outbound-intents` |
| `BLOCKED` | Retido pela política de templates, com pendência registrada | Nunca; só após revisão e confirmação do admin, como nova geração |

Se o provedor aceitar depois do lease expirar, a prova de aceitação ainda é gravada
(`WORKER_LOST_AFTER_CLAIM` → `ACCEPTED`), porque intenções incertas nunca são
reclamadas por outro worker. Uma falha transitória no commit da aceitação é repetida
até três vezes sem nova transmissão. Não existe troca automática de transporte: uma
intenção criada para outro transporte/número falha antes de transmitir.

Antes de cada transmissão o worker confere novamente canal pausado, opt-out do
destinatário, janela de atendimento (texto livre), fatura ainda pendente e opt-in do
devedor. Para templates, a autorização final ocorre na mesma transação que reclama a
intenção: o snapshot fixado na preparação (template, revisões de conteúdo e de
variáveis, versão da política e da liberação) precisa continuar válido e os dados do
contexto precisam produzir a mesma impressão digital. Qualquer divergência vira
`BLOCKED` com uma pendência, sem transmitir.

### Limites aplicados

| Limite | Valor | Natureza | Escopo |
| --- | --- | --- | --- |
| BullMQ `whatsapp-messages` | 60 jobs/s, concorrência 20 | Técnico (vazão do worker) | Processo |
| Remetente | 60 mensagens/h | Proteção local existente | Número compartilhado (`sender:<phone_number_id>`) |
| Destinatário | 20 mensagens/h | Proteção local existente | Telefone |
| Capacidade do canal central | Tier confirmado pelo Datafy; sem confirmação, 50 (proteção local) | Limite de mensagens da Meta | Canal (`channel:<phone_number_id>`), somando todas as empresas |
| Quota Datafy | envio 500/min, upload 60/min, demais 60/min, espaçados sem rajada | Técnico (contrato do provedor) | Hash do token, todos os processos |

Não existe cota por empresa: `Company.messagingLimitTier` e `MessagingUsage`
permanecem só como histórico e não influenciam envios. Os limites se somam. O teto
de 60/h do remetente vale para o número inteiro e é hoje o limite efetivo da
plataforma. A documentação pública do Datafy consultada em 24/09/2026 informa
4.800 envios/min; os valores acima são deliberadamente conservadores. Redis
indisponível nunca libera envio: a intenção permanece pendente. Em 429 o prazo
informado é respeitado; sem prazo confiável, espera exponencial. Os códigos de
limite da Meta repassados pelo Datafy (130429, 131056: 60 s; 131048, 80007: 1 h)
também deixam a intenção pendente, com `PROVIDER_RATE_LIMIT`. Consultas GET podem
repetir até duas vezes; POST com resultado incerto não repete.

### Capacidade do canal central

Semântica confirmada na documentação da Meta (consultada em 29/09/2026): o limite
é o número de **destinatários únicos alcançados fora de uma janela de
atendimento em 24 horas móveis**, definido por **portfólio de negócios** e
compartilhado por todos os números dele. Valores atuais: `TIER_250`, `TIER_2K`,
`TIER_10K`, `TIER_100K`, `TIER_UNLIMITED` (`TIER_50` e `TIER_1K` ainda são
aceitos). O campo `messaging_limit_tier` foi descontinuado em favor de
`whatsapp_business_manager_messaging_limit`; o transporte pede o novo e só recorre
ao antigo quando o Datafy recusa ou omite o novo. Nenhum rótulo diferente de um
tier exato (por exemplo, empresa verificada) é tratado como limite, muito menos
ilimitado.

Aplicação local:

- Só **templates** reservam capacidade; texto livre só é transmitido com a janela
  de atendimento aberta e não conta para a Meta.
- A reserva (`reserveDispatchQuota`) ocorre antes da transmissão, sob um lock
  consultivo por canal, na mesma transação que grava `quotaReservedAt`. Um retry
  da mesma intenção não reserva de novo; um destinatário já alcançado nas últimas
  24 h não consome nova vaga, qualquer que seja a empresa.
- Canal cheio: a intenção fica `PENDING` com `CHANNEL_CAPACITY_EXHAUSTED` e nova
  tentativa quando a vaga mais antiga sai da janela (entre 1 min e 1 h); não troca
  template nem canal.
- O escopo da reserva é o número (`phone_number_id`). Com um único número isso
  equivale ao portfólio; incluir outro número do mesmo portfólio exigiria somá-los.
- `GET /whatsapp/admin/channel-capacity` (somente admin) informa `limit`, `used`,
  `remaining`, `tier`, `source`, `checkedAt` e `nextAvailableAt` (só quando
  esgotado). `source`: `PROVIDER` (lido agora), `VERIFIED_CACHE` (lido nas últimas
  24 h), `FALLBACK` (sem tier confirmado; vale a proteção de 50, que não é o
  limite da conta) ou `UNAVAILABLE` (Redis ou banco sem resposta; nada é
  liberado). `POST /whatsapp/sync-tier` (admin) consulta o Datafy e guarda o tier
  por 24 h. Não há promessa de reinício à meia-noite: a janela é móvel.

### Templates

Os templates são criados e aprovados no WhatsApp Manager da Meta; a aplicação não
cria, edita nem submete conteúdo (as rotas antigas respondem 410
`TEMPLATE_AUTHORING_MOVED_TO_META` e o transporte não tem mais operação de criação).
O catálogo é importado pelo Datafy, identificado por WABA + ID do provedor:

- **Sincronização** (`POST /admin/whatsapp-templates/sync`, periódica a cada 15 min e
  pedida por eventos): confere o `/me`, percorre as páginas com o cursor `after` no
  host Datafy (nunca segue `paging.next`) sob um lease no banco, e só marca como
  indisponível o que faltou numa varredura completa. Eventos de status, qualidade,
  categoria e componentes atualizam o catálogo; uma mudança de conteúdo gera nova
  revisão do provedor e exige revisar as variáveis.
- **Variáveis**: o admin associa cada variável do corpo a uma fonte fechada (nome do
  devedor, valor, vencimento, links...) ou a um texto fixo curto, com prévia fictícia.
  Templates posicionais (`{{1}}`, `{{2}}`) e nomeados (`{{nome_devedor}}`, conforme o
  `parameter_format` aprovado) são aceitos; nos nomeados cada parâmetro é enviado com
  `parameter_name`. Outros formatos aparecem como não suportados.
- **Botões**: no máximo um botão de URL, que precisa apontar para o link de pagamento
  (`<FRONTEND_URL>/pagar/{{1}}`), em qualquer posição, e respostas rápidas estáticas,
  enviadas como aprovadas. Telefone, copiar código e outros tipos não são suportados.
  Cada gravação é uma revisão imutável vinculada à revisão do conteúdo.
- **Liberação**: novo template não é liberado para ninguém. O admin libera por
  empresa e define o padrão de cada finalidade (emissão, lembretes, atrasos, avisos
  de ativação). A empresa só vê e escolhe o que foi liberado.
- **Bloqueio sem substituição**: se o template escolhido não está disponível, o envio
  vira uma pendência (`WhatsappTemplatePendingSend`); nunca é trocado por outro
  automaticamente. Corrigir liberação ou variáveis não retoma nada: o admin revisa as
  pendências (prévia de 15 min, até 50 itens) e confirma com chave idempotente.
  Envios `ACCEPTED`, `SENDING` ou `UNCERTAIN` nunca são retomados.
- Recusas do provedor ligadas ao template (132000, 132001, 132005, 132007, 132012,
  132015, 132016) também viram pendência e pedem nova sincronização.

Operação e transição: [docs/operations/whatsapp-template-catalog.md](../../../../docs/operations/whatsapp-template-catalog.md).

## Referências

- [Introdução Datafy](https://developers.datafyapi.com.br/api-reference/whatsapp/introducao)
- [Identidade /me](https://developers.datafyapi.com.br/api-reference/whatsapp/datafy/me)
- [Requisições e limites](https://developers.datafyapi.com.br/api-reference/whatsapp/visao-geral/requisicoes)
- [Messaging limits (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [Download de bytes](https://developers.datafyapi.com.br/api-reference/whatsapp/datafy/baixar-arquivo-midia)
