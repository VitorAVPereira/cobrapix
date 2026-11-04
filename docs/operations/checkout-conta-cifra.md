# Cifra+ Checkout: conta Efí da Cifra+ e primeiro Pix

O checkout recebe na conta Efí da **própria Cifra+**, não na do cliente. Sem esta conta validada
e com a tarifa do Pix definida, a página `/c/<link>` mostra "Pagamento indisponível" e nada é
cobrado.

## 1. Cadastrar as credenciais

1. Na Efí, confira que a aplicação de API da conta Cifra+ tem os escopos Pix (cobranças
   imediatas, QR Code, webhook e consulta) e baixe o certificado `.p12` do ambiente certo.
2. No sistema, abra **Admin → Checkout → Conta Efí da Cifra+ → Cadastrar credenciais**:
   - **ambiente:** produção ou homologação;
   - **CNPJ e número da conta:** em produção, precisam ser os de `EFI_PLATFORM_CNPJ` e
     `EFI_PLATFORM_ACCOUNT_NUMBER` do `api.env`; senão o sistema recusa;
   - **código do recebedor, chave Pix, client id, client secret, `.p12`** e a senha dele, se
     houver.
3. **Uma conta por ambiente:** o banco aceita uma única conta Cifra+ em produção e uma em
   homologação. Para trocar de credencial, envie de novo com a mesma conta.

Client id, secret e certificado ficam cifrados no banco e não voltam para a tela.

## 2. Validar e ligar o webhook Pix

1. Clique em **Validar e ligar webhook Pix**. O sistema:
   - autentica na Efí;
   - lê o webhook atual da chave;
   - aponta a chave para `<EFI_WEBHOOK_BASE_URL>/webhooks/efi/pix`, a mesma rota mTLS das
     cobranças;
   - ativa a credencial nova e aposenta a anterior.
2. **Webhook ocupado:** se a chave já avisar **outro endereço**, a tela mostra qual. A Efí aceita
   um webhook por chave: trocar faz o endereço antigo parar de receber os avisos dessa chave.
   Confirme só se ele não estiver em uso.
3. **Falha:** a tela mostra o código da Efí, e nada muda. Confira as credenciais e os escopos.

## 3. Definir a tarifa do Pix

Em **Nova tarifa do Pix (%)**, informe a tarifa da Efí sobre cada Pix recebido na conta Cifra+
(por exemplo, `1,19`).
- Cada alteração vira uma versão nova.
- Cada pedido guarda a versão usada.
- Mudar a tarifa não altera pedidos já feitos.

O estado passa a **Pronta para vender**.

## 4. Primeiro Pix em homologação

1. Cadastre e valide a conta em **homologação**.
2. Crie um cliente de checkout de teste, um produto (R$ 5,00 ou mais) e, se quiser, um bump e um
   cupom.
3. Abra `/c/<link>`, gere o Pix e pague pelo simulador da Efí.
4. Confira:
   - a página do pedido muda sozinha para "Pagamento confirmado" e leva ao link de acesso;
   - o comprador recebe o e-mail "Seu acesso a …";
   - em produção, só depois deste teste divulgue qualquer link.

## O que fazer quando

| Situação | O que acontece | Ação |
| --- | --- | --- |
| A resposta da Efí se perdeu ao gerar o Pix | O pedido fica "Gerando seu Pix…". A cada minuto o sistema consulta a Efí pelo `txid`: se o Pix existe, aparece; se não existe depois de 10 minutos, o pedido falha sem cobrança | Nenhuma. Nunca gere outro Pix para o mesmo pedido |
| O webhook do pagamento não chegou | Antes de expirar um pedido, o sistema consulta a Efí. Se estiver pago, confirma e manda o acesso | Nenhuma |
| Aviso com outra chave ou outro valor | Nada é baixado; fica uma anomalia `PIX` com o motivo `CHECKOUT_…` | Conferir na Efí e no banco (`PaymentWebhookAnomaly`) |
| Pedido de reembolso (comprador ou vendedor) | Aparece em Admin → Checkout e chega por e-mail no `PLATFORM_ALERT_EMAIL` | Devolver o Pix pelo app da Efí; o aviso da Efí registra o reembolso e fecha o pedido |
| Devolução feita por fora da Efí | O sistema não sabe dela | Em Admin → Checkout → financeiro do cliente, "Registrar devolução feita por fora" |
| E-mail de acesso não saiu | A fila `checkout-mail` tenta 5 vezes, com intervalo crescente | Conferir `RESEND_API_KEY` e `RESEND_FROM_EMAIL` |

## Saldo, repasse e reembolso (Parte 3)

- **Saldo do vendedor:** cada venda paga entra "a liberar" e é liberada 7 dias depois do
  pagamento, já descontadas a tarifa Efí e a % Cifra+.
- **Reembolso:** devolva o Pix pelo app da Efí. Quando a Efí confirma a devolução, o sistema tira o
  valor do saldo do vendedor, devolve a ele a % Cifra+ da parte devolvida (a tarifa Efí fica com
  ele) e fecha o pedido de reembolso. Se o reembolso foi feito depois do repasse, o saldo do
  vendedor fica negativo e o próximo repasse sugerido já sai descontado.
- **Repasse:** faça o Pix pelo app da Efí e registre em Admin → Checkout → financeiro do cliente →
  "Registrar repasse", com valor, data, referência do comprovante e observação (por exemplo, a
  reserva de 1%). O sistema avisa quando o valor passa do liberado, mas aceita, porque a reserva é
  manejada por você.
- **Contestação (chargeback):** registre a venda e o valor. Ela entra no índice de chargeback dos
  últimos 90 dias. Enquanto o checkout só aceitar Pix, o índice fica em 0%.
- **Ajuste:** crédito ou débito com motivo, para corrigir qualquer valor. Nenhum lançamento é
  editado.

## Webhook ao vendedor (Parte 4)

O vendedor configura em **Configurações do checkout → Webhook**:
- **URL:** só `https`, com nome de domínio público;
- **segredo:** gerado pelo sistema e mostrado uma vez;
- **“Enviar teste”:** manda um aviso de exemplo e mostra a resposta do sistema dele.

**Eventos:**

| Evento | Quando |
| --- | --- |
| `order.created` | O Pix foi gerado |
| `order.paid` | O pagamento foi confirmado |
| `order.pix_expired` | O Pix venceu sem pagamento |
| `refund.requested` | O comprador ou o vendedor pediu reembolso |
| `order.refunded` | Uma devolução foi concluída (com valor e total devolvido) |
| `order.chargeback` | Uma contestação foi registrada |
| `order.card_declined` | Um pedido de cartão venceu depois de recusa(s) do banco |
| `lead.abandoned` | Alguém preencheu os dados e ficou 30 min sem gerar o Pix (traz `data.lead`, sem pedido) |

**O que o sistema do vendedor recebe e confere:**
- **corpo:** um POST em JSON, com `data.order` trazendo comprador, itens (`kind` `MAIN` ou `BUMP`) e
  a data de fim do acesso de cada item (`accessExpiresAt`);
- **assinatura:** o cabeçalho `X-Cifra-Signature: t=<unix>,v1=<hex>`. Ele calcula o HMAC-SHA256 do
  segredo sobre `<t>.<corpo bruto>`, compara com `v1` e recusa avisos com mais de 5 minutos;
- **repetições:** `X-Cifra-Event-Id` é o mesmo em todas, e serve para descartar avisos repetidos.

**Quando o sistema do vendedor falha:**
- qualquer resposta fora de 2xx é repetida por até 24 horas;
- depois de **3 dias seguidos sem sucesso**, o webhook é desligado e o vendedor recebe um e-mail;
- os avisos desse período ficam no histórico para “Reenviar” depois de “Religar”.

## Recuperação (Parte 5)

O vendedor vê em **Recuperação** quem gerou o Pix e não pagou e quem preencheu os dados e saiu.

- **Lead:** a página grava o que já foi digitado quando o comprador sai de um campo, desde que
  haja e-mail ou celular válidos. Depois de 30 minutos sem pedido, o lead aparece na lista e o
  webhook recebe `lead.abandoned`, uma vez.
- **Recuperado:** quando o mesmo comprador (CPF/CNPJ, ou e-mail no lead) paga o mesmo produto em
  até 30 dias, os registros anteriores saem de "A recuperar" e vão para "Recuperados".
- **CSV:** segue os filtros da tela, com até 5.000 linhas. Cada exportação fica na auditoria
  (`CHECKOUT_RECOVERY_EXPORTED`, com filtros e quantidade, sem os dados).
- **Anonimização:** todo dia às 03:40 (horário de Brasília), pedidos não pagos e leads com mais de
  12 meses perdem nome, e-mail, CPF/CNPJ, celular e UTMs, e os avisos de webhook deles perdem o
  corpo. Vendas pagas não mudam. Se um titular pedir exclusão antes disso, a correção é manual
  no banco, com registro na auditoria.

## Cartão (Parte 6)

O cartão do checkout usa a conta Efí da Cifra+ e fica **desligado** até a homologação de cartão
nessa conta.

**Antes de ligar:**
1. Confirmar com a Efí a homologação de cartão (API Cobranças) na conta Cifra+, o prazo de crédito
   com recebimento antecipado e o nome na fatura.
2. Conferir que `EFI_CHARGES_WEBHOOK_BASE_URL` aponta para a API (https, sem caminho). Os avisos
   chegam em `/webhooks/efi/cobrancas?account=<id da conta Cifra+>`.
3. Conferir o código do recebedor (`payeeCode`) da conta Cifra+: o navegador usa ele para
   tokenizar o cartão.

**Ligar (Admin → Checkout → Conta Efí da Cifra+ → Cartão):**
- informar a tarifa à vista, a antecipação por parcela e os dias até o crédito (padrão 30);
- marcar "Cartão ligado" e salvar. Cada mudança cria uma nova versão; os pedidos antigos ficam
  com a versão em que foram vendidos;
- o vendedor liga o cartão em Configurações do checkout, com o máximo de parcelas e quem paga a
  taxa.

**Primeira venda em homologação:** um cartão de teste da Efí em 1x e outro em 3x. Conferir que o
pedido fica pago só depois do aviso da Efí e que a venda aparece em Vendas liberando em 30 dias.

**O que fazer quando:**
- **Pagamento em análise que não termina:** o worker consulta a Efí pelo id da tentativa a cada
  minuto. Sem cobrança na Efí depois de 30 minutos, a tentativa é cancelada. Uma anomalia
  `CHECKOUT_CARD_*` pede conferência manual no app Efí; nunca cobre de novo.
- **Estorno ou contestação no cartão:** o aviso da Efí vira anomalia
  (`CHECKOUT_CARD_REFUNDED_REVIEW`, `CHECKOUT_CARD_CONTESTED_REVIEW`). O admin faz o estorno no
  app Efí e registra o reembolso ou a contestação em Admin → Checkout (Parte 3).
- **Chargeback alto de um vendedor:** em Admin → Checkout → cliente, "Pausar cartão" com o
  motivo. O Pix continua; "Retomar cartão" desfaz.
- **Comprador barrado:** 3 tentativas por pedido, 5 por CPF/CNPJ em 24 h e 10 por IP por hora.
  Depois disso, a página sugere o Pix.

## Ofertas depois da compra (Parte 7)

O vendedor escolhe no produto, em "Depois da compra", para onde o comprador vai depois de pagar e por
quanto tempo a oferta vale (15 minutos a 24 horas). Upsell e downsell ficam em "Ofertas depois da
compra", no mesmo produto. Não há chave do admin: o upsell no cartão segue o cartão da conta Cifra+ e
a pausa por vendedor.

**Antes de ligar em produção:** em homologação, comprar com um cartão de teste num produto com
oferta e aceitar o upsell no cartão. Conferir na Efí que saíram duas cobranças com o mesmo
`payment_token`, sem digitar o cartão de novo. A documentação da Efí não diz se a resposta da
primeira cobrança devolve um token novo; se devolver, o cliente da Efí precisa guardá-lo.

**O que fazer quando:**
- **Comprador diz que pagou a oferta e não recebeu:** a oferta é um pedido próprio, ligado à compra
  de origem. Em Vendas aparece como "Upsell" ou "Downsell"; o acesso sai por e-mail como em qualquer
  venda.
- **Reembolso de uma oferta:** é um pedido separado; reembolse só ele (Parte 3). A compra de origem
  não muda.
- **Cartão guardado:** o worker apaga token, CPF do titular e endereço quando a janela fecha, depois
  de uma recusa ou um dia depois de uma tentativa sem pagamento. Nunca copie esses dados para fora
  do banco.
- **Link de 1 clique vazado:** vale só para aquela compra, até o fim da janela, e cada oferta é
  aceita uma vez. Para cortar antes, desative a oferta no produto.
