# Transporte WhatsApp

O WhatsApp da plataforma usa **exclusivamente o Datafy** (API compatível com a Cloud
API da Meta). Não há integração direta com a Meta: não existe token Graph, webhook
`/webhooks/meta` nem seleção de transporte por ambiente. `WhatsappTransportModule`
sempre cria `DatafyTransport`, que concentra HTTP, autenticação, destinos permitidos,
quota e normalização das respostas; `WhatsappService` mantém as regras de template.

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
`authentication: NOT_CHECKED`; não é evidência de token válido. A consulta de tier
usa o canal compartilhado e não altera cotas comerciais das empresas. O consumo das
últimas 24 h em `GET /whatsapp/usage` vem das mensagens da empresa no histórico
de conversas (status recebidos pelo webhook Datafy).

## Envios, limites e templates (etapa 4)

Todo envio WhatsApp passa por `OutboundDispatcherService`: a mensagem, o contexto e a
intenção (`CommunicationOutboundIntent`) são persistidos antes da transmissão, com chave
idempotente obrigatória. Cobranças (`collection:<empresa>:<fatura>:<etapa>:WHATSAPP`),
respostas administrativas (`admin-reply:<id>`, sempre enfileiradas) e avisos do
onboarding Efí usam o mesmo ciclo. O envio pela inbox antiga
(`POST /whatsapp/conversations/:id/reply`) responde 410.

| Estado | Significado | Reenvio automático |
| --- | --- | --- |
| `PENDING` | Não transmitido; aguarda quota, canal pausado, Redis ou banco | Sim, pela recuperação a cada 10 s após `nextAttemptAt` |
| `SENDING` | Reclamado por um worker com lease de 60 s | Não; lease expirado vira `UNCERTAIN` |
| `ACCEPTED` | Provedor aceitou; entrega/leitura chegam por webhook | Não |
| `FAILED` | Rejeitado antes de transmitir ou recusa definitiva | Não; exige nova ação |
| `UNCERTAIN` | Pode ter sido aceito (timeout, falha local após aceitação) | Nunca; triagem em `GET /communications/admin/outbound-intents` |

Se o provedor aceitar depois do lease expirar, a prova de aceitação ainda é gravada
(`WORKER_LOST_AFTER_CLAIM` → `ACCEPTED`), porque intenções incertas nunca são
reclamadas por outro worker. Uma falha transitória no commit da aceitação é repetida
até três vezes sem nova transmissão. Não existe troca automática de transporte: uma
intenção criada para outro transporte/número falha antes de transmitir.

Antes de cada transmissão o worker confere novamente canal pausado, opt-out do
destinatário, janela de atendimento (texto livre), template aprovado e sem revisão
pendente, fatura ainda pendente e opt-in do devedor.

### Limites aplicados

| Limite | Valor | Natureza | Escopo |
| --- | --- | --- | --- |
| BullMQ `whatsapp-messages` | 60 jobs/s, concorrência 20 | Técnico (vazão do worker) | Processo |
| Remetente | 60 mensagens/h | Proteção local existente | Número compartilhado (`sender:<phone_number_id>`) |
| Destinatário | 20 mensagens/h | Proteção local existente | Telefone |
| Destinatários únicos/24 h | Tier do canal (`TIER_50` sem tier verificado) | Limite do número na WABA | Número compartilhado, somando todas as empresas |
| Destinatários únicos/24 h | `messagingLimitTier` da empresa | Proteção comercial | Empresa |
| Quota Datafy | envio 500/min, upload 60/min, demais 60/min, espaçados sem rajada | Técnico (contrato do provedor) | Hash do token, todos os processos |

Os limites se somam. O teto de 60/h
do remetente vale para o número inteiro e é hoje o limite efetivo da plataforma. A
documentação pública do Datafy consultada em 24/09/2026 informa 4.800 envios/min;
os valores acima são deliberadamente conservadores. Redis indisponível nunca libera
envio: a intenção permanece pendente. Em 429 o prazo informado é respeitado; sem
prazo confiável, espera exponencial. Consultas GET podem repetir até duas vezes;
POST com resultado incerto não repete.

### Templates

O catálogo é global. A sincronização percorre as páginas com o cursor `after` no host
Datafy e nunca segue `paging.next`. A criação reutiliza um template já existente no
WABA com o mesmo nome/idioma em vez de duplicá-lo. Eventos de status, qualidade,
categoria e componentes atualizam o catálogo em ordem cronológica. Mudança de
categoria ou de conteúdo incompatível com as variáveis posicionais locais marca
`metaReviewRequired`; um evento `APPROVED` posterior não remove essa marca. Template
rejeitado, pausado, desabilitado ou em revisão não é enviado. O administrador conclui a
revisão em `POST /templates/:id/review`, que relê o provedor e só libera se o template
aprovado bater com o local (categoria, corpo, rodapé, botões e variáveis).

## Referências

- [Introdução Datafy](https://developers.datafyapi.com.br/api-reference/whatsapp/introducao)
- [Identidade /me](https://developers.datafyapi.com.br/api-reference/whatsapp/datafy/me)
- [Requisições e limites](https://developers.datafyapi.com.br/api-reference/whatsapp/visao-geral/requisicoes)
- [Download de bytes](https://developers.datafyapi.com.br/api-reference/whatsapp/datafy/baixar-arquivo-midia)
