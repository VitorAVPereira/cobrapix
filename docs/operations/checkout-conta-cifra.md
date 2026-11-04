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
| Devolução de Pix do checkout | Ainda não é tratada (Parte 3); vira a anomalia `CHECKOUT_REFUND_PENDING` | Registrar o reembolso manualmente até a Parte 3 |
| E-mail de acesso não saiu | A fila `checkout-mail` tenta 5 vezes, com intervalo crescente | Conferir `RESEND_API_KEY` e `RESEND_FROM_EMAIL` |
