# Plano de implementação: Datafy e conversas por empresa

> Para execução futura: usar `superpowers:executing-plans` e concluir os itens verificáveis por etapa. Este documento não autoriza iniciar deploy ou disparar mensagens reais nesta sessão de planejamento.

**Objetivo:** usar o Datafy API para WhatsApp oficial e permitir que cada empresa consulte apenas suas mensagens, enquanto o administrador acompanha e responde a todas as conversas.

**Arquitetura:** transporte configurável; histórico canônico em `Communication*`; webhook autenticado e persistido antes da confirmação; processamento BullMQ; atribuição e autorização por mensagem.

**Tecnologias:** NestJS, Prisma/PostgreSQL, BullMQ/Redis, Next.js, Docker Compose e Nginx existentes.

**Especificação:** [Desenho e decisões](../specs/2026-09-23-datafy-whatsapp-tenant-conversations-design.md).

## Restrições globais

- Um número compartilhado; empresas somente visualizam; envio e classificação manual restritos a `PLATFORM_ADMIN`.
- Não alterar Efí, Resend ou a estrutura de cobrança para adaptar o provedor de WhatsApp. O bloqueio de escopos Efí é uma dependência externa independente.
- Prisma pertence exclusivamente ao backend. Nenhuma consulta direta ao banco pelo frontend.
- Credenciais Datafy são da plataforma e ficam fora do repositório. Não pedir chaves ou certificados pelo chat.
- Preservar histórico, vínculos e jobs. Migrations aditivas; nenhuma limpeza de produção ou novo seed.
- Não usar telefone, última cobrança ou última empresa contatada como autorização de leitura.
- Não reenviar automaticamente mensagens com resultado incerto e não implementar fallback automático Datafy/Meta.
- Todos os testes automatizados usam dados sintéticos e transporte simulado. Testes de integração usam PostgreSQL e Redis descartáveis, sem ler URLs de produção.
- O deploy continua manual. Não inclui GitHub Actions, nova VPS, novo broker ou produto de chat separado.
- Antes da implementação, preservar alterações locais já presentes em `.gitignore`, onboarding Efí e `infra/interserver/`; não incluí-las incidentalmente em mudanças de mensageria.

## Pontos prioritários de revisão

| Falha a evitar | Evidência exigida | Etapas |
| --- | --- | --- |
| Empresa A acessa informação de B pelo mesmo contato | Testes de conteúdo, prévia, ordem, paginação, citações, anexos e rotas administrativas | 5, 6, 7, 8 |
| Webhook forjado, perdido ou repetido | HMAC sobre bytes, relógio inválido, confirmação após commit, recuperação após queda e concorrência | 2, 3, 8 |
| Cobrança/mensagem duplicada após timeout | Intenção persistida, chave idempotente, teste de aceitação externa seguida de falha local | 2, 4, 8 |
| Migração deixa chamadas Graph ou configurações incompatíveis | Testes dos dois transportes, paginação, limites compartilhados e validação condicional de ambiente | 1, 4, 8 |
| Deploy perde histórico ou quebra canais existentes | Migration sobre dados prévios, backup restaurável, regressão e roteiro de reversão | 2, 8, 9 |

## Ordem de execução e entregas

1. **Fundação Datafy:** etapas 1–4, validada inicialmente apenas pelo administrador.
2. **Conversas em texto por empresa:** etapas 5–6, somente após passar nos testes de isolamento.
3. **Anexos e fechamento operacional:** etapas 7–9.

A etapa 2 depende da identidade do canal definida em 1. A etapa 3 depende de 1–2; 4 depende de 1–3; 5 depende de 2–4; 6 depende de 5; 7 depende de 3 e 5; 8–9 validam o conjunto. A importação histórica opcional está descrita depois do roteiro principal.

## Etapa 1 — Transporte Datafy e configuração

**Execução:** concluída em 23/09/2026; [evidências e limites](2026-09-23-datafy-stage1-execution.md). O healthcheck foi adaptado no indicador `src/health/indicators/meta.indicator.ts`, consumido pelo `HealthService`.

**Modificar:** `api-cobranca/src/whatsapp/whatsapp.service.ts`, `whatsapp.module.ts`, `src/config/env.validation.ts`, `src/health/health.service.ts`, `src/queue/services/messaging-limit.service.ts`, `api-cobranca/.env.example`, `infra/interserver/api.env.example`.

**Criar:** em `api-cobranca/src/whatsapp/transport/`, `whatsapp-transport.ts`, `meta-direct.transport.ts`, `datafy.transport.ts`, `datafy.transport.spec.ts`.

- [x] Definir uma interface interna com `sendText`, `sendTemplate`, `createTemplate`, `listTemplates`, `getChannelInfo` e `downloadMedia`. Retornos normalizados separam aceitação, ID externo e falha segura/incerta; não retornam objetos HTTP contendo headers secretos.
- [x] Escrever testes de contrato para bearer Datafy, `/v1/{id}/messages`, `/v1/{waba}/message_templates`, `/me` e mídia fora de `/v1`. Cobrir rejeição de IDs divergentes, host não permitido e redirecionamento HTTP.
- [x] Acrescentar `WHATSAPP_TRANSPORT`, `DATAFY_API_TOKEN`, `DATAFY_WEBHOOK_SECRET`, `DATAFY_WEBHOOK_BASE_URL`. Exigir HTTPS público para o webhook em produção. Manter IDs Meta existentes como identidade e `META_DIRECT` como padrão.
- [x] Tornar obrigatórios apenas os segredos de autenticação do transporte ativo, mantendo exigências dos outros canais. `/webhooks/meta` continua validando apenas Meta e recusa pedidos sem segredo em produção ou no modo Datafy; a rota e assinatura `/webhooks/datafy` serão implementadas na etapa 3.
- [x] Encapsular o acesso HTTP atual no transporte direto e implementar o Datafy. Localizar todas as ocorrências de `graph.facebook.com` no código, inclusive a consulta de tier em `MessagingLimitService`, e encaminhar operações do modo Datafy pelo adaptador.
- [x] Normalizar erros `{statusCode,message}` Datafy e `{error:{code,...}}` Meta. Classificar 401/402/403 como ação administrativa, e 429 como espera, sem vazar resposta bruta ou token na interface.
- [x] Consultar `/me` no teste administrativo de integração para conferir WABA e número. Healthcheck frequente informa configuração/estado local; não consumir a quota externa a cada probe Docker.

**Aceite:** testes do adaptador e `env.validation.spec.ts` passam. Em Datafy não há chamada Graph direta nem necessidade artificial do token Meta; modo direto continua compatível. A configuração não torna saudável um token que apenas está preenchido: teste autenticado e configuração têm estados distintos.

## Etapa 2 — Persistência, idempotência e migração

**Modificar:** `api-cobranca/prisma/schema.prisma`; criar migration com nome `datafy_communication_context` pelo fluxo Prisma local.

**Criar:** `api-cobranca/src/communications/message-context.ts`, `communication-attribution.service.ts`, `outbound-intent.service.ts`; `api-cobranca/test/communications-postgres.cjs` como harness descartável baseado no padrão de `test/payment-postgres.cjs`.

- [x] Adicionar a `CommunicationMessage` os campos `transportChannelId`, `replyToExternalMessageId`, `messageType`, `providerTimestamp`, `source`, `attributionMethod`, `attributionRevision` e `statusOccurredAt`, com defaults/nullable que preservem registros antigos. Manter os campos empresa/cobrança/devedor existentes e suas FKs.
- [x] Criar `CommunicationWebhookDelivery`: canal, transporte, delivery ID, hash do corpo, payload criptografado, estado, tentativas, último erro sanitizado, timestamps e expiração. Unicidade composta por transporte/canal/delivery ID; índice de pendentes por estado e próxima tentativa.
- [x] Criar `CommunicationOutboundIntent`: chave idempotente única, mensagem associada, contexto, payload criptografado, estado `PENDING|SENDING|ACCEPTED|FAILED|UNCERTAIN`, transporte escolhido, ID externo e tentativas. Uma chave reutilizada com outro conteúdo ou contexto retorna conflito.
- [x] Criar `CommunicationAttributionAudit`: ator, mensagem, contexto anterior/novo, motivo e revisão. Permitir contexto nulo sem fabricar uma empresa para satisfazer o `AuditLog` existente.
- [x] Criar `CommunicationAttachment` com vínculo à mensagem, ID de mídia externo, tipo, tamanho, localização privada, estado de disponibilidade e expiração. Índices de mensagens devem atender empresa/conversa/horário/ID e referências externas.
- [x] Identificar o número compartilhado pelos IDs estáveis. A troca de transporte não pode criar outra conversa para o mesmo contato. Não converter identificadores alternativos como `from_user_id` em telefone por remoção de caracteres; preservar o tipo e deixar sem atribuição quando não houver identidade conciliada.
- [x] Preservar vínculos anteriores e deixar mensagens antigas sem origem comprovável apenas no admin. Backfill só preenche dados verificáveis, em lotes, sem inventar empresa. Criação/retentativa de mensagens não prolonga retenção já existente.
- [x] No harness, aplicar migrations anteriores, inserir conversas de duas empresas no mesmo destinatário, aplicar a nova migration e conferir conservação dos dados. Testar constraints, concorrência de intenção/entrega e acesso paginado com PostgreSQL real.

**Aceite:** schema gera Prisma Client; migração preserva histórico e rejeita vínculos inválidos. Corridas de duas gravações produzem uma intenção/entrega, sem depender apenas de consulta prévia na aplicação.

## Etapa 3 — Webhook Datafy e processamento recuperável

**Criar:** em `api-cobranca/src/webhooks/`, `datafy-webhook.controller.ts`, `datafy-signature.ts`, `datafy-signature.spec.ts`, `datafy-webhook.service.ts`, `datafy-webhook.service.spec.ts` e `datafy-event.types.ts`; em `src/queue/`, `datafy-webhook.queue.ts` e `workers/datafy-webhook.worker.ts`.

**Modificar:** `src/webhooks/webhooks.module.ts`, `webhooks.service.ts`, `src/queue/queue.module.ts` e o registro de providers necessário, evitando dependência circular entre webhook, filas e WhatsApp.

- [x] Testar assinatura com bytes que mudam ao reserializar JSON, header malformado, segredo incorreto, timestamp vazio/NaN/futuro/expirado e assinatura correta. Usar segredo sintético; validar tamanho/formato antes de `timingSafeEqual`.
- [x] Criar `POST /webhooks/datafy` com retorno explícito 200. Verificar assinatura e identidade do canal antes de persistir. Payload válido de WABA conhecido contendo evento ainda não suportado vai para triagem; canal estranho é recusado.
- [x] Persistir entrega e só então confirmar. Publicar jobs pequenos contendo o ID persistido; varredura a cada 30 segundos recupera pendentes e leases expirados. A indisponibilidade de Redis não perde uma entrega já confirmada; indisponibilidade de PostgreSQL não gera 200.
- [x] Configurar cinco tentativas locais para processamento idempotente, espera exponencial e falha terminal visível ao admin. O claim/lease no banco impede dois workers de produzir efeitos simultâneos. Replay administrativo reutiliza a entrega, sem apagar chaves de deduplicação.
- [x] Normalizar todos os eventos do lote. Validar número nos eventos de mensagens e WABA nos eventos de templates. Diferenciar mensagem ao vivo, status, template, identidade e histórico.
- [x] Transacionar inserção de mensagem e efeitos em contadores. Reentrega, inclusive com outro delivery ID, não aumenta contador nem cria mensagem adicional. Status que antecede a gravação do ID de envio fica pendente de conciliação.
- [x] Usar horário do evento para ordenar status e `max` da última entrada ao vivo para a janela; não regredir estado entregue/lido por evento antigo. Registrar falhas sem transformar um evento contraditório atrasado em autorização de reenvio.
- [x] Revisar efeitos existentes de opt-out e suprimir envios conforme a preferência aplicável. Uma mensagem ambígua de cancelamento no número compartilhado deve ser tratada pelo atendimento e bloquear novos envios a esse destinatário enquanto a preferência é resolvida, sem atribuí-la a uma empresa por suposição.
- [x] Testar queda após commit e antes de enqueue, processamento repetido, lote misto, status adiantado, template sem metadados de número e histórico antigo. Conferir limpeza de payload bruto e ausência de PII/segredos nos logs.

**Aceite:** retorno 200 rápido após persistência, abaixo dos 20 segundos do contrato; assinatura inválida nunca é confirmada. Reiniciar API/Redis não perde entregas confirmadas. Reduplicação produz um único efeito de negócio.

## Etapa 4 — Envios, limites e templates globais

**Execução:** concluída em 24/09/2026; [evidências e limites](2026-09-24-datafy-stage4-execution.md). Liberação de templates em revisão, resolução de envios incertos e remoção da inbox antiga (envio agora 410) ficaram para as etapas 5/6.

**Modificar:** `src/whatsapp/whatsapp.service.ts`, `src/queue/message.queue.ts`, `src/queue/workers/message.worker.ts`, `src/queue/services/rate-limit.service.ts`, `messaging-limit.service.ts`, `src/templates/templates.service.ts` e testes correspondentes, todos em `api-cobranca`.

**Criar:** `src/whatsapp/transport/datafy-rate-limit.service.ts`, `datafy-rate-limit.service.spec.ts` e `src/communications/outbound-intent.service.spec.ts`.

- [x] Persistir mensagem/contexto e intenção antes de transmitir. Worker de cobrança e resposta do admin usam o mesmo mecanismo, preservando a idempotência de `CollectionAttempt` e da primeira cobrança.
- [x] Testar timeout depois de transmitir, queda após aceitação, webhook recebido antes do retorno HTTP e concorrência de jobs. Estados incertos ficam bloqueados para reenvio e aparecem na triagem; não acionar outro transporte automaticamente.
- [x] Implementar limite atômico Redis por identidade do token e categoria de requisição, compartilhado por todos os caminhos e processos. Padrões não excedem 500/60/60 por minuto; usar suavização de rajadas. Não expor o token na chave Redis.
- [x] Preservar limites comerciais das empresas e limites mais restritivos do canal. Em 429 aguardar prazo válido informado; sem prazo confiável, usar espera exponencial. Consultas GET podem ter retry; POST com resultado incerto não. Redis indisponível mantém os envios pendentes.
- [x] Revisar as regras atuais de 60 mensagens/segundo do worker e 60/hora do remetente: documentar qual é proteção comercial e qual é limitação técnica, sem elevar silenciosamente a capacidade por trocar o provedor. O novo teto Datafy sempre se aplica adicionalmente.
- [x] Reaproveitar criação e catálogo global de templates. Paginar com `after` no host Datafy; nunca seguir `paging.next`. Validar exemplos de parâmetros e nome/idioma, preservar formato posicional atual e não duplicar templates já cadastrados no WABA.
- [x] Atualizar status/qualidade/categoria e componentes recebidos por webhook. Mudanças de conteúdo incompatíveis com variáveis locais deixam o template indisponível até revisão; não continuar usando parâmetros antigos nem habilitar categoria diferente silenciosamente.
- [x] Bloquear template rejeitado/pausado/desabilitado. Distinguir solicitação aceita, enviada, entregue, lida e falha. Janela de atendimento é checada novamente no worker antes de envio de texto livre.

**Aceite:** todos os envios passam pelo adaptador e controle compartilhado; duas empresas não multiplicam a quota do token. Teste com relógio simulado e 6.000 intenções demonstra limite e recuperação, sem chamar fornecedor ou enviar cobranças reais.

## Etapa 5 — Atribuição e API de consulta por empresa

**Execução:** concluída em 24/09/2026; [evidências e limites](2026-09-24-datafy-stage5-execution.md). Referência opaca de botões implementada sem template que a use; telas ficam na etapa 6.

**Modificar:** `api-cobranca/src/communications/communications.controller.ts`, `communications.service.ts`, `communications.module.ts`, `dto/reply-conversation.dto.ts`.

**Criar:** `dto/conversation-query.dto.ts`, `dto/attribute-message.dto.ts`, `dto/template-reply.dto.ts`, `communication-attribution.service.spec.ts`, `communications-tenant.service.ts`, `communications-tenant.service.spec.ts` e `communications-access.spec.ts` no módulo.

| Contrato proposto | Acesso e comportamento |
| --- | --- |
| `GET /communications/conversations` | Empresa da sessão; lista apenas conversas com mensagens visíveis, prévia e atividade calculadas dessa projeção. |
| `GET /communications/conversations/:id/messages` | Empresa da sessão; cursor e limite até 100, padrão 25, sem mensagens não atribuídas. |
| `GET /communications/admin/conversations` e detalhe existente | Admin global; adicionar filtros e paginação de mensagens. |
| `PATCH /communications/admin/messages/:id/attribution` | Admin; contexto validado, motivo obrigatório e `expectedRevision`. |
| `POST /communications/admin/conversations/:id/replies` | Admin; manter idempotencyId e acrescentar contexto opcional e referência citada. |
| `POST /communications/admin/conversations/:id/template-replies` | Admin; template global aprovado, parâmetros validados e mesmo controle de intenção. |

- [x] Escrever a fixture: contato P tem saída A, saída B, resposta citando A, resposta citando B e entrada sem referência. Resultado: A vê somente seu par; B, seu par; admin vê as cinco.
- [x] Resolver `context.id` por mensagem persistida no mesmo canal/destinatário. Referência ausente, desconhecida ou de outro contato fica sem empresa. Referência a mensagem não atribuída não cria atribuição.
- [x] Suportar respostas interativas por referência opaca gerada pelo servidor e associada ao envio. Validar destinatário e cobrança antes de resolver; ignorar empresa arbitrária trazida no payload.
- [x] Implementar atribuição manual transacional e auditada. Validar cobrança/devedor dentro da empresa e destinatário correspondente. Correções concorrentes retornam 409; reavaliar dependências e invalidar projeções quando a visibilidade mudar.
- [x] Construir consultas partindo das mensagens autorizadas. Ordenar conversas pela última mensagem visível; não usar `updatedAt`, prévia, nome de perfil global, status ou unreadCount compartilhados como campos da visão de empresa.
- [x] Derivar identificação exibida do devedor autorizado ou destinatário daquela projeção. Não retornar dados pessoais de outra empresa, trechos citados ocultos ou IDs externos desnecessários.
- [x] Cursor composto por horário/ID, opaco e vinculado a usuário/empresa/filtros. Ausência de mensagens autorizadas retorna 404 no detalhe; manipular ID, cursor, filtro ou `companyId` não altera o escopo.
- [x] Resposta administrativa com contexto nulo permanece interna ao atendimento. Com contexto selecionado, validar a relação antes de persistir intenção. Alterar conteúdo/contexto com a mesma chave de envio retorna 409.
- [x] Bloquear mutações administrativas com usuário comum mesmo quando ele conhece IDs válidos. Não marcar leitura Meta nem modificar status global ao consultar a tela da empresa.

**Aceite:** fixture A/B, ataques por ID/cursor, classificação incorreta, correção concorrente e ausência de referências passam em testes de serviço, controller e PostgreSQL real. O histórico de e-mail e `GET /communications/outbound` continuam compatíveis.

## Etapa 6 — Telas do administrador e das empresas

**Execução:** concluída em 24/09/2026; [evidências e limites](2026-09-24-datafy-stage6-execution.md). Inbox antiga redirecionada; revisão de template por ressincronização; envios incertos apenas exibidos.

**Modificar:** `front-cobranca/src/components/features/CommunicationsHistory.tsx`, seu teste `__tests__/CommunicationsHistory.test.tsx`, páginas `(dashboard)/communications/page.tsx`, `(dashboard)/admin/communications/page.tsx`, `(dashboard)/admin/templates/page.tsx` e contratos do cliente em `src/lib/api-client.ts`/`use-api-client.ts` conforme necessário.

**Criar:** em `front-cobranca/src/components/features/communications/`, `CompanyConversations.tsx`, `AdminConversationContext.tsx`, `ConversationMessages.tsx` e testes em `__tests__/`.

- [x] Separar componentes de lista/mensagens e ações administrativas, aproveitando estilos e cliente autenticado atuais. Manter o histórico de e-mail disponível.
- [x] Empresa: oferecer lista de conversas e mensagens com contexto da cobrança, data, direção e status; sem editor, botão de resposta, classificação ou ação administrativa.
- [x] Admin: mostrar empresa/cobrança por mensagem, entradas sem classificação, filtros, atribuição com motivo e contexto selecionado ao responder. Exibir resultado incerto sem oferecer reenvio imediato da mesma cobrança.
- [x] Mostrar janela de atendimento; fora dela, disponibilizar somente o fluxo de template aprovado. Se o backend recusar por expiração durante a fila, exibir o motivo com clareza.
- [x] Carregar histórico por páginas; polling de 15 segundos apenas enquanto a página está visível, cancelando requests anteriores e limpando cache ao trocar sessão/empresa. Busca e filtros sempre consultam API autorizada.
- [x] Ajustar a experiência de templates para status pendente/rejeitado/pausado, sincronização e mensagens de erro Datafy. Credenciais continuam administrativas e não são devolvidas ao frontend.
- [x] Testar empresa sem controles de envio, admin com classificação, estado vazio, 403/404, paginação, troca de sessão e parada do polling. Testar que IDs/contextos omitidos pela API não são reconstruídos usando dados globais em cache.

**Aceite:** teste de UI demonstra os papéis e os estados de erro. Consultar conversa da empresa não dispara POST/PATCH nem confirmação de leitura externa. Login de outra empresa não exibe conteúdo do cache anterior.

## Etapa 7 — Mídias protegidas e armazenamento

**Execução:** concluída em 24/09/2026; [evidências e limites](2026-09-24-datafy-stage7-execution.md). Chave derivada das chaves de pagamento; volume da VPS ainda precisa ser criado na publicação.

**Criar:** `api-cobranca/src/communications/communication-media.service.ts`, `communication-media.service.spec.ts`, `communications-media.controller.ts` e componente `front-cobranca/src/components/features/communications/MessageAttachment.tsx` com teste.

**Modificar:** módulos envolvidos, `infra/interserver/compose.yaml`, `setup.sh` e documentação de backup em `infra/interserver/README.md`.

- [x] Buscar imagem, documento e áudio pelo ID de mídia recebido em webhook validado. Processar em fila, sem atrasar confirmação do evento. Usar `/media/{id}/download`, com token apenas no servidor.
- [x] Criar volume privado persistente em `/var/lib/ciframais/communication-media`, gravável pelo usuário da API. Manter o restante do filesystem somente leitura e não expor esse volume no Nginx.
- [x] Armazenar arquivos criptografados, sem nomes fornecidos pelo usuário no caminho. Limitar a 16 MiB, conferir assinatura/tipo permitido e rejeitar redirecionamentos não permitidos. Nunca executar ou renderizar HTML/SVG como conteúdo confiável.
- [x] Implementar `GET /communications/messages/:messageId/attachments/:attachmentId` com verificação de empresa ou papel administrativo antes do acesso ao arquivo. Usar cache privado sem armazenamento, headers seguros e resposta adequada ao tipo; não devolver URL Datafy ao browser.
- [x] Testar tentativa de acessar anexo de B por A, ID de anexo ligado a outra mensagem, path traversal, tipo falso, arquivo excessivo, mídia expirada e download interrompido. Tratar esses estados na tela sem perder a mensagem.
- [x] Monitorar uso, aplicar limite operacional de 5 GiB com alerta em 80% e limpar por expiração. Falha de espaço ou download afeta só a disponibilidade do anexo. Backup/restore deve incluir arquivos e material criptográfico necessário.

**Aceite:** apenas destinatários autorizados consultam o anexo; testes provam que pedidos negados nem chegam ao armazenamento/fornecedor. Reiniciar o container preserva arquivos. Comprovantes PDF/imagens podem ser consultados sem compartilhar URL pública permanente.

## Etapa 8 — Verificação integrada e preparação da publicação

**Criar:** `api-cobranca/test/datafy-communications.e2e-spec.ts`; ampliar o harness descartável de PostgreSQL com Redis isolado para queda/retomada. Atualizar `infra/interserver/package.ps1` somente se seu empacotamento precisar incluir novos arquivos.

- [x] Executar o cenário completo com dois tenants e um telefone: cobrança, webhook citado, webhook ambíguo, classificação, resposta admin, leitura isolada e anexo protegido.
- [x] Repetir eventos, inverter status, interromper worker após commit e simular erro após aceitação externa. Conferir mensagens, intenções, contadores, auditoria e ausência de novo envio.
- [x] Exercitar modo direto e Datafy, rotação do segredo de webhook e recebimento por ambos durante uma transição. Deduplicação semântica não pode depender do nome do transporte.
- [x] Executar regressões de cobrança/primeiro envio, opt-out, templates, Efí, Resend e autenticação. Testes de transporte não usam chamadas externas reais.
- [x] Confirmar que retenção e leitura paginada utilizam índices; medir consulta A/B e ingestão com dados sintéticos em volume representativo. Registrar tempos e consumo, sem prometer capacidade da VPS antes da medição.
- [x] Preparar release identificável, migration revisável, exemplos de ambiente sem valores secretos, backup testado e runbook. Registrar os resultados dos comandos, falhas e limitações encontradas.

Comandos de validação, executados apenas durante a implementação:

```powershell
# Em C:\micro-saas\api-cobranca
npm run prisma:generate
npm test -- --runInBand
node test/communications-postgres.cjs
npm run test:e2e -- --runInBand datafy-communications.e2e-spec.ts
npx eslint src test
npm run build

# Em C:\micro-saas\front-cobranca
npx jest --runInBand CommunicationsHistory CompanyConversations AdminConversationContext MessageAttachment
npm run lint
npm run build
```

O harness deve rejeitar configuração não descartável e gerar seus próprios containers/credenciais. `prisma migrate dev` serve apenas para criar a migration em ambiente local; produção usa `prisma migrate deploy`.

**Aceite:** evidência registrada de isolamento, recuperação e não duplicação, builds e verificações relevantes concluídos. Não considerar o healthcheck sozinho como prova de integração Datafy funcionando.

**Execução:** concluída em 24/09/2026; [evidências e limites](2026-09-24-datafy-stage8-execution.md). Corrigido parser JSON global anulado pela rota Datafy; publicação manual em `infra/interserver/DATAFY.md`; smoke antigo de cobrança depende de fixture Efí por empresa.

**Datafy exclusivo (25/09/2026):** integrações diretas com a Meta removidas a pedido do responsável; [decisões e verificação](2026-09-25-datafy-only-execution.md). O roteiro de publicação passa a ser direto com Datafy.

## Etapa 9 — Deploy manual na InterServer

**Documentar em:** `infra/interserver/DATAFY.md` e atualizar referências em `README.md`.

**Atualização de escopo (25/09/2026):** Datafy é o único transporte. O responsável confirmou que ainda não gerou/enviou o novo pacote e que a VPS não envia mensagens reais. O roteiro atual é publicação direta, preservando banco, segredos, filas e versão anterior. As etapas abaixo substituem o desenho antigo de convivência com Meta direta.

- [ ] Identificar a imagem anterior e preservar o pacote atual. Fazer backup de PostgreSQL e dos arquivos necessários, conferir restauração em ambiente separado e registrar a migration prevista.
- [ ] Pausar novos disparos do canal no controle administrativo, deixar envios em andamento terminarem e registrar pendentes/incertos. Não apagar filas nem tentativas. Manter o recebimento de webhooks durante a transição sempre que possível.
- [ ] Consolidar a release em commit e gerar/conferir o pacote antes do envio. Publicar backend Datafy exclusivo e a nova rota. Aplicar migration aditiva com `compose.sh run --rm --no-deps api npm run prisma:deploy`; usar a imagem da release nova nesse comando. Não executar seed/reset.
- [ ] Preencher o ambiente privado com token Datafy, segredo, IDs e `DATAFY_WEBHOOK_BASE_URL=https://api.ciframais.com.br/webhooks/datafy`; não usar `WHATSAPP_TRANSPORT` ou token Graph. Preparar o volume de mídia e recriar o container para aplicar ambiente/mounts. Validar e recarregar Nginx após a API ficar saudável, pois o upstream atual resolve o endereço do container ao carregar a configuração.
- [ ] Conferir `/me` e a URL HTTPS. No painel Datafy, cadastrar a rota e eventos de mensagens/status/templates necessários. A rota fica no domínio API comum, sem mTLS Efí. Ajustes de body limit, se necessários, devem ser específicos à rota e medidos, sem ampliar todos os endpoints.
- [ ] Validar assinatura real e receber mensagem de um contato de teste controlado. Realizar envio de template aprovado e resposta administrativa somente para esse contato; confirmar os status e isolamento das duas empresas de teste.
- [ ] Publicar frontend na Vercel com o mesmo backend HTTPS; as credenciais Datafy não entram no ambiente público do frontend. Liberar a visualização de empresas apenas depois do teste completo.
- [ ] Retomar disparos gradualmente e observar filas, tentativas incertas, erros 401/402/403/429, atraso de webhooks, classificação pendente, disco e memória. A assinatura e eventual cobrança Datafy são externas à conta da VPS.
- [ ] Em falha, pausar saídas, manter ingestão Datafy quando possível e preservar dados. Priorizar correção compatível ou retorno a uma imagem Datafy validada. A imagem anterior com Meta direta não é alternativa automática para WhatsApp: ela não recebe o novo webhook, exige configuração antiga e compatibilidade comprovada com os dados/intenções novos. Não remover migrations nem restaurar backup sobre dados novos automaticamente.

**Aceite:** mensagem de teste recebida e respondida, template/status conferidos, empresa A sem acesso a B, sem repetição de cobranças, saúde dos serviços preservada e roteiro de recuperação disponível.

## Extensão opcional — Histórico anterior à integração

- Só executar se houver necessidade de importar conversas anteriores e se o número satisfizer as condições de coexistência documentadas.
- Ativar a ingestão do evento de histórico antes de solicitar sincronização; registrar request ID, chunks e progresso para deduplicação.
- Tratar importados como históricos e sem empresa até prova de vínculo; não abrir janela, emitir notificações de entrada ao vivo ou disparar automação de cobrança.
- Preservar placeholders quando a origem não disponibilizar a mídia. Não prometer recuperação retroativa de anexos.
- Testar com fixtures de histórico antes de uma solicitação real, pois a documentação define restrições de prazo e repetição.

## Resultado esperado

A plataforma terá seu próprio histórico autorizado por empresa, independente da tela do fornecedor. Trocar a Meta direta pelo Datafy simplifica o acesso operacional à API, mas a separação das conversas, armazenamento, templates, idempotência e autorização continuam sendo responsabilidades do CifraMais.
