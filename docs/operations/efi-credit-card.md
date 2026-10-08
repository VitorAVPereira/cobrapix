# Cartão de crédito Efí

Implementação local concluída; não houve deploy, habilitação de empresas ou transações reais. O cartão permanece desabilitado até configuração administrativa por conta emissora. A empresa escolhe cartão na emissão; o pagador recebe somente essa opção no link assinado de 90 dias `/pagar/<token>`.

## Configuração e liberação

1. Publicar o backend e aplicar a migration aditiva `20261007120000_add_credit_card_checkout` antes de publicar o frontend. Usar o procedimento normal de publicação, somente com autorização operacional.
2. Conferir `FRONTEND_URL`, `ALLOWED_ORIGINS`, `NEXT_PUBLIC_API_URL`, segredo do link, credenciais da conta da empresa, `EFI_PLATFORM_PAYEE_CODE` e `EFI_CHARGES_WEBHOOK_BASE_URL` HTTPS. O CORS permite `Idempotency-Key`; as mutações públicas exigem origem exata de `FRONTEND_URL`.
3. Em Admin → ativação financeira da empresa → Cartão de crédito, informar percentuais Cifra+ no prazo/em atraso e a tarifa **contratada de processamento** Efí para cada parcelamento. O usuário confirmou tarifa igual entre bandeiras para o mesmo número de parcelas; a API recusa configurações diferentes ou incompletas entre as quatro bandeiras suportadas. Conferir também que as condições de parcelamento da conta são uniformes para tokens das bandeiras aceitas: o token é opaco e não permite comprovar a bandeira no backend antes do débito. Não copiar taxas publicadas como se fossem contratuais.
4. Homologar 1x, 2x e 6x e split de valor fixo `mode=1` na conta emissora; confirmar valor dos itens, total das parcelas, tarifa integral Efí, líquido da empresa e repasse Cifra+. A validação externa não foi executada nesta tarefa. Registrar uma referência de evidência, sem credenciais. Só então habilitar cartão.
5. Habilitar/desabilitar cartão cria uma versão sucessora do perfil financeiro na mesma conta, preservando evidências e métodos Pix/Bolix. Configurações têm versão esperada: `409` exige recarregar. Nova ativação financeira precisa habilitar cartão novamente por esta tela. Contas da plataforma e repasse manual permanecem bloqueados.
6. Conferir um template de cobrança que use o link de pagamento e não exija Pix ou boleto. A régua aceita um template próprio para cartão. Templates incompatíveis continuam retidos pela política normal.

## Cálculo e exemplos simulados

Principal descontado = principal − desconto aplicável. O desconto segue a configuração da empresa, ou a do devedor quando ele não a herda, até o limite de dias configurado. Multa e juros incidem sobre o principal original. Juros simples = principal × taxa mensal × dias em atraso / 30. Dias civis e vencimento usam a convenção existente; mudança de dia em Brasília invalida a cotação.

Cifra+ = principal descontado × percentual no prazo/em atraso; não inclui multa, juros ou custo Efí. Esse valor fixo é enviado por split; confirmação do pagamento não comprova recebimento do split.

A consulta de parcelas Efí incorpora encargos de parcelamento. O cálculo aumenta o item apenas pela tarifa contratual de processamento, incidente sobre o total das parcelas, até convergir em centavos. Não soma juros do parcelamento duas vezes. Cotação válida por dez minutos, limitada à meia-noite; mudanças de dívida/configuração exigem nova confirmação. Sem convergência ou resposta incompatível, a cotação é bloqueada.

Fixtures ilustrativas, **não tarifas reais**: principal R$ 100, desconto R$ 10, atraso de 15 dias, multa de 2%, juros de 1% ao mês. Dívida R$ 92,50; base Cifra+ R$ 90; percentual recuperado 5%, split R$ 4,50. Processamento fictício uniforme 3%; fatores de parcelamento fictícios 1,00 / 1,05 / 1,15.

| Parcelas | Item enviado | Total pago | Cada parcela | Processamento | Parcelamento | Custo Efí total | Líquido empresa | Cifra+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1x | R$ 95,36 | R$ 95,36 | R$ 95,36 | R$ 2,86 | R$ 0,00 | R$ 2,86 | R$ 88,00 | R$ 4,50 |
| 2x | R$ 95,51 | R$ 100,28 | R$ 50,14 | R$ 3,01 | R$ 4,77 | R$ 7,78 | R$ 88,00 | R$ 4,50 |
| 6x | R$ 95,80 | R$ 110,16 | R$ 18,36 | R$ 3,30 | R$ 14,36 | R$ 17,66 | R$ 88,00 | R$ 4,50 |

Arredondamento positivo em centavos, meia unidade para cima; total = número de parcelas × valor de parcela retornado pela Efí. A resposta da submissão usa os campos de parcelas quando disponíveis, separadamente do total dos itens.

## Estados e recuperação

- Emissão cria reserva local e link; GET público nunca debita.
- Dados completos do cartão ficam no navegador e seguem diretamente para a Efí por `payment-token-efi`, `reuse:false`. Backend recebe token transitório; banco guarda somente hash da confirmação, referências e valores. Não persistir nem registrar PAN, CVV ou token.
- Confirmação usa chave de idempotência, travas da fatura/cobrança e índice de tentativa ativa única. Há limite de cinco tentativas em quinze minutos por cobrança, além do rate limiting HTTP.
- `approved`, `waiting` e `identified` aguardam confirmação. Somente `paid`, com identidade, referência e valor conferidos, baixa a fatura. Estados pagos/aprovados não regridem por resposta atrasada de recusa.
- Timeout ou persistência incerta mantém reserva bloqueada; nunca reenviar automaticamente. Worker concilia a cada minuto por `custom_id` e consulta canônica na conta emissora original. Admin pode consultar a Efí na lista de tentativas, inclusive quando o worker não comprova o resultado.
- Recusa comprovada permite nova simulação e confirmação explícita com novo token; antes da nova submissão, cancelar a cobrança recusada anterior. Cancelamento incerto mantém bloqueio para revisão.
- Cancelamento de fatura usa a mesma ordem de travas do checkout; tentativa em envio, incerta, aprovada ou paga impede cancelamento.
- Valores/referências divergentes, tentativa antiga com pagamento, contestação e devolução geram revisão administrativa visível. Não há estorno automático, estorno de split ou repetição de cobrança; usar o procedimento Efí suportado para a conta e reconciliar com evidência. Notificações e consultas administrativas detectam esses estados após pagamento; o worker não consulta indefinidamente tentativas já baixadas.
- Pix/Bolix mantêm suas versões tarifárias, emissão e conciliação. O cartão congela sua remuneração sobre o principal descontado na tentativa aceita; custo Efí efetivo permanece estimado até evidência financeira.

## Validação local

Provedores simulados; PostgreSQL e Redis descartáveis, sem `.env` compartilhado. Executar no backend:

```bash
npm run prisma:generate
npm run build
npm test -- --runInBand
node test/e2e-disposable.cjs card-checkout.e2e-spec.ts payment-issuance-recovery.e2e-spec.ts
```

No frontend: `npx jest --runInBand`, `npm run lint`, `npm run build`. Neste ambiente o Turbopack não consegue abrir uma porta interna; `npx next build --webpack` compilou a aplicação. O aviso existente de `useReactTable` permanece.

Documentação Efí: [Cartão](https://dev.efipay.com.br/docs/api-cobrancas/cartao/), [Split](https://dev.efipay.com.br/docs/api-cobrancas/split-de-pagamento/), [Notificações](https://dev.efipay.com.br/docs/api-cobrancas/notificacoes/).
