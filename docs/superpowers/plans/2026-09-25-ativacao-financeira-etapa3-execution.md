# Execução da etapa 3 — credenciais, identidade e configuração candidata

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, etapa 3, Fase A. Registro anterior: `2026-09-25-ativacao-financeira-etapa2-execution.md`.

## Decisões

- Ruling (responsável): padrão de 30 dias aceitando pagamento após o vencimento (migration `20260925180000_payment_days_after_due_default`, commit próprio).
- Ruling: na Fase A só se cria candidata `MANUAL_ADMIN + CUSTOMER_ACCOUNT + DIRECT_TO_CUSTOMER`. Os modos da conta CifraMais respondem 422 `FINANCIAL_MODE_NOT_AVAILABLE`; o registro da conta central a partir do env fica para a Fase B, pois a conta do cliente não usa credenciais da plataforma (a comissão continua indo para `EFI_PLATFORM_ACCOUNT_NUMBER`/`PAYEE_CODE`).
- Ruling: titularidade exige três coisas: documento do titular informado no upload igual ao CNPJ/CPF da empresa, atestação do administrador com o mesmo documento e referência da evidência. Certificado válido não prova titularidade. Trocar de conta na candidata anula a atestação; reenviar credenciais da mesma conta a mantém.
- Ruling: a autorização registrada é `ACCOUNT_INTEGRATION_AUTHORIZATION` com referência externa (contrato/documento) e validade opcional; não é um aceite de texto no sistema.
- Ruling: candidatas sem alteração por **7 dias** expiram (cron diário 03:20) e suas credenciais candidatas são apagadas (colunas zeradas, status `REJECTED`); fingerprint, validade e auditoria permanecem. Proposta de prazo; ajustável.
- Ruling: o certificado chega por multipart no campo `certificate`, em memória (sem `dest`/`storage`), limite de 1 MiB, 1 arquivo, 10 campos de até 1 KiB. O conteúdo é validado como PKCS#12 com chave privada correspondente e dentro da validade; extensão e tipo MIME são ignorados; nenhum caminho de arquivo é aceito. O buffer recebido é zerado após a inspeção (strings JavaScript derivadas não podem ser apagadas).
- Ruling: Nginx já aceita 3 MiB globalmente (`infra/interserver/nginx.conf`); nenhuma alteração de proxy foi necessária para 1 MiB.
- Ruling: rota de rotação `POST /admin/efi-accounts/:id/credential-rotations` fica para a etapa 5 (renovação administrativa), que precisa da validação da etapa 4 antes de trocar a credencial ativa. O método `EfiAccountRegistryService.addCredentialVersion` já mantém a identidade.

## Rotas (JwtAuthGuard + PlatformAdminGuard, IDs UUID)

| Rota | Efeito |
| --- | --- |
| `GET /admin/companies/:companyId/financial-profile` | Perfil ativo e candidata aberta, mascarados |
| `POST /admin/companies/:companyId/financial-activations` | Cria candidata; `idempotencyKey` UUID; repetição idêntica devolve a mesma, divergente → 409 |
| `GET /admin/financial-activations/:id` | Estado da candidata |
| `PUT /admin/financial-activations/:id/configuration` | Métodos, autorização, atestação de titularidade; exige `expectedRevision` |
| `PUT /admin/financial-activations/:id/credentials` | Multipart: `.p12`, senha, `clientId`/`clientSecret`, titular, conta, dígito, `payeeCode`, chave Pix; exige `expectedRevision` |
| `POST /admin/financial-activations/:id/cancel` | Cancela e apaga a credencial candidata |

Toda edição incrementa a revisão, volta a candidata para `DRAFT` e anula `validatedAt`/`validationHash`. Revisão antiga → 409 `REVISION_CONFLICT`. Respostas nunca carregam campos criptografados (as consultas nem os selecionam); conta, documento, `payeeCode` e chave Pix aparecem mascarados (`••••1234`). Cada mutação grava `AuditLog` sem segredos.

## Entregas

- `src/financial-activation/`: `financial-activation.module.ts`, `.controller.ts`, `.service.ts`, `.dto.ts`, `efi-account-registry.service.ts` e `financial-activation.controller.spec.ts`; módulo registrado em `app.module.ts`.
- `test/financial-activation-candidates-postgres.cjs`: serviço real contra PostgreSQL 16 descartável, com certificados `.p12` gerados no teste.

## Verificação

- `financial-activation.controller.spec.ts` (11): 401 sem sessão e 403 para `COMPANY_ADMIN` em todas as rotas, UUID inválido, campos desconhecidos e métodos inválidos, multipart com conversão de revisão, 413 acima de 1 MiB, 400 para dois arquivos ou campo extra (`certificatePath`).
- `financial-activation-candidates-postgres.cjs` (10 cenários): criação só da Fase A, idempotente e única; certificados inválido, expirado, senha errada, grande e titular de outra empresa recusados; segredos cifrados em repouso e ausentes de respostas, auditoria e linhas do perfil; revisão antiga e edição concorrente; reenvio com rotação e reset de titularidade; rotação mantém identidade; conta de uma empresa não é tomada por outra; cancelamento e expiração apagam segredos; preparar não ativa, não emite e não altera o `GatewayAccount` existente.
- `npx jest`: 87 suítes / 594 testes. `npx eslint src` e `nest build` sem erros. `tsc --noEmit`: os mesmos 12 erros antigos em specs.
- `financial-activation-postgres.cjs` e `payment-postgres.cjs`: PASS em 35 migrations.
- Não verificado: chamadas à Efí (nenhuma nesta etapa) e a tela administrativa (etapa 8).
