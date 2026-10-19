# Pagamentos a colaboradores agendados e simplificados (19/10/2026)

Evolução de [pagamentos a colaboradores](2026-10-12-pagamentos-colaboradores-design.md).

## Pedido

Simplificar o fluxo: **cadastrar um pagamento e agendar uma data → confirmar com o responsável na
data → se confirmado, enviar o Pix.**

## Decisões do responsável pelo produto (19/10/2026)

1. Na data agendada, o pedido de aprovação chega ao WhatsApp do responsável às **08:00** (Brasília).
2. O pedido vale **até 23:59 da data** do pedido (antes: 24 horas). Sem resposta, nada é pago e o
   responsável recebe o aviso de pagamento manual. Vale também para o pedido feito na hora.
3. Data **de hoje**: o pedido sai **na hora** ao cadastrar. Só datas futuras ficam agendadas.
4. **Repetição** opcional, com intervalo do usuário: **a cada N dias, semanas ou meses**. Em meses, o
   mesmo dia do mês; dia 31 vira o último dia em meses mais curtos.
5. A repetição termina **quando o usuário escolher**: sem fim (até encerrar), em uma data ou depois
   de um número de vezes. Pode ser encerrada a qualquer momento.
6. Cada repetição nasce **agendada com os valores do pagamento** e pode ser **editada até a data**.
   Editar uma não muda as seguintes, salvo com **"aplicar às próximas"**.

Mantém-se tudo da especificação original: nenhum Pix sem aprovação válida no WhatsApp, lote
congelado no pedido, decisão gravada uma vez, envio em dúvida nunca repetido, cada repetição com a
sua própria aprovação.

## Fluxo

1. **Novo pagamento** (uma tela): referência, data, repetição opcional, colaboradores e valores.
2. Ao salvar:
   - data de hoje → pedido de aprovação enviado na hora (como o antigo "Pedir aprovação");
   - data futura → pagamento **Agendado**; editar e cancelar continuam possíveis até a data.
3. Às 08:00 da data, o sistema congela o pagamento com o cadastro atual dos colaboradores e envia o
   pedido ao responsável, válido até 23:59.
4. Aprovado → Pix enviados na hora. Recusado ou sem resposta → nada é pago.
5. Com repetição, a próxima ocorrência é criada agendada assim que a atual deixa de estar agendada
   (pedido enviado, cancelada ou com problema), até o fim escolhido.

## Decisões técnicas

- **Data passou sem pedido** (sistema fora do ar o dia todo): o pedido não é enviado depois; o
  pagamento volta a rascunho com o motivo. Pedir aprovação fora do dia escolhido surpreenderia o
  responsável.
- **Pedido automático que não pode sair** (colaborador desativado, template retido, WhatsApp
  indisponível, conta Efí não apta): o pagamento volta a **rascunho com o motivo** na tela. Nada é
  pago e a repetição continua.
- **Datas das repetições** são calculadas a partir da primeira data (não da anterior), para "dia 31"
  não virar "dia 28" para sempre.
- **Encerrar a repetição** cancela também a ocorrência agendada que ainda não pediu aprovação.
- **Desligar a funcionalidade** (admin): pagamentos agendados voltam a rascunho e repetições são
  encerradas, para nada pedir aprovação sozinho quando a funcionalidade for religada.
- **Trocar o celular do responsável**: agendados não mudam; na data, o pedido vai para o celular atual.
- **Validade até 23:59**: um pedido feito à noite tem pouco tempo. A tela avisa quando faltam menos
  de 2 horas para o fim do dia.
- Nomes na tela: "lote" vira **pagamento**; "aprovador" vira **responsável**.

## Dados (migration aditiva)

- `DisbursementBatchStatus`: novo valor `SCHEDULED`.
- `DisbursementBatch`: `scheduledFor` (data em Brasília), `scheduleId`, `scheduleOccurrence` (único
  por repetição) e `scheduleProblem` (motivo de não ter saído na data).
- `DisbursementSchedule`: referência, unidade e intervalo, primeira data, fim (data ou quantidade),
  ocorrências criadas, situação (ativa ou encerrada), versão.
- `DisbursementScheduleItem`: colaborador e valor usados nas próximas ocorrências.

## API (empresa)

- `POST /disbursements/batches`: aceita `scheduledFor` e `repeat`. Sem `scheduledFor`, cria rascunho
  como antes (frontend publicado hoje).
- `PUT /disbursements/batches/:id`: rascunho ou agendado; aceita `scheduledFor` e `applyToSchedule`.
- `POST /disbursements/batches/:id/schedule`: rascunho → agendado (ou pedido na hora, se hoje).
- `POST /disbursements/batches/:id/cancel`: também cancela agendado.
- `POST /disbursements/schedules/:id/end`: encerra a repetição.

## Operação

- O template **"lote expirado"** aprovado na Meta diz "não foi aprovado em 24 horas". Com a validade
  até o fim do dia, o admin precisa criar na Meta um texto novo (ex.: "não foi aprovado até o fim do
  dia") e trocar o padrão da finalidade. O sistema nunca adapta o texto aprovado.
