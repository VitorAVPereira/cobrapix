# Canal central e estatísticas — plano de implementação

> Para execução por agente: usar `superpowers:executing-plans` por tarefa. Acompanhar os passos pelos checkboxes. Não disparar mensagens reais para validar alterações sem um teste operacional controlado.

**Objetivo:** remover cotas individuais de WhatsApp, preservar somente o controle compartilhado e mostrar às empresas suas próprias estatísticas.

**Arquitetura:** reservar capacidade de envio no dispatcher central com concorrência controlada. Separar o contrato de estatísticas por empresa do contrato operacional administrativo. Preservar a intenção persistida, a fila e a recuperação de mensagens.

**Tecnologias:** NestJS, BullMQ, PostgreSQL, Redis, Datafy, Resend, Next.js e Jest.

**Especificação:** [contexto e decisões](../specs/2026-09-29-correcoes-testes-producao-design.md).

## Restrições globais

- Não existe mais cota comercial de WhatsApp por empresa nesta entrega.
- Continuam existindo controles do canal, ritmo de envio, destinatário, opt-in, templates, janela de atendimento e chaves administrativas de pausa.
- Dados de capacidade da conta central são administrativos. Estatísticas da empresa continuam consultáveis com isolamento por `companyId` da sessão.
- Retirar cota não significa apagar `MessagingUsage`, mensagens, reservas ou histórico. Campos antigos podem permanecer inertes para compatibilidade, sem influenciar envios.
- E-mail não deve herdar números, unidade ou janela do WhatsApp. Não aumentar plano do Resend, ativar excedentes pagos ou inventar limite sem conhecer o contrato da conta.

## Pontos de revisão

1. Duas empresas esgotam simultaneamente a última unidade disponível — C2: uma reserva no máximo; as demais aguardam capacidade.
2. Retry da mesma intenção ou destinatário compartilhado — C1/C2: consumo segue a unidade real do provedor e não duplica reserva.
3. Redis reinicia ou a consulta da capacidade falha — C1/C2: estado desconhecido explícito, sem declarar falsamente canal ilimitado.
4. Empresa A tenta consultar resultados de B — C3: somente métricas da sessão, incluindo eventos recebidos depois do envio.
5. A cobrança foi emitida, mas o WhatsApp ficou retido ou foi recusado — C4: motivo consultável, sem reemissão financeira.

## C1. Confirmar o contrato da capacidade central

**Consultar:** `api-cobranca/src/queue/services/messaging-limit.service.ts`, `src/whatsapp/transport/datafy.transport.ts`, `whatsapp-transport.ts`, `src/whatsapp/outbound-dispatcher.service.ts` e o contrato atual do Datafy.

**Modificar:** tipos de transporte apenas se os campos reais exigirem; atualizar `src/whatsapp/transport/README.md` com a semântica confirmada.

**Contrato proposto:** `CentralChannelCapacity` com `limit: number | null`, `used: number | null`, `remaining: number | null`, `unit`, `windowSeconds: number | null`, `scopeId`, `source`, `checkedAt`, `nextAvailableAt: string | null`. `source` distingue `PROVIDER`, `VERIFIED_CACHE`, `FALLBACK` e `UNAVAILABLE`; campos não comprovados permanecem nulos.

- [ ] Conferir a resposta de consulta do canal via Datafy, com dados sensíveis omitidos: limite/tier disponível, unidade, escopo e data da verificação. Confirmar se o limite se refere a número, WABA ou outro agrupamento; o sistema hoje tem um número, mas a chave de reserva precisa refletir o escopo real.
- [x] Documentar quais envios consomem a capacidade: não pressupor que resposta livre, template, nova conversa e qualquer mensagem tenham o mesmo custo de capacidade.
- [x] Registrar fixtures sintéticas do contrato confirmado. Se essa informação não puder ser obtida, manter o controle compartilhado conservador existente e indicar `FALLBACK`; não apresentar seu valor como limite confirmado da conta.
- [x] Retirar promessas de reset à meia-noite quando o controle representar janela móvel. Só mostrar `nextAvailableAt` quando houver base para calculá-lo.
- [x] Excluir inferências como considerar a conta ilimitada apenas por um rótulo de empresa verificada. Tier desconhecido deve continuar desconhecido.
- [x] Testar resposta conhecida, valor ausente, formato inesperado, cache verificado, cache expirado e indisponibilidade. Usar `npm test -- --runInBand messaging-limit` em `api-cobranca`.

**Aceite:** o código e a documentação distinguem capacidade conhecida de proteção conservadora local. A parte que depende da semântica do provedor só pode ser considerada comprovada com essa evidência.

## C2. Remover cotas por empresa sem perder a reserva atômica

**Modificar:** `api-cobranca/src/queue/services/messaging-limit.service.ts` e `.spec.ts`; `src/whatsapp/outbound-dispatcher.service.ts` e `.spec.ts`.

**Criar:** `api-cobranca/test/central-channel-quota.e2e-spec.ts`.

**Interface:** `reserveDispatchQuota(intentId, channelId, options)` continua centralizando a decisão antes da transmissão. Remover o significado de cota por empresa de `options.commercial`; o tipo de envio ainda pode ser necessário para aplicar a regra do provedor definida na C1.

- [x] Criar teste que configure a empresa com tier baixo, ultrapasse sua antiga cota e ainda permita envio quando houver capacidade central.
- [x] Criar teste que bloqueie temporariamente novo consumo quando a capacidade central acabar, qualquer que seja a empresa. A intenção deve continuar persistida, com motivo do canal e próxima tentativa apropriada, sem loop imediato.
- [ ] Confirmar as falhas esperadas executando `npm test -- --runInBand messaging-limit outbound-dispatcher`.
- [x] Remover a consulta de `Company.messagingLimitTier` e o segundo escopo de reserva por empresa. Manter a transação, o lock compartilhado e `quotaReservedAt` idempotente.
- [x] Auditar o cálculo envolvendo `CommunicationOutboundIntent` e `MessagingUsage`: não duplicar destinatário/reserva, não somar histórico de canal diferente e não considerar um mero retry como novo consumo.
- [x] Manter atrasos recuperáveis, respeitando o erro de limite do próprio Datafy. Não mudar template ou mandar por e-mail automaticamente quando o canal atingir capacidade.
- [x] Criar o E2E com duas empresas e várias instâncias concorrentes reservando a última capacidade; retry de intenção; destinatário compartilhado conforme unidade confirmada; janela vencida; rollback e retorno do Redis.
- [x] Executar `node test/e2e-disposable.cjs central-channel-quota.e2e-spec.ts`. SDK/transporte mockado; PostgreSQL e Redis reais, descartáveis.
- [ ] Commit sugerido: `fix: aplicar capacidade compartilhada ao WhatsApp central`.

**Aceite:** um tier antigo da empresa não barra envio; todos os envios sujeitos ao limite disputam a mesma capacidade, sem ultrapassagem por concorrência local.

## C3. Separar métricas da empresa da operação do canal

**Modificar:**

- `api-cobranca/src/whatsapp/whatsapp.controller.ts` e testes; serviço de métricas existente em `src/queue/services/messaging-limit.service.ts`.
- `api-cobranca/src/admin/admin.service.ts`, `src/admin/dto/admin-client.dto.ts`: retirar o efeito de edição de tier individual e identificar o campo antigo como obsoleto durante a compatibilidade.
- `api-cobranca/src/email/email.controller.ts` e serviço de estatísticas: conservar escopo da empresa.
- `front-cobranca/src/lib/api-client.ts`, `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/admin/visao-geral/page.tsx` e testes das telas.

**Contratos propostos:**

- `GET /whatsapp/stats`, autenticado: `{ period: 'rolling_24h', interactions: { outbound, delivered, read, inbound, failed } }`, sempre da empresa da sessão; sem `dailyLimit`, `remaining`, tier ou qualidade do número.
- `GET /whatsapp/admin/channel-capacity`, com `PlatformAdminGuard`: capacidade da C1, sem informações pessoais dos destinatários.
- `GET /email/stats`: manter resultados da empresa e explicitar o período; não acrescentar capacidade global à resposta.

- [x] Criar testes de autorização e escopo: admin consulta capacidade; usuário comum recebe 403; empresa A não altera o filtro para B; mensagens/retornos de B não entram nos agregados de A.
- [x] Acrescentar os contratos novos preservando `/whatsapp/usage` durante a publicação. Manter `sync-tier` administrativo funcionando via Datafy; se renomear método interno que contém “Meta”, preservar a compatibilidade da rota.
- [x] Atualizar dashboard para consumir somente as estatísticas da empresa. Na transição, o frontend pode extrair apenas `interactions` da resposta antiga se o endpoint novo ainda não existir; não renderizar os campos de quota legados.
- [x] Remover barras de limite, capacidade restante, tier, qualidade e mensagens sobre “seu número”. Manter enviados, entregues, lidos/recebidos e falhas do WhatsApp; enviados, entregues, aberturas e cliques do e-mail.
- [x] Rotular os períodos reais: WhatsApp hoje calculado nas últimas 24 horas não deve ser chamado de “hoje” como dia de calendário. E-mail deve mostrar o período solicitado, sem sugerir que métricas de 30 dias representam o dia atual.
- [x] Mostrar capacidade central no admin com origem e horário da informação. Qualidade e capacidade de e-mail só podem aparecer se houver fonte efetiva; caso contrário, mostrar indisponibilidade, sem inventar valores.
- [ ] Depois que o frontend compatível estiver publicado, retirar os campos de cota individual do contrato público em uma etapa coordenada. O plano de rollback deve usar versões compatíveis. O campo histórico no banco pode permanecer inerte; não fazer migration destrutiva para este objetivo.
- [x] Testar componentes por comportamento: estatísticas próprias continuam presentes, indicadores do canal ausentes no cliente e estado indisponível tratado no admin. Criar teste do dashboard caso ainda não exista.
- [x] Rodar testes dos controllers/serviços afetados; em `front-cobranca`, testes dos dashboards e `npm run build`. Commit sugerido: `feat: separar estatisticas da empresa e capacidade central`.

**Aceite:** a remoção dos limites não esvazia o dashboard; empresas continuam acompanhando seus resultados e não veem operação ou dados de outras empresas.

## C4. Verificar por que enfileirou, mas não entregou

Esta etapa preserva o problema de envio relatado antes do pedido de planejamento. Não presumir que a cota individual seja sua causa.

**Consultar/modificar conforme a reprodução:** `api-cobranca/src/queue/workers/message.worker.ts`, seus testes `message.worker.outbound-intent.spec.ts` e `message.worker.payment.spec.ts`; `src/communications/outbound-intent.service.ts`, `template-pending.service.ts`, `template-resume.service.ts`; `src/whatsapp/outbound-dispatcher.service.ts`; componentes `CommunicationsHistory` e pendências de template.

**Interface:** preservar a correlação `invoiceId → intenção → tentativa → mensagem do provedor → evento de status`. Expor estado e motivo sanitizado pelos contratos de histórico existentes, sem construir uma segunda fila.

- [x] Reproduzir com transporte simulado um envio inicial e um envio por seleção, acompanhando cada transição. Diferenciar erro financeiro, ausência de opt-in, template padrão `EMISSION` não definido/liberado, retenção para revisão, limite central, rejeição Datafy e mensagem aceita sem evento de entrega.
- [x] Testar envio explícito com `autoGenerateFirstCharge=false`. Se o guard atual da automação impedir também a ação selecionada pelo usuário, restringi-lo ao disparo automático; preservar validações financeiras e de comunicação em ambos os caminhos.
- [x] Garantir que “enfileirada” não seja apresentado como “enviada” ou “entregue”. Mostrar a pendência pelo histórico já disponível e levar o admin ao fluxo de resolução correspondente.
- [x] Se o pagamento já existe, o envio/reenvio de mensagem deve reutilizá-lo. Depois de atraso na fila, revalidar pagamento, destinatário, template e elegibilidade antes de transmitir; não enviar cobrança já paga/cancelada como se ainda devesse ser paga.
- [x] Manter revisão administrativa para retomar mensagens bloqueadas por template. Uma mudança de quota não libera essas pendências automaticamente.
- [x] Testar aceite sem webhook, falha de entrega, evento duplicado/fora de ordem e retry sem duplicar intenção. Reutilizar a infraestrutura descartável dos testes Datafy quando a alteração alcançar persistência/fila.
- [x] Atualizar `docs/operations/whatsapp-template-catalog.md` e `infra/interserver/DATAFY.md` somente nos passos operacionais afetados. Commit sugerido: `fix: tornar rastreavel o resultado do envio de cobrancas`.

**Aceite:** o operador consegue dizer em qual etapa a mensagem está e por quê; gerar pagamento e entregar mensagem não são tratados como uma única confirmação.

## Validação final desta frente

- [x] Backend: testes focados, E2E da quota, `npm test -- --runInBand` e `npm run build`.
- [x] Frontend: testes dos dashboards/histórico afetados, build e lint dos arquivos alterados.
- [ ] Não considerar a entrega externa comprovada por teste mockado. Após deploy, verificar uma mensagem para número do operador com consentimento e seus eventos Datafy, sem campanha ou disparo para clientes reais.

## Registro de execução (29/09/2026, branch `fix/canal-central-estatisticas`, a partir de `fix/pagamento-publico`)

**C1 — semântica (documentação pública; conta real ainda não consultada).** Pela
documentação da Meta (29/09/2026): o limite conta destinatários únicos alcançados
fora da janela de atendimento em 24 h móveis, por portfólio de negócios;
`messaging_limit_tier` foi descontinuado em favor de
`whatsapp_business_manager_messaging_limit`; valores atuais incluem `TIER_2K`. A
documentação do Datafy só trata de limites de requisição (4.800 envios/min por
token). O código antigo não reconhecia `TIER_2K` (caía em 50/dia) e tratava
`BUSINESS_VERIFIED` como ilimitado. Agora: parsing estrito; o transporte pede o
campo novo e recorre ao antigo; `CentralChannelCapacity` com `source`
`PROVIDER`/`VERIFIED_CACHE`/`FALLBACK`/`UNAVAILABLE`; só templates consomem
capacidade. Pendente: `POST /whatsapp/sync-tier` na conta real após o deploy, para
confirmar o campo e o formato devolvidos pelo Datafy (item 37).

**C2.** Uma reserva por canal, sob lock consultivo, sem escopo por empresa e sem
somar `MessagingUsage` (sem canal; continua gravada como histórico). Espera até a
próxima vaga (1 min–1 h) com `CHANNEL_CAPACITY_EXHAUSTED`. Códigos de limite da
Meta (130429, 131056, 131048, 80007) passam a aguardar em vez de falhar. E2E
`central-channel-quota` executado: 7 cenários em PostgreSQL + Redis descartáveis.
O cenário 7 de `outbound-dispatch-postgres.cjs` agora prova que texto dentro da
janela não consome capacidade. Os testes foram escritos junto com a mudança
(item 56 aberto).

**C3.** `GET /whatsapp/stats` (empresa da sessão, `rolling_24h`) e
`GET /whatsapp/admin/channel-capacity` (admin); `/whatsapp/usage` mantido como
deprecated (item 87 aberto: retirar depois de publicar o frontend). Edição de tier
por empresa já era recusada (`whatsapp` em `updateClient` → 400); DTO marcado
como obsoleto. Dashboard sem limite/tier/qualidade, com "Últimas 24 horas" e
"Últimos 30 dias"; e-mail informa `periodStart` e "hoje" começa à meia-noite de
Brasília. Visão geral do admin com o painel do canal central.

**C4 — causas encontradas.** (1) O guard `autoGenerateFirstCharge` barrava também
o envio **selecionado pelo usuário** ("Primeira cobrança automática desativada");
agora vale só para criação, importação e recorrência. (2) Uma emissão recusada
pela Efí (como os Bolix da frente 01) era repetida pela fila; agora recusa ou
emissão incerta encerram o job sem nova emissão, com o motivo em
`INITIAL_CHARGE_PAYMENT_FAILED`. (3) Intenção pendente registrava sempre
`WAITING_FOR_CHANNEL`; agora grava o motivo real e o admin vê "Ainda não enviada"
com a explicação. O card "Mensagens Enviadas" deixou de dizer "confirmados pela
fila" (conta aceites do provedor). Árvore de diagnóstico em
`docs/operations/whatsapp-template-catalog.md`.

**Validação:** `api-cobranca` 891 testes, build e ESLint dos arquivos alterados;
`front-cobranca` 268 testes, build e ESLint. PostgreSQL descartável:
`central-channel-quota` (7), `communications-postgres.cjs` (35 cenários, inclui
aceite sem webhook, eventos duplicados/fora de ordem, fatura paga na fila),
`payment-postgres.cjs` (16) e `payment-issuance-recovery` (6, da frente 01).
`payment-postgres.cjs` tinha um argumento posicional a mais em `BillingService`
(quebra anterior) e foi corrigido.

**Pendente:** confirmação do tier na conta real (item 37), retirada coordenada de
`/whatsapp/usage` (item 87), mensagem real para o número do operador após o
deploy (item 115) e commits.
