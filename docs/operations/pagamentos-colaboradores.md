# Pagamentos a colaboradores

**Situação:** implementação local concluída na branch `feat/pagamentos-colaboradores`. Ainda não
publicada e sem empresa liberada.

**Envio do Pix validado na homologação Efí:**
[validação](../implementation/efi-disbursement-validation.md).

**Decisões de produto:**
[especificação](../superpowers/specs/2026-10-12-pagamentos-colaboradores-design.md) e
[agendamento e repetição](../superpowers/specs/2026-10-19-pagamentos-agendados-design.md).

## O que é

A empresa paga seus colaboradores por Pix a partir da **própria conta Efí** (Fase A). Os valores
líquidos já vêm calculados; o CifraMais não calcula folha.

- **Liberação:** desligada por padrão. Só o admin CifraMais libera, por empresa.
- **Aprovação:** nenhum Pix sai sem o toque do aprovador em "Aprovar pagamento" no WhatsApp. O
  aprovador é cadastrado pelo admin, e o pedido vale **até 23:59 do dia** em que foi enviado. Sem
  resposta, o pagamento expira e o aprovador é avisado para pagar manualmente.
- **Agendamento:** a empresa escolhe a data. Para hoje, o pedido sai na hora; para outra data, às
  **08:00** (Brasília) daquele dia. O pagamento pode se repetir a cada N dias, semanas ou meses.
- **Cobrança:** a mensalidade da funcionalidade é cobrada fora do sistema.

## Publicação

1. Publicar o backend antes do frontend.
2. Aplicar `prisma migrate deploy`. As migrations são aditivas:
   - `20261015120000_add_employee_disbursements`: tabelas, enums e três finalidades novas em
     `WhatsappTemplatePurpose`;
   - `20261016120000_disbursement_template_pending_origin`: amplia
     `WhatsappTemplatePendingSend_origin_check` para aceitar `DISBURSEMENT`;
   - `20261019120000_add_disbursement_schedules`: estado `SCHEDULED`, data agendada nos lotes e as
     tabelas de repetição.
3. Não há variável de ambiente nova. O worker roda dentro da API a cada 30 segundos (`@Cron`) e
   também envia os pedidos agendados e cria as próximas repetições.
4. O webhook de Pix enviado usa a mesma URL do webhook Pix de cobranças
   (`/webhooks/efi/pix?ignorar=`), já cadastrada na chave pela ativação financeira.

## Liberar uma empresa (passo a passo)

### 1. Na conta Efí do cliente (feito pelo cliente, com orientação)

1. Na aplicação da API usada na ativação, incluir os escopos de **produção**:
   - `pix.send` (enviar Pix);
   - `gn.pix.send.read` (consultar Pix enviado);
   - `gn.balance.read` (saldo);
   - `gn.receipts.read` (comprovante).

   A Efí informa os escopos concedidos na resposta do token; a homologação confirmou isso.
2. Se a aplicação foi criada antes de 29/07/2024, a Efí pede para **desligar e religar** o escopo
   `pix.send`.
3. **Aumentar o limite de Pix** da conta para o valor da folha. O limite padrão via API é quase
   zero. O aumento é decisão e ação do titular, e pode não ser imediato.

### 2. Na ativação financeira (admin)

1. A empresa precisa estar com a ativação financeira **ativa** em conta própria
   (`CUSTOMER_ACCOUNT`), com credencial válida e chave Pix.
2. Depois de mudar escopos, **validar a credencial de novo** (regra 4.4 do AGENTS.md).

### 3. Templates na Meta e no catálogo (admin)

1. Criar na Meta, categoria **utilidade**, os três templates da especificação:
   - **pedido de aprovação**, com duas **respostas rápidas** ("Aprovar pagamento" e "Recusar");
   - **lote expirado**: com a validade até o fim do dia, o texto não pode dizer "em 24 horas" (ex.:
     "não foi aprovado até o fim do dia"). Quem já tem o texto antigo precisa criar o novo na Meta e
     trocar o padrão da finalidade;
   - **falhas no lote**.

   O total já vem com "R$"; não escreva "R$ {{n}}" no texto.
2. Importar no catálogo e mapear as variáveis (Admin → Catálogo de templates → Configurar
   variáveis). Fontes disponíveis:

   | Fonte | Conteúdo |
   | --- | --- |
   | Nome do aprovador (pagamentos) | Nome do aprovador |
   | Nome da empresa | Nome da empresa |
   | Referência do lote de pagamentos | Ex.: "Folha 10/2026" |
   | Quantidade de pagamentos do lote | Número de pagamentos |
   | Total do lote de pagamentos | Ex.: "R$ 18.450,00" |
   | Validade do pedido de aprovação | Ex.: "16/10/2026 às 14:30", horário de São Paulo |
   | Quantidade de pagamentos com falha | Número de falhas |
   | Pagamentos com falha e motivos | Lista numa linha; acima de 600 caracteres termina em "e mais N, veja no painel" |

3. **Somente no template de pedido de aprovação**, preencher "Aprovação de pagamento a
   colaboradores": qual resposta rápida **aprova** e qual **recusa**. Os dois rótulos precisam ser
   diferentes.
4. Liberar os três templates para a empresa e defini-los como **padrão** nas finalidades
   "Pagamento a colaboradores: pedido de aprovação / lote expirado / falhas no lote".

### 4. Aprovador e liberação (admin)

1. Admin → Ativação financeira → empresa → bloco **Pagamentos a colaboradores**.
2. Conferir "Falta para liberar". Enquanto houver item, o sistema recusa ligar e explica o motivo.
3. Informar o **nome** e o **celular** do aprovador (55 + DDD + número), confirmado com o cliente
   por escrito. Só o admin altera esse celular.
4. Marcar "Liberar pagamentos a colaboradores para esta empresa" e salvar. Cada alteração vira uma
   versão no histórico.
5. **Primeiro uso assistido:** um lote pequeno de baixo valor, acompanhando no painel e no
   atendimento central.

## Como funciona no dia a dia

1. A empresa cadastra colaboradores (chave Pix ou conta corrente, poupança ou de pagamento; conta
   salário não é aceita pela Efí) ou importa uma planilha.
2. Clica em **Novo pagamento**: descrição, data (e repetição, se quiser), colaboradores e valores.
   - **Data de hoje:** o pedido de aprovação sai na hora.
   - **Outra data:** o pagamento fica **Agendado** e pode ser editado ou cancelado até lá. Às 08:00
     da data, o pagamento é congelado com o cadastro atual e a conta Efí ativa, e o aprovador recebe
     o template.
   - **Não saiu na data** (colaborador desativado, template retido, WhatsApp indisponível, conta
     não apta, ou a data passou com o sistema fora do ar): o pagamento volta a rascunho com o motivo
     na tela, e nada é pago. A empresa corrige e agenda de novo.
   - **Repetição:** a próxima ocorrência é criada agendada assim que a atual pede aprovação, com os
     valores da repetição. A empresa ajusta cada uma até a data; "usar também nas próximas" muda os
     valores das seguintes. Encerrar a repetição cancela a ocorrência ainda agendada.
3. **O aprovador toca em "Aprovar pagamento":**
   - o toque vale se citar o pedido, vier do celular do aprovador (com ou sem o nono dígito), for
     enviado até 23:59 do dia do pedido e o lote estiver inalterado;
   - o envio começa em até 30 segundos;
   - o aprovador recebe "Aprovação registrada".

   **Se tocar em "Recusar":** o lote é cancelado e nada é pago. Texto digitado nunca aprova.
4. Os Pix saem um a um. O resultado chega pelo webhook: "Pago", ou "Falhou" com o motivo da Efí.
5. Quando todos os pagamentos têm resultado, o lote é concluído. Se houve falhas, o aprovador recebe
   **uma vez** a lista com os motivos, e a empresa pode criar um **novo lote com os pagamentos que
   falharam** (nova aprovação).

**Sem resposta até 23:59 do dia:** o pagamento expira, nada é pago e o aprovador recebe o aviso de
pagamento manual.

## Pagamentos em verificação

"Em verificação" (`UNCERTAIN`) quer dizer que a Efí pode ter recebido o envio, mas a resposta se
perdeu: timeout, erro 5xx ou "identificador já utilizado".

- **O sistema:**
  - nunca reenvia nem marca falha sozinho;
  - consulta a Efí pelo `idEnvio` a cada minuto;
  - consulta também envios em processamento há mais de 10 minutos, caso o webhook se perca.
- **O admin:** Admin → Ativação financeira → empresa → "Pagamentos em verificação" →
  **Consultar Efí**. Se a Efí ainda não encontra o envio, ele continua em verificação. Não existe
  ação de "marcar como não pago"; casos persistentes vão para o suporte Efí, com o `idEnvio`.
- **A empresa:** vê "Em verificação: não pague manualmente". O lote só é concluído quando esses
  itens se resolvem.

## Desligar ou trocar o aprovador

- **Desligar:**
  - cancela os lotes aguardando aprovação e os pagamentos ainda não enviados;
  - devolve os agendados a rascunho (com o motivo) e encerra as repetições, para nada pedir aprovação
    sozinho quando a funcionalidade for religada;
  - Pix já enviados continuam sendo acompanhados;
  - rascunhos ficam guardados;
  - a empresa deixa de ver o menu, e as rotas respondem 404.
- **Trocar o celular do aprovador:** invalida os pedidos em aberto (os lotes voltam a rascunho).
  Toque do aprovador antigo não paga nada e recebe "Este pedido de aprovação não vale mais".

## Anomalias do webhook (`PaymentWebhookAnomaly`, origem `PIX`)

Todas respondem 200 à Efí, que não reenvia.

| Código | Significado | O que fazer |
| --- | --- | --- |
| `UNKNOWN_SEND_ID` | Pix enviado com `idEnvio` que não é do CifraMais (envio pela mesma conta por outro sistema) | Nada, se o cliente confirmar que foi ele |
| `SEND_KEY_MISMATCH` | Aviso de envio vindo de chave diferente da conta usada na aprovação | Investigar a configuração da conta e do webhook |
| `SEND_STATUS_CONFLICT` | Resultado contraditório com o já registrado (ex.: recusado depois de pago) | Conferir na Efí pelo `idEnvio`; não corrigir manualmente sem evidência |

## Limitações desta versão

- **Devoluções** de Pix já pagos não são tratadas: o aviso é ignorado e o pagamento continua
  "Pago" (decisão do produto).
- **Envio:** sempre no momento da aprovação; o que se agenda é o pedido de aprovação.
- **Comprovante em PDF:** só em produção; a homologação Efí desabilita.
- **Saldo:**
  - antes do primeiro Pix, o lote inteiro precisa caber no saldo, senão nada é enviado;
  - em homologação a conferência é pulada, porque o saldo é sempre zero.
- **Limite de envios da Efí** (`429`): o lote pausa 60 segundos e continua.
- **Mensalidade:** cobrada fora do sistema.

## Homologação

Para validar uma conta nova em homologação:

1. **Webhook:** a chave pagadora precisa de webhook. O cadastro exige uma URL HTTPS pública que
   responda 200; sem mTLS, use `x-skip-mtls-checking`.
2. **Chave do favorecido:** use a chave de homologação da Efí, `efipay@sejaefi.com.br`. Outras
   chaves dão "chave inválida".
3. **Valores simulados:**
   - até R$ 10: pago;
   - R$ 10,01 a R$ 20: recusado pelo webhook;
   - acima de R$ 20: "não realizado" na resposta;
   - R$ 4 e R$ 5: devoluções.
4. **Depois do teste:** remova o webhook e gere um novo Client_Secret se as credenciais tiverem
   circulado.
