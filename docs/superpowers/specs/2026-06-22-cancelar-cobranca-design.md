# Cancelar Cobranca Design

## Contexto

O CobraPix ja possui o status `CANCELED` em `InvoiceStatus` e a tela de cobrancas ja sabe manter linhas canceladas visiveis e fora da selecao em massa. O que falta e uma acao segura para o usuario cancelar uma cobranca pendente sem apagar o registro, sem deixar novas notificacoes serem disparadas e sem deixar o sistema divergente da Efi quando a cobranca ja foi gerada no gateway.

A feature deve permitir cancelamento somente de faturas `PENDING`. Faturas `PAID` e `CANCELED` nao entram no fluxo de cancelamento.

## Decisao

Implementar um cancelamento sincronizado:

- Se a fatura `PENDING` ainda nao tem cobranca Efi (`efiTxid` nem `efiChargeId`), cancelar somente no banco local.
- Se a fatura `PENDING` ja tem Pix CobV (`efiTxid`), remover/revisar a cobranca na Efi antes de alterar o status local.
- Se a fatura `PENDING` ja tem boleto ou Bolix (`efiChargeId`), cancelar a charge na Efi antes de alterar o status local.
- Se a Efi falhar ou recusar o cancelamento, manter a fatura `PENDING` e retornar erro ao usuario.

Essa decisao evita mostrar "Cancelada" para uma cobranca que ainda poderia ser paga no gateway.

## Fontes Efi

A integracao deve seguir a documentacao Efi:

- Boleto/Bolix: cancelar a transacao existente via `PUT /v1/charge/:id/cancel`.
- Pix CobV: revisar a cobranca via `PATCH /v2/cobv/:txid` com status `REMOVIDA_PELO_USUARIO_RECEBEDOR`.

Referencias:

- [Cancelar uma transacao existente](https://dev.efipay.com.br/docs/api-cobrancas/cartao/)
- [Review Due Charge](https://dev.efipay.com.br/en/docs/api-pix/cobrancas-com-vencimento/)

## Fluxo Backend

Adicionar uma rota autenticada em `InvoicesController`, protegida por `JwtAuthGuard` e `ThrottleGuard`:

- `POST /invoices/:invoiceId/cancel`

O controller deve recuperar a empresa pelo `@GetUser()` e delegar para `InvoicesService.cancelInvoice(companyId, invoiceId)`.

`InvoicesService.cancelInvoice` deve:

1. Buscar a fatura por `id` e `companyId`.
2. Retornar `404` quando a fatura nao existir para aquela empresa.
3. Rejeitar quando `status !== PENDING`.
4. Decidir se precisa cancelar na Efi:
   - `efiTxid` presente: chamar cancelamento Pix CobV.
   - `efiChargeId` presente: chamar cancelamento boleto/Bolix.
   - sem identificador Efi: seguir direto para cancelamento local.
5. Depois do sucesso externo, ou quando nao houver cobranca externa, atualizar a fatura para `CANCELED`.
6. Registrar `CollectionLog` com `actionType: INVOICE_CANCELED`, descricao clara e `status: CANCELED`.
7. Retornar a fatura mapeada para o mesmo formato da listagem, para o frontend poder atualizar ou recarregar.

Todas as consultas e atualizacoes Prisma devem filtrar por `companyId`.

## Gateway Efi

Adicionar metodos em `PaymentService` e `EfiService` para cancelar cobrancas:

- `PaymentService.cancelPayment(invoice)` orquestra a decisao por identificador.
- `EfiService.cancelPixDueCharge(companyId, txid)` remove Pix CobV na Efi.
- `EfiService.cancelCharge(companyId, chargeId)` cancela boleto/Bolix na Efi.

O SDK local tipado em `api-cobranca/src/types/sdk-node-apis-efi.d.ts` deve ser expandido com os metodos necessarios da Efi. Caso o SDK nao exponha algum metodo diretamente, a implementacao deve usar a API suportada pelo SDK instalado ou um wrapper interno tipado, sem `any`.

Ao cancelar no gateway, atualizar `gatewayStatusRaw` para o status retornado ou para um valor explicito como `CANCELED_BY_USER` quando a resposta nao trouxer status util.

## Bloqueio De Geracao Futura

Adicionar uma trava em `PaymentService.createPayment`:

- Buscar a fatura por `id` e `companyId` antes de chamar a Efi.
- Rejeitar quando a fatura nao existir.
- Rejeitar quando a fatura nao estiver `PENDING`.

Isso impede que o usuario gere Pix, boleto ou Bolix depois de cancelar localmente uma fatura que ainda nao tinha cobranca externa.

Os fluxos automaticos de regua e primeira cobranca ja filtram faturas `PENDING`, mas essa validacao no `PaymentService` fecha todos os caminhos de geracao.

## Filas E Notificacoes

Jobs ja enfileirados antes do cancelamento nao devem disparar mensagens depois que a fatura virar `CANCELED`.

Adicionar revalidacao de status imediatamente antes de qualquer envio externo:

- `MessageWorkerService.processSendMessageJob` deve buscar `Invoice` por `id` e `companyId` e retornar sem enviar WhatsApp quando `status !== PENDING`.
- `EmailService.send` ou `EmailProcessor.processJob` deve fazer a mesma checagem antes de chamar Resend.
- Fallback de WhatsApp para email tambem deve respeitar o status atual antes de enfileirar email.

Quando um job for ignorado por fatura cancelada, registrar `CollectionLog` com mensagem explicita, sem retry, para nao transformar cancelamento esperado em falha operacional ruidosa. O `CollectionAttempt` existente nao deve ser convertido para um status inexistente como `SKIPPED`.

## Webhooks

Webhooks da Efi para faturas canceladas nao devem reabrir uma cobranca como `PENDING`.

Se a Efi confirmar pagamento real de uma fatura previamente cancelada, o sistema deve manter o comportamento financeiro correto e marcar como `PAID`, porque boletos impressos antes do cancelamento ainda podem ser pagos em alguns cenarios. Esse caso deve aparecer em log para auditoria.

## Frontend

Adicionar uma acao "Cancelar cobranca" na linha da tabela de cobrancas.

Regras de UI:

- Habilitar apenas para linhas com `status === "PENDING"`.
- Desabilitar para `PAID` e `CANCELED`.
- Exigir confirmacao antes de chamar a API.
- Mostrar feedback de sucesso quando a fatura for cancelada.
- Mostrar erro quando a Efi recusar ou falhar.
- Recarregar a lista apos sucesso para manter a linha visivel com badge "Cancelada".

Adicionar metodo tipado no `front-cobranca/src/lib/api-client.ts`:

- `cancelInvoice(invoiceId: string): Promise<InvoiceListItem>`

## Erros

Contratos esperados:

- `404`: fatura nao encontrada para a empresa autenticada.
- `409`: fatura nao esta `PENDING`.
- `502`: Efi falhou ou recusou o cancelamento.
- `400`: payload, identificador ou estado invalido antes de chamar a Efi.

Quando a Efi falhar, o status local permanece `PENDING`.

## Testes

Seguir TDD para a implementacao.

Backend:

- `InvoicesService` cancela localmente fatura `PENDING` sem identificadores Efi.
- `InvoicesService` chama a Efi antes de marcar local quando ha `efiTxid`.
- `InvoicesService` chama a Efi antes de marcar local quando ha `efiChargeId`.
- `InvoicesService` mantem `PENDING` quando a Efi falha.
- `InvoicesService` rejeita `PAID` e `CANCELED`.
- `PaymentService.createPayment` rejeita faturas nao `PENDING`.
- `MessageWorkerService` nao envia WhatsApp quando job antigo encontra fatura cancelada.
- `EmailService` ou `EmailProcessor` nao envia email quando job antigo encontra fatura cancelada.

Frontend:

- A tabela habilita a acao de cancelamento somente para faturas `PENDING`.
- A confirmacao chama `cancelInvoice` com o `invoiceId` correto.
- A tela recarrega ou atualiza a lista apos sucesso.
- O erro de cancelamento da Efi e exibido ao usuario.

## Fora Do Escopo

- Cancelar faturas `PAID`.
- Criar status intermediario como `CANCEL_REQUESTED`.
- Remover a linha da tela.
- Cancelamento em massa.
- Reembolso ou estorno de pagamentos ja confirmados.
- Alterar regras de recorrencia; cancelar uma fatura recorrente individual nao pausa a recorrencia.
