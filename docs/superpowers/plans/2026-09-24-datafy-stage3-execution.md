# Execução — etapa 3 do plano Datafy

Plano: `2026-09-23-datafy-whatsapp-tenant-conversations-plan.md`, somente etapa 3.

## Escopo e decisões

- Continuar no checkout local já autorizado e preservar etapas 1/2, Efí e infra. Sem deploy, envio real, frontend ou implementação da etapa 4.
- Contrato público conferido em 24/09/2026: `/webhooks/validar-assinatura`, `/webhooks/receber-eventos` e exemplos `/webhooks/eventos/{mensagens,status-de-mensagem,templates,historico,contatos-sincronizados}` da documentação Datafy. Leitura via páginas `.md` porque o navegador não conseguiu abri-las.
- Ruling: a etapa 3 precisa de uma migration aditiva complementar para fencing do lease, metadados de triagem/replay, supressão global de destinatário e status pendentes de conciliação. Não modificar a migration concluída da etapa 2. Sem esses campos, um status adiantado ou opt-out ambíguo seria perdido.
- Pre-flight 2→3: `CommunicationWebhookDelivery` armazena corpo criptografado e agenda; a unicidade global de mensagem é preservada. Lease com token impede um worker antigo de finalizar trabalho de outro. Efeitos de um lote e sua finalização são transacionais.
- Pre-flight 3→4: eventos de templates são classificados e mantidos para triagem; aplicar mudanças de catálogo/componentes pertence à etapa 4. O webhook não transmite nem reinicia intenções incertas.
- Pre-flight 3→5: entradas ficam sem empresa; referências citadas são preservadas para atribuição futura. Telefone nunca escolhe tenant. Opt-out em número compartilhado bloqueia o destinatário globalmente, sem modificar consentimentos de uma empresa por suposição.
- Ruling: histórico e sincronização de identidade são classificados e retidos para triagem, sem importar mensagens, abrir janela ou alterar contadores. Importação do histórico é a extensão opcional do plano, não parte desta etapa.
- Ruling: triagem e replay serão acessíveis por endpoints administrativos autenticados, sem expor payload bruto. Telas permanecem na etapa 6.
- Ruling: filas usam Redis DB 0 e mensagens pequenas (ID da entrega). O banco controla as cinco tentativas, o prazo e o lease; BullMQ pode perder seus jobs sem perder a entrega. Recuperação e conciliação a cada 30 segundos.
- Ruling: consultas internas de ingestão, recuperação, deduplicação e preferências do número compartilhado abrangem o canal global. Nenhum telefone autoriza leitura por empresa; rotas de triagem/replay exigem JWT e `PLATFORM_ADMIN`, com papel reconferido no banco.
- Ruling: uma sobreposição Meta/Datafy deve preservar contadores e status. A entrada Meta reutiliza a gravação transacional e o opt-out; seus status passam a respeitar destinatário, canal e ordem. Sua assinatura continua exclusivamente Meta.

## Entregas

- `POST /webhooks/datafy`: valida HMAC sobre timestamp + corpo original, formato dos headers, relógio (até 300 segundos antigos e 30 segundos futuros) e todos os WABAs/números do lote. Persiste corpo criptografado e hash antes de responder explicitamente 200. Redis indisponível adia publicação sem perder a entrega; falha de persistência retorna 503. Publicação espera no máximo 250 ms, e gravação tem prazo de 8 segundos.
- Corpo limitado a 1 MiB somente nesta rota e normalização limitada a 1.000 eventos por lote. Os limites e o throughput real ainda precisam dos testes operacionais da etapa 8. Nenhuma URL de mídia recebida é buscada ou devolvida ao navegador.
- Fila `datafy-webhooks`: jobs contêm apenas `deliveryId`; cinco tentativas e espera exponencial. Recuperação a cada 30 segundos busca até 100 entregas pendentes/leases expirados e até 100 status pendentes. Token do lease e transação impedem efeitos de workers concorrentes. O contador de replay distingue jobs anteriores ainda retidos pelo Redis.
- Mensagens ao vivo: unicidade por ID externo, efeitos e contador na mesma transação, empresa nula, referência citada preservada, janela baseada no maior horário de entrada. Anexos recebem apenas metadados e a expiração da mensagem. Reentrega não estende a retenção do histórico.
- Status: tabela durável para confirmação recebida antes do ID do envio, conciliação com destinatário/canal, ordem por horário e proteção de entregue/lido. Erros guardam somente códigos. Nenhum status libera reenvio nem reinicia intenção incerta.
- Preferências: `STOP`, `SAIR`, `PARAR` e `CANCELAR` criam supressão do destinatário no canal compartilhado. Texto/template consultam a supressão imediatamente antes do transporte, inclusive respostas administrativas. O registro independe da retenção/anonimização do histórico; não muda o opt-in de um tenant por suposição. A resolução de consentimentos e sua interface permanecem para o fluxo administrativo posterior; não há desbloqueio automático nesta etapa.
- Migration adicional `20260924120000_datafy_webhook_recovery`: metadados de recuperação/triagem e tabelas `CommunicationMessageStatusEvent` e `CommunicationRecipientSuppression`. Gerada pela comparação de schemas locais e aplicada apenas nos bancos descartáveis. A migration da etapa 2 foi preservada.

## Operação administrativa preparada

| Método / rota | Contrato |
| --- | --- |
| `GET /webhooks/admin/datafy/deliveries?limit=50&cursor=<uuid>` | Somente admin; retorna `{items,nextCursor}`, limite 1–100, pendências/falhas/triagem e resumo dos status. Sem corpo bruto, destinatário ou segredos. |
| `POST /webhooks/admin/datafy/deliveries/:id/replay` | Somente admin; aceita falha ou processamento que exige revisão com corpo ainda disponível. Reutiliza a entrega e chaves de deduplicação, registra ator/data/contador e reabre apenas conciliação de contexto pendente quando necessário. |

Após sucesso sem revisão ou status pendente, o corpo bruto é removido sete dias depois. Hash, ID e metadados de deduplicação permanecem. Pendências/falhas/triagem mantêm o corpo para resolução; o operador deve acompanhar o backlog e o uso de disco. Replay não apaga mensagens, eventos ou preferências.

O healthcheck passa a informar `webhookSupported: true`, mantendo autenticação como não verificada até teste real. Templates, identidade e histórico são preservados em triagem; esta etapa não ativa catálogo, importação histórica, envio seguro completo ou telas novas. A VPS continua inalterada.

## Como validar

No diretório `api-cobranca`, com Docker Desktop Linux e imagens `postgres:16-alpine` e `redis:7-alpine` disponíveis:

```powershell
npm run prisma:generate
npm run test:communications:postgres
npm test -- --runInBand
npm run build
```

O harness aplica 30 migrations, preserva fixtures anteriores e executa `test/datafy-webhook-postgres.cjs`. PostgreSQL e Redis têm nomes/etiquetas exclusivos, portas aleatórias somente em `127.0.0.1` e credenciais sintéticas; não usam URLs de produção. A limpeza verifica a etiqueta antes de remover cada container/volume criado. `flushdb` é usado somente no Redis recém-criado e isolado para simular perda da fila. Nenhuma chamada de envio externo é realizada.

## Verificação

- Base da etapa 2: 66 suítes / 403 testes, build e harness PostgreSQL passaram.
- RED→GREEN: módulos de assinatura/normalização/recebimento/supressão ausentes antes da implementação; indicador ainda dizia que webhook não existia; teste de sobreposição Meta/Datafy demonstrou contador duplicado antes da correção.
- PostgreSQL/Redis: 30 migrations; commit antes de ack com enqueue indisponível; deduplicação por entrega e mensagem, inclusive Meta/Datafy; concorrência; lote misto; template sem número; histórico/identidade sem efeitos ao vivo; referência de mídia; status adiantado e atrasado; falhas sanitizadas; rollback; cinco tentativas; replay; paginação administrativa; limpeza seletiva; perda de Redis e lease expirado passaram.
- Revisão independente concluída. Achado importante: replay não reconsiderava status encerrado com `CONTEXT_NOT_FOUND`/`CONTEXT_MISMATCH`. Correção: replay explícito reabre apenas esses resultados, preservando eventKey, retenção e validações. Teste de contexto ausente → triagem terminal → referência disponível → replay falhou antes e passou depois.
- Revisão/checagem adicional: opt-out de conversa expirada, anonimizada ou mensagem legada duplicada não bloqueava. A supressão foi movida para antes dos filtros de histórico. Os três cenários foram testados em PostgreSQL, com falha observada no cenário expirado antes da correção.
- Replay com job anterior retido e paginação da triagem passaram no harness real. Não houve achados menores pendentes.
- Ruling final da revisão: aplicação de templates (4), conciliação de identidade/importação opcional, atribuição/projeções (5), ciclo de intenção/limites/reenvio (4), ordenação da prévia administrativa envolvendo saídas anteriores (projeções futuras) e alterações anteriores de Efí/infra ficam nas etapas originais. Não tratar esta entrega como validação desses fluxos.
- Prisma Client gerado, build do backend, ESLint dos arquivos TypeScript novos/alterados nesta etapa, sintaxe dos dois harnesses e `git diff --check` passaram.
- Suíte geral após as últimas correções: 71 suítes / 434 testes passaram.
- Etapa 3 concluída localmente. A migration adicional e o código ainda não foram aplicados na VPS; as etapas seguintes permanecem fora desta entrega.
