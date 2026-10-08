# Validação técnica local de cartão

Contratos exercitados por `api-cobranca/src/payment/efi-card.client.spec.ts`, cálculo em `card-amounts.spec.ts` e integração em `test/card-checkout.e2e-spec.ts`. Efí é simulada; a migração foi aplicada em PostgreSQL descartável. Nenhuma credencial ou transação real foi utilizada.

Tarifa de processamento uniforme entre bandeiras, para cada número de parcelas, confirmada pelo usuário. O admin cadastra percentuais contratuais por conta; o backend exige uma configuração completa e uniforme. A consulta de parcelas fornece valores em centavos e incorpora o custo do parcelamento; aumentar o item somente pela tarifa de processamento evita duplicar esse custo. A submissão distingue total do item e total das parcelas. Respostas fora do contrato ficam incertas e bloqueadas para conciliação.

Exemplos calculados para 1x/2x/6x, fontes de taxas, arredondamento e checklist de homologação externa: [operação de cartão](../operations/efi-credit-card.md). Homologação real de tarifa integral, líquido e split continua pré-requisito de habilitação por conta.

A revisão independente identificou CORS, regressão de aprovação, tarifação por bandeira não verificável pelo token e divergências ocultadas no retorno de conciliação. As correções foram aceitas na rechecagem. O teste de regressão do estado aprovado falhou antes da correção e passou depois.
