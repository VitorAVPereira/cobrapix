# Execução da etapa 5 — abertura existente, manutenção e elegibilidade

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, etapa 5, Fase A. Registros anteriores: etapa 4 e `2026-09-25-ativacao-financeira-telas-execution.md`.

## Decisões

- Ruling: a fonte única de elegibilidade é o perfil financeiro ativo (`FinancialEligibilityService`, agora provido pelo `PaymentModule`). Nenhum ponto de negócio lê mais `EfiOnboarding.status`.
- Ruling: a emissão deixou de fazer validação ao vivo na Efí a cada cobrança (4 chamadas por emissão, uma alterando split). A saúde vem do cron de 6 h, espelhada na identidade da conta; duas falhas seguidas tornam a identidade `UNAVAILABLE` e bloqueiam novas emissões até a próxima validação bem-sucedida.
- Ruling: a régua e o agendamento da primeira cobrança exigem apenas perfil ativo (mesma semântica anterior, com a fonte trocada). Pausa de pagamentos, saúde e método são verificados na emissão. O worker da primeira cobrança passa a registrar `INITIAL_CHARGE_SKIPPED` em vez de descartar em silêncio.
- Ruling: renovação/rotação da conta manual = nova versão pela tela de ativação (reenvio das credenciais da mesma conta mantém a identidade e aposenta a credencial anterior na ativação). Não foi criada rota separada `credential-rotations`.
- Ruling: alertas de certificado das contas manuais a 30/15/7 dias e no vencimento, por e-mail para `PLATFORM_ALERT_EMAIL`, uma vez por certificado e limiar (deduplicado por `AuditLog`); falha no envio é tentada de novo no dia seguinte. Cron diário 07:40.
- Ruling: conciliação de abertura em andamento sem API: `POST /admin/efi-onboarding/:companyId/close-for-manual` com `outcome` (`NO_ACCOUNT_OPENED` ou `ACCOUNT_OPENED_NOT_USED`) e referência da evidência. Leva a abertura a `DISCONNECTED` (`CLOSED_FOR_MANUAL_ACTIVATION`), apaga dados do representante e audita; nada é enviado à Efí. Tela para essa ação não foi feita (produção sem abertura em andamento).
- Ruling: CNPJ/CPF da empresa fica bloqueado para edição genérica quando há perfil ativo ou conta Efí registrada (`COMPANY_DOCUMENT_LOCKED`).

## Mudanças

| Ponto | Antes | Agora |
| --- | --- | --- |
| Emissão unitária, lote, substituição (`GatewayHealthService.assertIssuable`) | abertura `ACTIVE` + conta + validação ao vivo | `resolveIssuance(empresa, método)`: empresa ativa, perfil ativo, método habilitado, pagamentos liberados, identidade saudável, credencial ativa e vigente |
| Régua (`BillingService`) e primeira cobrança (`InvoicesService`, worker) | abertura `ACTIVE` | `PaymentService.hasActiveFinancialProfile` |
| Abertura concluída (`OnboardingProvisioner`) | só `EfiOnboarding` e `GatewayAccount` | publica perfil `AUTOMATIC_OPENING + CUSTOMER_ACCOUNT` (identidade, credencial ativa, ponteiro, vínculo do `GatewayAccount`) na **mesma transação** (`publishOpeningProfile`) |
| Empresa com ativação manual | — | abertura não envia (serviço e job), não provisiona (vai para `CONFIGURATION_ERROR` `FINANCIAL_MANUAL_ACTIVE` sem tocar no `GatewayAccount`), não renova por abertura e a desconexão que apaga credenciais é recusada (`FINANCIAL_PROFILE_MANUAL`) |
| Renovação por abertura | só `GatewayAccount` | também cria nova versão de credencial ativa da mesma identidade (`syncOpeningCredential`, idempotente) |
| Rotação de chaves (`payment:rotate-keys`) | `GatewayAccount` e dados da abertura | também `EfiCredentialVersion` (versões apagadas ignoradas) |
| Frontend | pode emitir = perfil ativo **ou** abertura concluída | pode emitir = perfil ativo; `canIssueFinancially` removido |

## Verificação

- `test/financial-activation-lifecycle-postgres.cjs` (10 cenários): sem perfil tudo fechado; abertura concluída publica o perfil na mesma transação; gate de emissão por perfil, pausa de pagamentos e suspensão da empresa; saúde agendada marca e recupera a identidade; renovação por abertura vira nova versão usada pelas novas cobranças; abertura tardia não substitui ativação manual e nada é gravado (rollback); conciliação explícita com evidência, uma vez; alertas 15/7 dias e vencimento, uma vez cada, com nova tentativa após falha do canal; rotação de chaves cobre as versões de credencial.
- Specs atualizados/novos: saúde do gateway, régua, faturas, worker (registro do descarte), provisionamento (publicação, conflito terminal, ativação manual intacta), envio da abertura (descartado com ativação manual), ciclo de vida (sem renovação e sem desconexão com ativação manual), rotação de versões de credencial, bloqueio do documento no admin.
- Backend: `npx jest` 91 suítes / 629 testes; ESLint e `nest build` sem erros; `tsc`: os mesmos 12 erros antigos em specs.
- PostgreSQL em 36 migrations: `financial-activation-postgres`, `-candidates-`, `-validation-`, `-lifecycle-`, `payment-postgres`, `communications-postgres`, `backup-restore-postgres`: PASS.
- Frontend: `npx jest` 36 suítes / 132 testes; `tsc` sem erros.
- Não verificado: emissão real na Efí com a ponte `GatewayAccount` de uma conta manual (homologação, etapa 9). A emissão ainda usa o `GatewayAccount`; gravar o contexto na cobrança e usar a credencial da identidade é a etapa 6.
