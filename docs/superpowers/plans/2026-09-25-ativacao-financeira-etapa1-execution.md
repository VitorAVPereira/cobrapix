# Execução da etapa 1 — contratos e compatibilidade

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, somente etapa 1, com as decisões da seção 8.

## Decisões

- Ruling (responsável): implementação em duas fases (seção 8.6 do plano). Fase A entrega a conta própria do cliente de ponta a ponta; Fase B acrescenta os modos da conta CifraMais. Tipos e schema nascem com os três modos.
- Ruling: os tipos desta etapa cobrem modos, combinações válidas e distribuição por meio de pagamento. Tipos de multa/juros ficam para a etapa que os persiste, depois de conferir campos e limites na documentação Efí (o domínio `dev.efipay.com.br` está bloqueado na rede desta sessão).
- Ruling: nenhuma alteração de comportamento existente nesta etapa; nenhuma chamada nova a `gn.registration.*`.

## 1. Onde a elegibilidade financeira é decidida hoje

Todos os pontos consultam `EfiOnboarding.status === 'ACTIVE'`. Uma ativação manual precisa passar a satisfazê-los pelo perfil financeiro (etapa 5, `FinancialEligibilityService`), sem fabricar `EfiOnboarding`.

| Ponto | Arquivo | Efeito quando não ativo |
| --- | --- | --- |
| Emissão unitária, lote e substituição | `payment/gateway-health.service.ts` `assertIssuable`, chamado por `payment.service.ts` (`createPayment`, `createPaymentBatch`, `replaceExpiredCharge`) e `efi.service.ts` `createPayment` | 409 `EFI_ONBOARDING_REQUIRED` |
| Régua (execução manual e agendada) | `billing/billing.service.ts` `assertFinancialActive` (`executeBilling`, `enqueueSelectedInvoices`) e `queueBillingForCompany` | 409 ou nada enfileirado |
| Primeira cobrança automática | `invoices/invoices.service.ts` `queueInitialChargeJobs` (fatura manual, importação, recorrência) | nenhum job enfileirado, silenciosamente |
| Worker da primeira cobrança | `queue/workers/message.worker.ts` `processInitialChargeJob` | job descartado, silenciosamente |
| Rotação de segredos | `payment/rotate-payment-secrets.ts` | lê/atualiza `EfiOnboarding` junto com `GatewayAccount` |
| Frontend | `front-cobranca/src/lib/efi-onboarding.ts` `canIssueFinancially`, usado por `layout.tsx`, `cobrancas`, `configuracoes/cobranca`, `FinancialActivation.tsx` | tela direciona para `/onboarding/efi` |

`assertIssuable` exige também `PlatformIntegrationState(EFI_PAYMENTS).enabled`, `GatewayAccount.status = 'ACTIVE'`, menos de 2 falhas consecutivas e uma validação bem-sucedida **executada a cada emissão** (ver seção 3).

## 2. Seleção de conta e credenciais

- `GatewayAccount` é única por empresa (`companyId @unique`) e é a única fonte de credenciais das emissões. É criada/ativada por `efi-onboarding/onboarding-provisioner.ts` (abertura) e por `onboarding-admin.service.ts` `manual` (recuperação, que chama `EfiOpeningClient.getCredentials`).
- `admin.service.ts` `updateEfiGateway` grava `GatewayAccount`, mas é inalcançável: `rejectLegacyIntegrations` recusa qualquer `dto.efi`. `efi.service.ts` `upsertManualGatewayAccount` sempre retorna 403.
- `efi.service.ts` `getActiveGatewayAccount(companyId)` escolhe a conta atual da empresa para emitir **e também para cancelar** (`cancelPixDueCharge`, `cancelCharge`); `reconcileCharge` e o webhook de Cobranças usam `findFirst({ companyId })`. Nenhuma operação posterior usa a conta gravada na cobrança, porque ela não é gravada.
- **Fallback implícito**: `efi.service.ts` `getCredentials` usa `EFI_PLATFORM_CLIENT_ID`/`SECRET`/`CERT_PATH` quando a conta não tem credencial própria. `efi-gateway.client.ts` não tem fallback (exige as três). A regra 4 do plano pede a remoção do fallback (etapa 6).
- Cache OAuth: o SDK `sdk-node-apis-efi` 1.2.28 guarda o token no objeto `EfiPay`; `createSdkClient` cria uma instância por operação (`cache: true` sem efeito prático) e `EfiGatewayClient` usa `cache: false`. Não há vazamento de token entre contas; também não há reaproveitamento. A mesma instância autentica Pix e Cobranças no mesmo campo `auth`, então um cache futuro deve ser separado por identidade, ambiente, API e versão de credencial.

## 3. Chamadas Efí por natureza

| Chamada | Onde | Natureza |
| --- | --- | --- |
| `pixListDueCharges` (última hora) | `EfiGatewayClient.validate` | leitura; comprova autenticação Pix, não emissão |
| `pixDetailWebhook` | `validate` | leitura; confere URL do webhook Pix |
| `listPlans` | `validate` | leitura na API Cobranças; comprova autenticação Cobranças, não emissão de boleto/BOLIX |
| `pixSplitConfigId` (PUT, id estável por empresa) | `validate` | **altera**: cria/sobrescreve configuração de split de validação (99%/1% para a conta da plataforma); comprova permissão de split Pix |
| `pixConfigWebhook` | `configureWebhooks` (provisionamento) | **altera** webhook Pix da chave |
| `pixCreateEvp` / `pixListEvp` | provisionamento | **cria** chave Pix / leitura |
| `pixDeleteWebhook` | desconexão, reversão do provisionamento | **remove** webhook |
| `pixCreateDueCharge`, `pixSplitConfigId`, `pixSplitLinkDueCharge`, `pixGenerateQRCode` | emissão Pix | emissão pagável e split |
| `createOneStepCharge` com `marketplace.repasses` | emissão boleto/BOLIX | emissão pagável e split |
| `pixUpdateDueCharge`, `cancelCharge` | cancelamento | altera cobrança |
| `pixDetailDueCharge`, `detailCharge`, `getNotification` | conciliação e webhook | leitura |

Nada comprova a capacidade de emitir boleto/BOLIX nem o split de Cobranças sem emitir. `GatewayHealthService.assertIssuable` chama `validate` em **cada emissão** (4 chamadas externas, uma delas alterando split), além do cron de 6 h.

## 4. Webhooks

- Pix (`/webhooks/efi/pix`, mTLS): cobrança localizada por `efiTxid` (único global). Não se confere se a chave/conta que notificou é a emissora da cobrança.
- Cobranças (`/webhooks/efi/cobrancas?token=…&companyId=…`, segredo compartilhado): a conta usada para `getNotification` vem do `companyId` da URL (ou do `notificationToken` já salvo na fatura); a cobrança é buscada com esse `companyId`. Um `companyId` adulterado não dá baixa em outra empresa, mas a origem do contexto é a URL, não o vínculo persistido.
- BOLIX usa o mesmo payload de boleto (`createBoleto`); o Pix embutido chega pela resposta `pix.qrcode`. Qual webhook confirma o pagamento pelo Pix do BOLIX e se pode haver dupla notificação precisa de teste em homologação.

## 5. Matriz meio × modo

Implementada em `financial-activation.types.ts` (`resolveChargeDistribution`).

| Modo | Emissor | Pix CobV | BOLIX | Confirmação da parte do cliente | Fase |
| --- | --- | --- | --- | --- | --- |
| Conta do cliente | empresa | split Pix envia a remuneração à plataforma; sem remuneração, sem split | `marketplace.repasses` para `EFI_PLATFORM_PAYEE_CODE`; sem remuneração, sem split | não se aplica (recebe direto) | A |
| CifraMais + split | plataforma | split Pix envia a parte do cliente à conta Efí dele (sempre, mesmo com remuneração zero) | repasse para o `payee_code` do cliente | evidência do split ou conferência administrativa | B |
| CifraMais + manual | plataforma | sem split | sem split | lote manual conciliado | B |

Composição da parte do cliente com tarifa Efí suportada pelo cliente, remuneração sobre o valor pago e ajuste de parcela fixa: seção 8.3 do plano. Emissão só com PIX/BOLIX (`billing-method-policy.ts`); boletos legados continuam consultáveis.

## 6. Achados que afetam as próximas etapas

| Achado | Etapa |
| --- | --- |
| `createPixCobv` envia `validadeAposVencimento: 0`: o Pix vencido não pode ser pago, e multa/juros nunca se aplicariam | 6 (Fase A) |
| Cobrança não grava conta emissora/ambiente; cancelamento e conciliação usam a conta atual da empresa | 2 e 6 |
| Fallback para credenciais `EFI_PLATFORM_*` em `getCredentials` | 6 |
| Validação completa (com PUT de split) em toda emissão; lote de N faturas faz 4·N chamadas | 4 |
| Webhook Pix não confere a conta notificadora; webhook de Cobranças deriva contexto da URL | 6 |
| Renovação de certificado só existe via API de abertura (`onboarding-lifecycle.ts` `createCertificate`); conta manual precisa de upload administrativo e alertas 30/15/7 dias | 5 |
| Produção exige `EFI_OPENING_CLIENT_ID`/`SECRET`/`CERT_PATH` para subir a API | 4 (`EFI_OPENING_ENABLED`) |
| Portas silenciosas: `queueInitialChargeJobs` e o worker descartam sem registro quando não ativo | 5 |
| `api-cobranca/package-lock.json` fora de sincronia com `package.json` (`chokidar@4.0.3`, `readdirp@4.1.2`): `npm ci` falha | fora do escopo; corrigir antes da publicação (etapa 9) |

## 7. Dependências externas

- Conta/aplicação da CifraMais: split Pix e webhooks confirmados pelo responsável; validação real em homologação.
- Clientes atuais: conta própria; credenciais e certificado entregues pelo cliente.
- Pendentes: comportamento do Pix do BOLIX após o vencimento (qual webhook confirma, se aplica multa/juros), unidade de `interest` mensal e limites de juros no boleto; evidência de efetivação do split.

## 8. Conferência de multa, juros e prazo (25/09)

`dev.efipay.com.br` continuou bloqueado pelo proxy desta sessão mesmo após a liberação no ambiente. Fontes usadas: tipagens e exemplos oficiais do SDK `sdk-node-apis-efi` 1.2.28 (`dist/types/methods/pix.d.ts`, `cobrancas.d.ts`, `examples/pix/cobv/pixCreateDueCharge.js`) e trechos da documentação Efí retornados por busca.

| Regra CifraMais | Pix CobV (`PUT /v2/cobv/:txid`) | Boleto/BOLIX (`POST /v1/charge/one-step`, em `payment.banking_billet.configurations`) |
| --- | --- | --- |
| Multa percentual | `valor.multa` modalidade 2, `valorPerc` `"2.00"` | `fine` inteiro em centésimos de ponto percentual (200 = 2%); faixa citada 0,01% a 10% |
| Multa fixa | `valor.multa` modalidade 1 (valor) | **sem equivalente**: `fine` é somente percentual |
| Juros % ao mês | `valor.juros` modalidade 3 (percentual ao mês, dias corridos); também 1–8 (valor/%, dia/mês/ano, corridos/úteis) | `interest: { value, type: 'monthly' }`; número simples é tratado como diário (33 = 0,033% ao dia) |
| Dias aceitando pagamento após o vencimento | `calendario.validadeAposVencimento` (exemplo oficial: 30) | `days_to_write_off` |

- Boleto registrado Efí pode ser pago após o vencimento em qualquer banco com multa/juros quando ativos; o Pix do BOLIX compensa na hora. Resta testar em homologação se o QR do BOLIX pago após o vencimento cobra multa/juros e por qual webhook chega.
- Referência de CDC citada pela Efí: juros de até 0,033% ao dia ou 1% ao mês; multa de até 2% em relação de consumo.

## Entregas

- `api-cobranca/src/financial-activation/financial-activation.types.ts`: `ActivationOrigin`, `AccountMode`, `PayoutMode`, `validateFinancialModeSelection` (4 combinações válidas; abertura automática só com conta do cliente; entrada estrita) e `resolveChargeDistribution` (emissor, distribuição, mecanismo de split e confirmação por meio/modo).
- `financial-activation.types.spec.ts`: 30 testes, incluindo a varredura das 18 combinações.
- Plano: seção 8.6 (fases).

## Verificação

- `npx jest src/financial-activation`: 30/30.
- `npx jest`: 85 suítes / 583 testes.
- ESLint sem erros nos arquivos novos; `tsc --noEmit` sem erros nos arquivos novos (erros antigos de specs inalterados).
- Dependências instaladas com `npm install` porque `npm ci` falha pelo lockfile; a alteração do lockfile foi descartada.
- Não verificado: documentação Efí (bloqueio de rede) e qualquer chamada real à Efí.
