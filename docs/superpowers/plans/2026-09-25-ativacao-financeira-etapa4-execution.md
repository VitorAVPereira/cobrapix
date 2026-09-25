# Execução da etapa 4 — validação e ativação independentes da abertura

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, etapa 4, Fase A. Registro anterior: `2026-09-25-ativacao-financeira-etapa3-execution.md`.

## Decisões

- Ruling (responsável): candidatas abandonadas expiram em 7 dias (mantido).
- Ruling: `EFI_OPENING_ENABLED` (padrão `true`, preserva as instalações atuais). Com `false`: `EFI_OPENING_*` deixam de ser obrigatórias em produção; o cliente de abertura não autentica (`EFI_OPENING_DISABLED`, não retentável); o worker conclui jobs sem executá-los e sem alterar `EfiOnboarding`; os crons de recuperação e de renovação de certificado pela abertura não rodam; webhook de abertura, envio da empresa, liberação da abertura, reenvio e recuperação administrativa respondem 503 `EFI_OPENING_DISABLED`.
- Ruling: liberação separada `PlatformIntegration.FINANCIAL_MANUAL_ACTIVATION` (migration `20260926090000_financial_manual_activation_switch`), desligada por padrão. Bloqueia apenas novas validações e ativações manuais; empresas já ativas continuam emitindo. Pausar a abertura não a afeta; pausar `EFI_PAYMENTS` bloqueia emissão em todos os modos.
- Ruling: chave Pix informada pelo administrador; a validação não cria chave (sem risco de EVP duplicada). Criação autorizada fica para quando houver necessidade.
- Ruling: BOLIX não tem como ser comprovado sem emitir cobrança pagável: `BOLIX_ISSUANCE` e, com remuneração, `BOLIX_SPLIT` ficam `NOT_VERIFIABLE`. A ativação exige `acknowledgeUnverifiedSteps: true`; a auditoria registra quais passos foram aceitos assim. Homologação real continua obrigatória (etapa 9).
- Ruling: validação vale 15 minutos e está presa a um hash de tudo o que foi validado (perfil/revisão, documento da empresa, modos, ambiente, métodos, conta, `payeeCode`, chave Pix, versão/fingerprint da credencial, versões de tarifa por método, recebedor da plataforma e URLs de webhook). Qualquer diferença na confirmação → 409 `VALIDATION_STALE`.
- Ruling: `GatewayAccount` é atualizado na mesma transação da ativação como ponte para o fluxo de emissão atual, com os mesmos textos cifrados da credencial e `efiAccountIdentityId`. Nenhum `EfiOnboarding` é criado. Os gates existentes ainda leem `EfiOnboarding.ACTIVE`; a troca para `FinancialEligibilityService` é a etapa 5, então uma empresa ativada manualmente ainda não emite até lá.
- Ruling: pedido de abertura em andamento (`NOTICE_PENDING`, `AWAITING_REPRESENTATIVE`, `EFI_PROCESSING`, `SUBMISSION_UNCERTAIN`, `PROVISIONING`) bloqueia a ativação manual com 409 `OPENING_RECONCILIATION_REQUIRED`; a conciliação explícita é da etapa 5.
- Ruling: confirmações booleanas (`confirmEffects`, `acknowledgeUnverifiedSteps`, `enabled`) leem o valor bruto. O `ValidationPipe` global usa `enableImplicitConversion`, que transformava a string `"false"` em `true`.

## Validação durável

`POST /admin/financial-activations/:id/validate` (202) confere pré-requisitos locais (conta, credencial, titularidade, autorização, chave Pix se PIX), grava `FinancialValidationAttempt` (`PENDING`), passa o perfil a `VALIDATING` e enfileira `{ attemptId }` na fila `financial-validation`. Chave de idempotência obrigatória; revisão antiga → 409.

Execução (`runAttempt`, chamada pelo worker e pela rotina de recuperação): claim com lease de 5 min por compare-and-set; perfil editado ou credencial trocada cancela (`PROFILE_CHANGED`) sem chamar a Efí; cada passo é gravado como checkpoint; o material decifrado existe só em memória; falha temporária (sem resposta da Efí) volta a `PENDING` com espera 1 min·2ⁿ, até 3 execuções; recusa da Efí (`invalid_client` etc.) falha na hora. Sucesso promove o perfil a `READY` com o hash, na mesma transação que conclui a tentativa. `recoverDueAttempts` (cron por minuto) executa tentativas vencidas ou com lease expirado, cobrindo perda do Redis.

| Passo | Quando | Natureza |
| --- | --- | --- |
| `CERTIFICATE` | sempre | local; validade mínima de 1 dia e decifra |
| `FEE_VERSIONS` | sempre | local; tarifa vigente por método |
| `PLATFORM_RECIPIENT` | há remuneração | local; `EFI_PLATFORM_*` presentes e diferentes da conta do cliente |
| `PIX_AUTH` | PIX | leitura `pixListDueCharges` |
| `PIX_WEBHOOK` | PIX | **altera** webhook da chave e confere pela leitura |
| `PIX_SPLIT` | PIX com remuneração | **altera** configuração de split de validação com id estável por conta |
| `CHARGES_AUTH` | BOLIX | leitura `listPlans` |
| `CHARGES_WEBHOOK_URL` | BOLIX | local |
| `BOLIX_ISSUANCE`, `BOLIX_SPLIT` | BOLIX | `NOT_VERIFIABLE` |

## Ativação

`POST /admin/financial-activations/:id/activate` com `expectedRevision`, `validationAttemptId`, `idempotencyKey`, `confirmEffects: true` e, se houver, `acknowledgeUnverifiedSteps: true`. Em uma transação, com bloqueio empresa → perfil: confere liberação, estado `READY`, revisão, tentativa bem-sucedida da mesma revisão e dentro do prazo, hash recalculado, autorização vigente e ausência de abertura em andamento; marca a versão anterior `SUPERSEDED`, aposenta a credencial ativa anterior da mesma conta, ativa a nova, publica o perfil (compare-and-set), move o ponteiro, atualiza a ponte `GatewayAccount` e audita. Repetição com a mesma chave devolve o mesmo resultado sem nova auditoria.

`FinancialEligibilityService.resolveIssuance(companyId, método)` devolve o contexto da cobrança (perfil, identidade, credencial ativa, modos, ambiente) ou recusa: empresa inativa, sem perfil ativo, método não habilitado, pagamentos pausados, identidade indisponível, sem credencial ativa ou certificado vencido.

## Entregas

- `src/financial-activation/`: `financial-validation.service.ts`, `.types.ts`, `.jobs.ts`, `.worker.ts`, `financial-eligibility.service.ts`; `activate` e `setManualActivationReleased` em `financial-activation.service.ts`; rotas `validate`, `activate` e `PUT /admin/integrations/financial-manual-activation`; `financial-activation.boundaries.spec.ts` (nenhum arquivo do módulo importa a abertura).
- `src/payment/efi-gateway.client.ts`: `operations(material)` com instâncias separadas do SDK para Pix e Cobranças.
- `src/efi-onboarding/efi-opening-capability.ts` e os pontos de bloqueio acima; `src/config/env.validation.ts`, `.env.example`, `infra/interserver/api.env.example`.
- Frontend: toggle "Ativação financeira manual" no painel de integrações; o toggle da abertura passou a se chamar "Abertura de contas Efí".
- Testes: `efi-opening-capability.spec.ts`, casos novos em `env.validation.spec.ts` e `financial-activation.controller.spec.ts`, e `test/financial-activation-validation-postgres.cjs`.

## Verificação

- `financial-activation-validation-postgres.cjs` (12 cenários, Efí simulada e `EfiOpeningClient` com todos os métodos substituídos por falha contada): liberação própria; pré-requisitos antes de qualquer chamada; pedido durável e idempotente com job só com id; execução única sob concorrência, passos por método e efeitos declarados; ativação atômica, idempotente, com ciência exigida e sem `EfiOnboarding` fabricado; elegibilidade pelo perfil ativo; validação expirada e tarifa alterada → `VALIDATION_STALE`; edição durante a validação cancela sem chamar a Efí; falha temporária com espera e desistência, recusa de credencial imediata; recuperação sem Redis com o id original; nenhum segredo em tentativas, auditoria ou jobs; **zero chamadas ao cliente de abertura**.
- `npx jest`: 89 suítes / 606 testes. `npx eslint src` e `nest build` sem erros. `tsc --noEmit`: os mesmos 12 erros antigos em specs.
- PostgreSQL em 36 migrations: `financial-activation-postgres`, `financial-activation-candidates-postgres`, `payment-postgres`, `communications-postgres` e `backup-restore-postgres`: PASS.
- Aviso `pg` de consultas simultâneas vem do interpretador do Prisma ao carregar relações de um `include` dentro de transação interativa; não é código do módulo.
- Não verificado: chamadas reais à Efí (homologação na etapa 9).

## Achado fora do escopo

`EnabledDto` em `src/efi-onboarding/onboarding-admin.controller.ts` (toggles `efi-onboarding`, `efi-payments`, `meta`, `resend`) tem o mesmo problema de conversão implícita: `{"enabled": "false"}` liga a integração. A tela envia booleano e não é afetada; chamadas diretas à API são. Não corrigido nesta etapa.
