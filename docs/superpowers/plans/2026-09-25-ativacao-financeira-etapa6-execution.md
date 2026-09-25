# Execução da etapa 6: emissão, webhooks e multa/juros por conta correta

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, etapa 6 e seção 8.4, Fase A (conta própria do cliente). Registro anterior: etapa 5.

## Decisões

- **Ruling:** a cobrança é reservada com o contexto financeiro fechado, antes de qualquer chamada à Efí. O contexto inclui:
  - perfil, identidade, credencial, modos e ambiente;
  - a distribuição (`distributionSnapshot`);
  - multa, juros e dias após o vencimento.
  
  A reserva lê o ponteiro da empresa com `FOR SHARE`. Se o perfil ativo mudou entre a checagem e a reserva, a emissão é recusada com `FINANCIAL_PROFILE_CHANGED` e nada é gravado.
- **Ruling:** emissão, cancelamento e conciliação usam a conta registrada na cobrança, com a credencial ACTIVE dessa identidade (inclusive após rotação).
  - Não existe mais fallback para as credenciais `EFI_PLATFORM_*`.
  - Uma cobrança antiga continua operada na conta que a emitiu, mesmo depois da troca de perfil.
  - A cobrança sem conta registrada não é enviada (`EFI_SUBMISSION_UNCERTAIN`).
  - Cobranças anteriores aos perfis (legado) continuam no `GatewayAccount`. A conciliação desse legado não exige mais a conta ACTIVE.
- **Ruling:** o SDK é instanciado por operação, então o token OAuth nunca é compartilhado entre contas. Não foi criado cache adicional.
- **Ruling:** webhook de Cobranças.
  - A URL de notificação das cobranças novas leva `account=<identidade>`, que só escolhe a credencial usada para consultar o token.
  - A cobrança é buscada **restrita a essa identidade**; a empresa vem da cobrança, nunca da URL.
  - `companyId` na URL só atende cobranças legadas, sem perfil.
- **Ruling:** webhook Pix. A chave recebedora (`chave`) precisa ser a da identidade que emitiu a cobrança; se divergir, o evento é ignorado.
- **Ruling:** conta, cobrança ou txid desconhecidos e recebedor divergente vão para `PaymentWebhookAnomaly`.
  - Só são guardados origem, motivo, referência externa e empresa quando conhecida, com contador de ocorrências; o payload não é guardado.
  - Nada é baixado em outra empresa.
- **Ruling:** o valor pago vem do provedor (`valor` no Pix, `value` na notificação de Cobranças, soma dos recebimentos na conciliação) e é gravado em `paidAmountCents`.
  - A remuneração CifraMais efetiva é recalculada sobre esse valor, incluindo multa e juros.
  - Valor pago menor que o da cobrança liquida a cobrança como reportado e registra `PAYMENT_AMOUNT_DIVERGENCE` (`REVIEW_REQUIRED`), para a decisão administrativa da etapa 7.
- **Ruling:** multa, juros e prazo após o vencimento.
  - Na API e nas telas são percentuais com até 2 casas; no banco, pontos-base.
  - Limites: multa 0–10%, juros 0–100% ao mês, dias 0–365.
  - Campo vazio usa o padrão da empresa e zero significa nenhum.
  - Ao abrir o formulário de nova cobrança, os campos já vêm com o padrão da empresa.
  - Recorrência guarda os termos e os copia para cada fatura gerada. Editar a recorrência vale para as próximas faturas.
  - Alterar o padrão da empresa não muda cobranças já emitidas.
- **Ruling:** o `expiresAt` da cobrança passa a ser o fim do prazo de pagamento: vencimento + dias após o vencimento + 1. Até essa data, a mesma cobrança é reutilizada (o QR/boleto passa a cobrar multa e juros). A substituição continua exigindo a cobrança expirada.
- **Ruling:** o painel alerta, sem bloquear, multa acima de 2% para devedor pessoa física (CDC).

## Mapeamento Efí

| Termo | Pix CobV | Boleto/BOLIX (`banking_billet.configurations`) |
| --- | --- | --- |
| Multa % | `valor.multa` `{ modalidade: 2, valorPerc: "2.00" }` | `fine: 200` |
| Juros % ao mês | `valor.juros` `{ modalidade: 3, valorPerc: "1.00" }` (dias corridos) | `interest: { value: 100, type: "monthly" }` |
| Dias após vencimento | `calendario.validadeAposVencimento` (antes fixo em 0) | `days_to_write_off` (enviado só quando > 0) |

Valores zerados não são enviados.

## Mudanças

| Ponto | Arquivos |
| --- | --- |
| Contexto na reserva e tarifa sobre o valor pago | `payment-charge.service.ts`, `payment.service.ts`, `gateway-health.service.ts` |
| Conta por cobrança, webhooks, anomalias e payloads de multa/juros | `efi.service.ts`, `webhooks.controller.ts`, `webhooks.service.ts` |
| Schema: `PaymentCharge.paidAmountCents` e `PaymentWebhookAnomaly`, com CHECKs de valor, origem, motivo, referência e ocorrências | migration `20260926120000_payment_charge_issuer_context` |
| Regras de multa/juros compartilhadas | `invoices/late-terms.ts` |
| Padrão da empresa em `GET/PUT /billing/settings` (`lateFinePercentage`, `lateInterestMonthlyPercentage`, `paymentDaysAfterDue`) | `billing.service.ts`, `billing.controller.ts`, `update-billing-settings.dto.ts` |
| Faturas, recorrências e CSV: campos opcionais `late_fine_percentage`, `late_interest_monthly_percentage`, `payment_days_after_due` (recorrência: camelCase); listagens devolvem `lateTerms` | `invoices.service.ts`, `invoices.controller.ts`, `dto/invoice.dto.ts` |
| Frontend: seção em Configurações → Cobrança; campos na nova cobrança (Cobranças e Clientes) e na edição de recorrência; colunas opcionais no CSV e no modelo | `LateTermsFields.tsx`, `lib/late-terms.ts`, `UploadCSV.tsx` e as páginas |

## Verificação

- `test/payment-postgres.cjs` ganhou 6 cenários, todos PASS:
  1. Contexto gravado na reserva e imutável; perfil trocado durante a emissão é recusado sem reserva; a cobrança antiga é cancelada na conta que a emitiu.
  2. Pix recebido em outra chave não liquida e fica registrado; txid desconhecido soma ocorrências; a remuneração é calculada sobre R$ 106,50 pagos.
  3. Webhook de Cobranças com a conta A não liquida cobrança da conta B; conta desconhecida é registrada; pagamento parcial vai para revisão.
  4. Emissão Pix CobV e BOLIX de ponta a ponta, com SDK simulado. Confere `validadeAposVencimento`, `multa`/`juros`, `configurations`, a URL com `account=` e `expiresAt`.
  5. Padrão da empresa, sobrescrita por cobrança (zero = nenhum) e recorrência copiando os termos.
  6. A identidade emissora é sempre a do perfil ativo.
- Backend:
  - `npx jest`: 92 suítes / 652 testes;
  - ESLint (`src`) e `nest build` sem erros;
  - `tsc`: os mesmos 12 erros antigos em specs;
  - harnesses PostgreSQL em 37 migrations, todos PASS: `payment`, `financial-activation`, `-candidates-`, `-validation-`, `-lifecycle-`, `communications`, `backup-restore`.
- Frontend:
  - `npx jest`: 37 suítes / 140 testes;
  - `tsc` sem erros;
  - `npm run lint` só com o aviso antigo do `InvoiceTable`;
  - `npm run build` OK.

## Pendente para homologação (etapa 9)

- Unidade de `interest` mensal no boleto (assumido 100 = 1% a.m., mesma convenção de `fine`) e limites aceitos pela Efí para juros e `days_to_write_off`.
- Comportamento do boleto sem `days_to_write_off` quando o prazo é 0.
- Pix do BOLIX pago após o vencimento: se cobra multa/juros e por qual webhook chega.
- Pix do BOLIX pago pelo QR: o webhook Pix da conta deve chegar com txid que não é nosso e ser registrado como `UNKNOWN_TXID`, enquanto a baixa vem pelo webhook de Cobranças. Confirmar e, se gerar ruído, marcar esse caso como esperado.
- Split com parcela fixa e pagamento com multa/juros. A diferença vira ajuste de conciliação (etapa 7); conferir como a Efí distribui o excedente.
- Modos de conta CifraMais (Fase B) seguem bloqueados na ativação e, na emissão, são recusados antes da reserva (`FINANCIAL_MODE_NOT_SUPPORTED`).
