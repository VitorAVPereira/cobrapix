# Pagamentos a colaboradores — especificação para revisão

**Status:** decisões de produto confirmadas pelo usuário em 14/10/2026. Nada implementado. Plano:
[pagamentos a colaboradores](../plans/2026-10-14-pagamentos-colaboradores.md).

## Objetivo e critério de pronto

Permitir que uma empresa, com a funcionalidade liberada pelo admin, pague seus colaboradores por
Pix a partir da própria conta Efí, dentro do CifraMais. O sistema **só paga** valores já calculados
pela empresa ou pelo contador; ele não calcula folha (bruto, encargos, férias, eSocial).

Pronto quando:

- A empresa monta um lote, e o aprovador recebe no WhatsApp a referência, a quantidade e o total.
- Ao tocar em "Aprovar pagamento", os Pix são enviados na hora (em até 1 minuto).
- O painel mostra o resultado por colaborador, e qualquer falha é avisada ao aprovador com o motivo.
- Sem resposta em 24 horas, o lote expira e o aprovador é avisado de que o pagamento deve ser feito
  manualmente.
- Nenhum Pix sai sem uma aprovação registrada que corresponda exatamente ao lote enviado.

## Regras confirmadas pelo usuário

1. Somente pagamento; sem cálculo de folha.
2. Nenhum pagamento antes do "OK" registrado no WhatsApp. A mensagem mostra o valor e informa que o
   envio ocorre no momento da aprovação.
3. Funcionalidade desligada por padrão; o admin CifraMais liga ou desliga por empresa.
4. **Um aprovador por empresa**, com nome e celular cadastrados e alterados **só pelo admin**.
5. **Envio na hora da aprovação.** Não há agendamento para data futura.
6. **Sem resposta em 24 horas:** o lote expira e o aprovador é avisado de que não houve aprovação e
   de que o pagamento deve ser feito manualmente.
7. **Qualquer erro é informado ao cliente, com o motivo.** Itens que falharam só são pagos em um novo
   lote, com nova aprovação.
8. **Desligar a funcionalidade cancela** lotes aguardando aprovação e itens ainda não enviados.
9. O cliente que contratar aumenta o limite de Pix na própria conta Efí.
10. Mensalidade fixa, **cobrada fora do sistema** (contrato e fatura manual).
11. Textos dos templates aprovados conforme a seção "Templates".
12. **O CifraMais nunca duplica um pagamento por conta própria:**
    - `idEnvio` único por item;
    - decisão gravada uma única vez;
    - reenvio de falhas único por lote;
    - envio em dúvida nunca é repetido.

    Lotes iguais criados pela empresa são permitidos, sem alerta, porque pagamentos repetidos de mesmo
    valor são legítimos (confirmado em 16/10/2026).

## Decisões técnicas tomadas na especificação

Seguem padrões do código ou são a opção mais conservadora com dinheiro. Podem ser revistas.

- **Saldo insuficiente para o lote inteiro:** nada é enviado. Todos os itens falham com o motivo
  "saldo insuficiente", e o aprovador é avisado. Envio parcial escolheria arbitrariamente quem recebe.
- **Lote em envio não pode ser cancelado pela empresa.** O dinheiro já está saindo; só o
  desligamento pelo admin interrompe os itens que ainda não foram enviados.
- **Envio em dúvida** (resposta perdida): fica "em verificação" e é consultado na Efí pelo
  `idEnvio`. Nunca é dado como falha nem reenviado sem confirmação, porque o cliente poderia pagar
  manualmente o que a Efí já pagou.
- **Um colaborador não pode aparecer duas vezes no mesmo lote.**
- **Colaborador pode ser pessoa física ou jurídica (CPF ou CNPJ).** O SDK aceita `favorecido.cnpj`;
  confirmar em homologação.
- **A empresa não é avisada quando tudo dá certo.** O painel mostra o resultado; o WhatsApp só leva a
  confirmação do toque e as falhas.

## Contexto conferido no repositório e na Efí

- **API certa:** Envio de Pix da API Pix (`PUT /v3/gn/pix/:idEnvio`, escopo `pix.send`; SDK
  `pixSend`). A API Pagamento de Contas só paga código de barras e fica fora desta entrega.
- **Conta:** Fase A. O Pix sai da conta Efí do cliente: identidade emissora do perfil financeiro
  ativo (`EfiAccountIdentity` e `EfiCredentialVersion` `ACTIVE`, com `.p12` cifrado), pagando a partir
  da chave `pixKey` da identidade. A aplicação Efí do cliente precisa dos escopos `pix.send`,
  `gn.pix.send.read` e do de saldo (`getAccountBalance`, `GET /v2/gn/saldo`).
- **Idempotência Efí:** `idEnvio` é definido por nós. Repetir o mesmo `idEnvio` não debita duas
  vezes. A consulta por `GET /v2/gn/pix/enviados/id-envio/:idEnvio` resolve resposta perdida.
- **Titular conferido:** `favorecido.cpf`/`cnpj` junto da chave faz a Efí recusar
  (`chave_nao_pertence_ao_documento`) quando a chave não é do colaborador.
- **Resultado:** chega no webhook da chave Pix do pagador, o mesmo `/webhooks/efi/pix` das cobranças
  (uma URL por chave), com `tipo: "SOLICITACAO"`, `status` (`REALIZADO`/`NAO_REALIZADO`),
  `gnExtras.idEnvio` e `gnExtras.erro`. Hoje `EfiService.handlePixWebhook` só processa itens com
  `txid` (`extractPixEvents`) e ignoraria esses avisos.
- **Ritmo:** `429 balde_fichas_vazio` com `Retry-After`; o envio é sequencial.
- **Botões:** templates do catálogo já aceitam respostas rápidas estáticas. O toque chega como
  mensagem `button`, com o texto do botão e `context.id` da mensagem citada, gravados em
  `CommunicationMessage` (`messageType`, `content`, `replyToExternalMessageId`, `providerTimestamp`).
  Os tokens de resposta rápida do `OutboundDispatcherService` são recusados no caminho de templates do
  catálogo (`UNSUPPORTED`) e não são usados aqui.
- **Mensagem para a empresa:** segue o padrão do aviso de ativação (`CentralOnboardingNotifications`:
  finalidade própria em `TemplatePurpose`, `TemplateSendPreparerService.prepare` e `dispatchIntent`).
- **Liga/desliga:** padrão de `CardPaymentSettings` (`enabled` padrão `false`, validado por um admin).
- **Retenção:** mensagens têm `retentionExpiresAt`; a prova da aprovação é copiada para o lote.
- **Mensalidade:** `Plan` e `Subscription` existem no schema sem uso; não serão usados.

## Fluxo

1. **Admin libera** a funcionalidade: o sistema confere a conta Efí ativa (Fase A, credencial ativa,
   chave Pix) e os três templates liberados à empresa. O admin cadastra o aprovador e liga a opção.
   Cada alteração cria uma nova versão da configuração (histórico de quem mudou o quê).
2. **Empresa cadastra colaboradores:** nome, CPF ou CNPJ, e chave Pix ou dados bancários (ISPB,
   agência, conta, tipo). Pode importar uma planilha.
3. **Empresa monta o lote:** referência (ex.: "Folha 10/2026") e itens com valor líquido, digitados ou
   importados (documento e valor). Rascunho editável, com versão (409 em edição concorrente).
4. **Empresa pede aprovação:** o sistema congela o lote (hash de itens, valores, referência e conta
   emissora), grava o pedido com validade de 24 horas e envia o template ao aprovador. Template
   retido ou envio recusado devolvem o lote a rascunho, com o motivo na tela.
5. **Aprovador toca em um botão.** O toque vale só se for uma mensagem `button`:
   - citando a mensagem do pedido atual do lote (só quem a recebeu consegue citá-la);
   - no mesmo canal;
   - vinda do celular do aprovador gravado no pedido, igual ao atual. O número é aceito com ou sem
     o nono dígito, porque o WhatsApp devolve alguns números brasileiros antigos sem ele;
   - com o texto exato de um dos botões gravados no pedido;
   - enviada dentro das 24 horas (horário do WhatsApp);
   - com o lote inalterado e a funcionalidade ligada.

   A decisão é gravada uma única vez (horário do WhatsApp, ids das mensagens, botão, hash), e o
   aprovador recebe em texto livre a confirmação: aprovação registrada, recusa registrada ou pedido
   inválido.
6. **Envio:** confere a conta emissora e o saldo do lote inteiro e envia os Pix um a um, com `idEnvio`
   derivado do item.
7. **Acompanhamento:** o webhook move cada item para pago ou falhou. Envio em dúvida é consultado
   pelo `idEnvio`. Quando não restam itens em andamento, o lote é concluído e, havendo falhas, o
   aprovador recebe a lista com os motivos. A empresa pode criar um novo lote com os itens que falharam.
8. **Expiração:** pedido sem resposta em 24 horas expira o lote, e o aprovador recebe o aviso de
   pagamento manual. Toque depois disso só recebe a confirmação de que o pedido não vale mais.

## Estados

- **Lote:** `DRAFT` → `AWAITING_APPROVAL` → `PROCESSING` → `COMPLETED` ou
  `COMPLETED_WITH_FAILURES`. Saídas: `REJECTED`, `EXPIRED`, `CANCELED`.
- **Item:** `PENDING` → `SENDING` → `IN_PROCESSING` → `PAID`. Saídas: `FAILED` (nada pago),
  `UNCERTAIN` (em verificação na Efí) e `CANCELED` (não enviado).
- **Pedido de aprovação:** aguardando, aprovado, recusado, expirado ou invalidado (lote editado,
  cancelado ou funcionalidade desligada).

Aprovado não é enviado, enviado não é pago. Devolução posterior de um Pix pago fica para depois da
validação em homologação: até lá, vira anomalia para o admin.

## Templates (criados na Meta pelo admin, categoria utilidade)

1. **Pedido de aprovação** (`DISBURSEMENT_APPROVAL`), botões "Aprovar pagamento" e "Recusar":
   "Olá, {{1}}. A {{2}} pediu sua aprovação para o lote de pagamentos {{3}}: {{4}} pagamentos, total
   de {{5}}. Ao aprovar, os Pix são enviados na hora. O pedido vale até {{6}}; sem resposta, nada
   será pago."
2. **Lote expirado** (`DISBURSEMENT_EXPIRED`): "Olá, {{1}}. O lote de pagamentos {{2}} da {{3}}
   ({{4}} pagamentos, total de {{5}}) não foi aprovado em 24 horas. O CifraMais não fará esses
   pagamentos. Se ainda forem devidos, faça-os manualmente pela sua conta."
3. **Falhas no lote** (`DISBURSEMENT_FAILED`): "Olá, {{1}}. No lote de pagamentos {{2}} da {{3}}, {{4}}
   pagamento(s) não foram concluídos: {{5}}. Esses valores não foram pagos. Para pagá-los, crie um novo
   lote no painel CifraMais."

A lista de falhas fica numa linha só (a Meta não aceita quebra de linha em variável) e é cortada
com "e mais N, veja no painel" quando passa de 600 caracteres.

**Formato das fontes:**

| Fonte | Exemplo | Observação |
| --- | --- | --- |
| Total | `R$ 18.450,00` | Já vem com "R$"; por isso o texto não repete o símbolo |
| Validade | `16/10/2026 às 14:30` | Horário de São Paulo |
| Falhas | `Ana Souza (Chave Pix não encontrada); Bruno Lima (conta inexistente)` | |

**Botões de decisão:** no mapeamento do template de pedido, o admin escolhe qual resposta rápida
aprova e qual recusa (posições entre as respostas rápidas).

## Dados (migration aditiva)

- `DisbursementSettings`: versões imutáveis por empresa (`enabled`, aprovador, admin que alterou).
- `DisbursementRecipient`: colaborador (nome, documento, chave Pix ou dados bancários, ativo, versão).
- `DisbursementBatch`: referência, status, total, quantidade, hash, conta emissora, versão e pedido atual.
- `DisbursementItem`: foto do favorecido e do valor, `idEnvio` único, `e2eId`, status, motivo.
- `DisbursementApproval`: pedido e decisão (hash, rótulos, validade, mensagens, celular em hash,
  horário). A decisão é gravada uma única vez.

Nenhum CPF, chave, conta, valor individual ou telefone em log.

## Segurança e isolamento

- Rotas da empresa: `companyId` do JWT; outra empresa e funcionalidade desligada respondem 404.
- O celular do aprovador só muda pelo admin. Um login roubado da empresa não aprova lotes.
- Conta emissora fotografada no pedido: se o perfil financeiro mudar, os itens falham sem envio.
- Risco residual aceito: quem tem acesso ao WhatsApp do aprovador aprova. O limite Pix na Efí é a
  barreira final.

## Fora do escopo

- Cálculo de folha, holerite, eSocial e encargos.
- Guias e boletos (API Pagamento de Contas).
- Aviso ao colaborador.
- Agendamento para data futura.
- Cobrança automática da mensalidade.
- Conta da plataforma (Fase B).
- Cancelamento de lote em envio.

## Validações antes de implementar

- **Homologação Efí:**
  - formato do `idEnvio`;
  - `favorecido.cnpj` e `contaBanco`;
  - payload real do webhook de envio na URL atual;
  - escopos presentes no token OAuth;
  - formato da resposta de saldo;
  - casos simulados de devolução (R$ 4,00 e R$ 5,00).
- **Contador ou jurídico:** comprovante de pagamento de salário por Pix (CLT, art. 464).
- **Efí:** tarifa de envio de Pix no plano dos clientes e prazo para aumento de limite.
