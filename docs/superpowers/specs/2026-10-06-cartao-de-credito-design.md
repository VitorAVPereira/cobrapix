# Cartão de crédito — especificação para revisão

**Status:** implementação autorizada posteriormente pelo usuário e concluída localmente em 07/10/2026. Homologação externa, configuração de empresas e publicação pendentes; consulte [operação de cartão](../../operations/efi-credit-card.md). Tarifa de processamento uniforme entre bandeiras confirmada pelo usuário durante a implementação.

## Objetivo e critério de pronto

Permitir que a empresa emita uma fatura com a forma Cartão de crédito e que o pagador conclua o pagamento exclusivamente por cartão em `<dominio>/pagar/<auth-token>`, de 1 a 6 parcelas. O total deve incorporar os encargos por atraso existentes e repassar somente os custos de cartão da Efí ao pagador. Pix e Bolix devem manter os valores, tarifas, emissão, comunicação e conciliação atuais.

## Regras confirmadas

- Opção B: a empresa escolhe cartão na emissão. Escolha entre formas de pagamento pelo pagador está fora do escopo.
- Parcelamento em até 6x; oferecer somente as opções efetivamente permitidas pela Efí para a conta, bandeira e valor.
- O pagador arca somente com os custos de cartão da Efí, incluindo parcelamento; a tarifa CifraMais é descontada da empresa.
- Remuneração CifraMais usa os percentuais atuais de taxa no prazo/taxa recuperada somente sobre o principal após descontos. Multa, juros por atraso e acréscimo Efí não compõem sua base.
- Aplicar multa e juros de atraso quando configurados na fatura.
- Juros por atraso simples, com taxa mensal dividida por 30 e proporcional aos dias de atraso; não aplicar juros compostos.
- Aplicar descontos automáticos pela mesma regra existente de empresa/devedor, respeitando elegibilidade, percentual e prazo. Não criar uma regra independente para cartão.
- A remuneração CifraMais é repassada por split automático; não substituir por repasse manual. Configuração do split e comprovação do recebimento continuam sendo eventos distintos.
- Nenhuma alteração na regra financeira de Pix ou Bolix.

## Contexto conferido no repositório

- Frontend Next.js 16/React 19; backend NestJS 11/Prisma 7/PostgreSQL, BullMQ/Redis.
- A rota `front-cobranca/src/app/pagar/[signedToken]` já existe, sem login, com cache desabilitado e referrer restrito.
- `PublicPaymentLinkService` já assina links por empresa/fatura, com validade de 90 dias. Reutilizar assinatura e formato; não usar JWT de sessão para o pagador.
- `BillingMethod` contém PIX, BOLETO e BOLIX. Políticas de emissão, ativação e reserva aceitam apenas PIX/BOLIX.
- `PaymentCharge` fotografa tarifas, termos de atraso e conta emissora. A conciliação atual calcula tarifa CifraMais sobre o montante pago: cartão precisa de uma base separada para excluir o acréscimo Efí sem alterar os demais métodos.
- O modelo de devedor não contém endereço de cobrança; documento/e-mail podem estar ausentes. O checkout deve solicitar os campos exigidos pelo provedor, sem pressupor que estejam cadastrados.
- A operação atual usa conta Efí da empresa, com remuneração CifraMais por split. A fase de conta emissora da plataforma permanece bloqueada.

## Abordagens e recomendação

1. **Checkout próprio com submissão após confirmação — recomendado.** Na emissão, reservar uma cobrança local de cartão e gerar o link. Calcular valores no servidor e enviar a transação à Efí somente quando o pagador confirmar, com token do cartão. Permite atualizar encargos antes do pagamento e apresentar o total no domínio informado.
2. **Criar transação Efí sem método e associar cartão depois.** Anteciparia um `charge_id`, mas o valor depende da data do pagamento e das parcelas; exige validar atualização de transações ainda abertas. Acrescenta sincronização sem benefício confirmado para esta versão.
3. **Checkout hospedado da Efí.** Reduz o formulário próprio, mas precisa validar controle dos acréscimos e experiência após o link local. Não é a abordagem escolhida para esta proposta.

Na recomendação, abertura da página nunca gera cobrança na Efí. A emissão comercial e a submissão financeira são eventos diferentes, registrados como tal.

## Fluxo proposto

1. Empresa financeiramente ativa escolhe `CREDIT_CARD`; o servidor verifica habilitação de cartão na conta emissora e reserva a cobrança local, sem dados de cartão.
2. O sistema envia o link pela infraestrutura existente de comunicação. Não exigir Pix, linha digitável ou PDF para cartão.
3. A página mostra identificação mínima da cobrança, vencimento, principal e encargos. Token válido para Pix/Bolix não autoriza cartão.
4. O pagador informa dados necessários, escolhe de 1 a 6 parcelas e recebe cotação calculada pelo backend para a conta emissora fotografada.
5. A biblioteca Efí tokeniza o cartão no navegador, com `reuse: false`. PAN/CVV não passam pelo backend; desabilitar registro de campos sensíveis em logs e ferramentas de sessão.
6. O pagador confirma explicitamente total e parcelas. Backend valida token do link, cotação, estado, prazo, idempotência e versão antes de submeter.
7. Persistir reserva e identificador de tentativa antes da chamada externa. Submeter uma vez; timeout/resultados incertos bloqueiam nova tentativa até conciliação.
8. Mostrar processamento, recusa ou confirmação. Consultas e notificações autenticadas usam sempre a conta emissora original.

## Valores e fotografia financeira

Manter campos separados para principal, desconto aplicável pela regra existente, multa, juros por atraso, base da dívida, base da remuneração CifraMais, custo Efí, total do pagador e quantidade/valores das parcelas. Não alterar `Invoice.originalAmount` para incluir taxas de cartão.

`baseDebtCents = principalCents - discountCents + lateFineCents + lateInterestCents`.

`platformFeeBaseCents = principalCents - discountCents`.

`platformFeeCents = round(platformFeeBaseCents * platformFeeBasisPoints / 10000)`.

Exemplo independente da convenção de encargos: principal R$ 100,00, desconto R$ 10,00, multa/juros somando R$ 5,00 e taxa CifraMais de 2% resultam em base CifraMais de R$ 90,00 e split de R$ 1,80. A dívida para o pagador é R$ 95,00 antes do acréscimo Efí; os R$ 5,00 de encargos e o custo Efí não aumentam o split.

Resolver o desconto usando a precedência atual entre empresa e devedor (`useGlobalBillingSettings`), percentual e prazo de elegibilidade. Fotografar o desconto da cotação e revalidar sua elegibilidade antes da submissão. Preservar a ordem/base de incidência dos encargos e descontos do fluxo existente; qualquer diferença necessária à implementação deve ser explicitada e revisada antes de cobrar. Mudança de elegibilidade exige nova cotação e confirmação.

O acréscimo deve permitir que o líquido depois do custo Efí corresponda à base da dívida, antes da remuneração CifraMais. Apenas somar um percentual ao principal pode deixar diferença quando a Efí desconta a tarifa sobre o total aumentado. O adaptador deve separar o valor enviado nos itens da API, juros adicionados pela Efí e total cobrado do pagador, evitando contar parcelamento duas vezes.

O endpoint de parcelas não será tratado, sem comprovação, como cobertura integral da tarifa de processamento. Validar o cálculo para 1x e 6x, por conta/bandeira, usando condições reais da conta e exemplos controlados. Se a API não fornecer a tarifa necessária, usar configuração versionada por conta, administrada pela plataforma, sem copiar taxas públicas como se fossem contratuais. Bloquear habilitação quando essa informação faltar.

Regra confirmada de juros por atraso: juros simples sobre o principal, taxa mensal dividida por 30 e proporcional aos dias civis de atraso; multa única sobre o principal. Arredondar cada componente para centavos, sem juros sobre multa ou custo de cartão. Usar data civil de Brasília (`America/Sao_Paulo`) e a data de vencimento comercial, preservando a representação YYYY-MM-DD existente.

`lateInterestCents = round(principalCents * lateInterestMonthlyBasisPoints * daysLate / 300000)`.

`daysLate` é a diferença positiva entre a data civil de pagamento e o vencimento comercial; zero antes e no vencimento. Não dividir o mês real em 28, 29 ou 31 dias. Exemplo confirmado: principal de R$ 100,00, juros de 1% ao mês e 15 dias de atraso geram R$ 0,50 de juros. Ausência de taxa ou taxa zero gera juros zero.

Cotação válida por 10 minutos e nunca além da mudança do dia civil ou prazo final de pagamento. Se a dívida, tarifa, conta, encargos ou cotação mudarem, responder conflito e apresentar nova confirmação antes de qualquer cobrança. O cliente não envia preço ou percentual autoritativo.

Base confirmada da remuneração CifraMais: somente o principal após descontos, sem multa, juros ou custo Efí. Fotografar essa base na cotação e na tentativa e reutilizá-la na conciliação, sem recalcular o percentual sobre o total pago. Definir categoria no prazo/recuperada pela data da confirmação do pagador, sem deixar a demora do crédito Efí mudar a categoria de uma tentativa já submetida.

Fotografar valores e percentuais na tentativa aceita. O repasse da remuneração CifraMais deve ocorrer por split automático. Propor envio do valor fixo equivalente à remuneração calculada e tarifa Efí atribuída à conta emissora (`mode=1`), sujeito à validação do cartão com split. A configuração em valor fixo na Efí não muda a regra percentual CifraMais: representa o resultado calculado sobre a base aprovada. Não aplicar o percentual CifraMais ao total com acréscimo, nem criar repasse manual como fallback.

## Contratos e estados propostos

- Preservar `GET /payments/public/:token` e acrescentar dados específicos de cartão de forma aditiva.
- `POST /payments/public/:token/card/quote`: entrada `brand`; retorno `quoteId`, `validUntil`, componentes em centavos e opções de parcelas. Cotação persistida não emite pagamento na Efí.
- `POST /payments/public/:token/card/pay`: entrada `quoteId`, `installments`, `paymentToken` e dados exigidos do pagador; header `Idempotency-Key`. A conta/empresa/fatura vêm do link e da reserva, nunca do body.
- Reutilizar a consulta pública para acompanhar o andamento, com estado adicional `PROCESSING` somente para cartão. Atualizar backend e frontend de forma compatível antes de habilitar cartão.
- Emissão local pronta para cartão pode ser pagável mesmo sem `efiChargeId`. Não afrouxar o requisito atual de emissão confirmada de Pix/Bolix.
- Reserva da cobrança e estado da tentativa são diferentes: `READY`, `SUBMITTING`, `UNCERTAIN`, `DECLINED`, `APPROVED`, `PAID`, `CANCELED` como estados próprios da tentativa; não reinterpretar globalmente `PaymentChargeStatus.PENDING`.
- Resposta HTTP 200 não confirma pagamento. Proposta conservadora: `waiting`/`approved` mostram processamento e impedem nova submissão; `paid` confirma pagamento. Recebimento do split requer evidência separada. `settled`, contestação e valores divergentes geram revisão financeira.
- Recusa comprovada permite nova ação do pagador com nova tokenização/cotação. Reutilizar `/retry` apenas se houver `charge_id` no estado `unpaid`, valores compatíveis e tentativa anterior conclusivamente encerrada. Caso contrário, o plano de nova tentativa deve cancelar/encerrar a cobrança antiga de forma comprovada antes de uma nova transação; nunca reenviar resultado incerto.
- Cobrança paga/cancelada/expirada exibe apenas estado; preservar prazo pós-vencimento configurado. Link expirado e vencimento da dívida continuam sendo condições distintas.

## Comunicação, segurança e compatibilidade

- Adicionar cartão à seleção de forma nas telas de emissão e aos contratos necessários. Recorrência comercial gera novas faturas e links; débito automático ou reutilização de cartão ficam fora do escopo.
- Templates de cartão usam o link público. Templates com instrumentos de Pix/boleto não são adaptados automaticamente. Sem template compatível/liberado, preservar pendência e revisão administrativa.
- Isolamento por empresa, limitação de tentativas no checkout, validação de origem nas mutações, respostas sem segredos e idempotência também no banco. Não confiar em botão desabilitado para evitar duplicidade.
- Nunca persistir PAN/CVV ou `payment_token` reutilizável. Identificador público de conta necessário à tokenização não equivale a credencial OAuth.
- Migrations aditivas; nenhum backfill altera valores ou forma de cobranças existentes. Cartão inicialmente desabilitado por empresa, liberado após validação operacional.

## Validações técnicas e operacionais restantes

1. Validar tecnicamente tarifa integral Efí, valor de submissão, arredondamento de parcelas e split de cartão; é pré-requisito de liberação, não trabalho opcional posterior.
2. Confirmar capacidade/KYC/limites de cartão e configuração de recebimento de cada conta emissora. Integração Pix/Bolix ativa não prova habilitação de cartão.
3. A documentação de cartão informa indisponibilidade do estorno via API para marketplace. Não prometer botão de estorno automatizado para split. Registrar eventos de devolução/contestação e evidências; definir procedimento com a Efí antes de oferecer estorno. Não contornar usando outra forma de repasse.

## Fora do escopo

Escolha aberta de meios pelo pagador, mudanças em Pix/Bolix, conta emissora da plataforma, cartão salvo, assinatura/débito recorrente, antecipação automática de recebíveis, redesenho geral da régua e estorno automático de marketplace não suportado.

## Fontes consultadas

- [Cartão: tokenização, emissão, parcelas, consultas e limites de estorno](https://dev.efipay.com.br/docs/api-cobrancas/cartao/).
- [Split: modalidades de distribuição e atribuição da tarifa](https://dev.efipay.com.br/docs/api-cobrancas/split-de-pagamento/).
- [Notificações: consulta do histórico pelo token](https://dev.efipay.com.br/docs/api-cobrancas/notificacoes/).
- [Status: distinguir aprovado, pago e confirmação manual](https://dev.efipay.com.br/docs/api-cobrancas/status/).

Os contratos locais são propostas de projeto. Os detalhes de cálculo não documentados como confirmados exigem validação e não devem ser inferidos dos exemplos do provedor.
