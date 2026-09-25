# Execução da etapa 2 — schema, migration e contexto de cobrança

Plano: `2026-09-24-ativacao-financeira-administrativa.md`, etapa 2, Fase A (seção 8.6). Registro anterior: `2026-09-25-ativacao-financeira-etapa1-execution.md`.

## Decisões

- Ruling (responsável): multa somente percentual. Pix CobV usará `valor.multa` modalidade 2; boleto/BOLIX usará `fine`. Não há coluna para multa fixa.
- Ruling: a Fase A cria `EfiAccountIdentity`, `EfiCredentialVersion`, `FinancialProfileVersion`, `FinancialValidationAttempt`, o ponteiro `Company.activeFinancialProfileId` e o contexto em `PaymentCharge`. Enums e restrições já aceitam os três modos. `FinancialRecipientVersion`, `FinancialSettlement`, `SettlementEntry` e `PayoutBatch`/`PayoutItem` ficam para a Fase B, em migrations aditivas.
- Ruling: sem backfill com escrita. Produção só tem dados de teste (seção 8.1); `report-financial-profiles.ts` apenas diagnostica. Cobrança antiga nunca recebe contexto depois de criada (trigger).
- Ruling: `onTimeSplitPercentageBps`/`overdueSplitPercentageBps` removidos do schema, DTO, serviço e testes; `ensureValidSplitPercentage` (sem uso) removido. Payload antigo com esses campos continua recebendo 400, agora pelo `ValidationPipe` (`forbidNonWhitelisted`).
- Ruling: `efiTxid`/`efiChargeId`/`gatewayId` continuam únicos globalmente. Colisão entre contas ou ambientes falharia na gravação em vez de atribuir errado; revisar na etapa 6, com o contexto de emissão já gravado.
- Ruling: o ponteiro da empresa é FK simples. Uma FK composta `(activeFinancialProfileId, id)` fazia o Prisma deixar de gerar o `id` de `Company` e quebrava toda criação de empresa; o isolamento por empresa ficou no trigger adiado de consistência.
- Ruling: padrões iniciais de multa/juros/dias após vencimento = 0 em empresa, fatura e recorrência, preservando o comportamento atual até as etapas de emissão e telas.

## Modelo

| Tabela | Papel | Garantias no banco |
| --- | --- | --- |
| `EfiAccountIdentity` | Conta Efí + ambiente; `PLATFORM` (compartilhada) ou `COMPANY` | titularidade coerente com `companyId`; documento 11/14 dígitos; única por ambiente+conta; uma `PLATFORM` por ambiente; ownership/empresa/ambiente/documento/conta imutáveis |
| `EfiCredentialVersion` | Credenciais e certificado criptografados, versionados por identidade | uma `ACTIVE` por identidade; identidade, versão, fingerprint (SHA-256 `AA:BB:…`) e validade imutáveis; blobs podem ser recriptografados |
| `FinancialProfileVersion` | Configuração versionada por empresa; candidata editada por `revision` | combinação de modos, origem e tipo de autorização; métodos ⊆ {PIX, BOLIX}; READY/ACTIVE exigem emissor, credencial, titularidade, autorização e validação; uma ACTIVE e uma candidata aberta por empresa; emissor coerente com o modo e o ambiente; publicado imutável (só ACTIVE → SUPERSEDED) e não removível |
| `Company.activeFinancialProfileId` | Perfil publicado | trigger adiado no commit: ponteiro = perfil ACTIVE da própria empresa, ou ambos nulos |
| `FinancialValidationAttempt` | Trabalho durável de validação (etapa 4) | FK composta perfil+empresa; contadores ≥ 0; sem segredos |
| `PaymentCharge` (novas colunas) | Perfil, identidade, credencial, modos, ambiente, distribuição, multa/juros/dias | contexto tudo-ou-nada; só na criação, a partir de perfil ACTIVE da mesma empresa e com meio habilitado; credencial da mesma identidade; contexto e termos imutáveis |
| `GatewayAccount.efiAccountIdentityId` | Ponte temporária com o fluxo atual | FK composta com `companyId`: nunca aponta para a identidade central nem para outra empresa |
| `Company`/`Invoice`/`RecurringInvoice` | `defaultLate*`/`late*`, `…PaymentDaysAfterDue` | multa 0–1000 bp (até 10%, limite Efí), juros 0–10000 bp ao mês, dias ≥ 0 |

A transação de ativação (etapa 4) segue o padrão testado: marcar a ACTIVE anterior como SUPERSEDED, promover a candidata com compare-and-set em `status = 'READY' AND revision = $n` e mover o ponteiro. Qualquer falha antes do commit desfaz tudo.

## Entregas

- `api-cobranca/prisma/schema.prisma` e `prisma/migrations/20260925120000_financial_activation_profiles/migration.sql` (SQL gerado por `prisma migrate diff` + CHECKs, índices parciais e triggers).
- `src/financial-activation/financial-profile-report.ts` (+ spec) e `src/scripts/report-financial-profiles.ts`: relatório somente leitura (empresas com perfil, abertura ACTIVE sem perfil, `GatewayAccount` sem identidade, cobranças sem contexto por status).
- `test/financial-activation-postgres.cjs`: 14 cenários em PostgreSQL 16 descartável.
- Remoção dos campos de split não usados (`admin.service.ts`, `admin-client.dto.ts`, `efi.service.ts`, spec).

## Verificação

- `node test/financial-activation-postgres.cjs`: PASS em 34 migrations — combinações inválidas, emissor por modo, prontidão, rollback de ativação parcial, ativação concorrente única, uma ACTIVE por empresa, imutabilidade do publicado, contexto de cobrança (empresa, coerência, completude, imutabilidade, anexação tardia), histórico após troca de perfil, ponteiro entre empresas, identidade, `GatewayAccount` sem identidade central, limites de multa/juros e relatório somente leitura e idempotente.
- `prisma migrate diff` (migrations → schema) vazio: sem divergência.
- Regressões PostgreSQL em 34 migrations: `payment-postgres.cjs`, `communications-postgres.cjs` (que executa os módulos `datafy-webhook`, `outbound-dispatch`, `tenant-conversations` e `communication-media`) e `backup-restore-postgres.cjs`: PASS.
- `npx jest`: 86 suítes / 583 testes. `npx eslint src` sem erros. `nest build` sem erros. `tsc --noEmit`: os mesmos 12 erros antigos em specs, antes e depois.

## Pendências

- Padrão de “dias aceitando pagamento após o vencimento” para novas empresas (hoje 0, igual ao comportamento atual). Decidir antes da etapa de emissão.
- Unidade de `interest` mensal no boleto e comportamento do Pix do BOLIX após vencimento: homologação.
