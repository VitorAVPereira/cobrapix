# Task 2 report — schema and fee domain

## Delivered domain

- `Company.tradeName` and `InvoiceStatus.DRAFT` were added without removing legacy fields.
- `EfiOnboarding` is unique per company and stores the state machine, provider request/idempotency IDs, separate notice/submission/provisioning/reminder counters, retry and reminder timing, refusal/activation/disconnection timestamps, sanitized errors, consent text versions and draft revision, actor/IP, submitted CNPJ snapshot, non-secret provisioning checkpoint, encrypted representative fields, key version and sensitive-data expiry/deletion timestamps.
- Pending onboarding encrypted fields are `representativeNameEncrypted`, `representativeCpfEncrypted`, `representativeBirthDateEncrypted`, `representativeMotherNameEncrypted`, `representativeEmailEncrypted`, and `representativePhoneEncrypted`. Their envelope key is recorded in `sensitiveDataKeyVersion`.
- `GatewayAccount` now has `credentialKeyVersion` (string, default `legacy`), certificate expiry/fingerprint, health, last validation and consecutive failure count.
- `PaymentFeeVersion` supports a `GLOBAL` scope or a company override for each `PIX`, `BOLETO`, and `BOLIX` method. Both Efí and platform components use typed `FIXED`/`PERCENTAGE` columns. SQL checks enforce the discriminants, integer ranges represented by PostgreSQL `INTEGER`, version/range validity, and scope consistency. Update and delete triggers make versions immutable.
- `PaymentCharge` allows multiple emissions per invoice, self-links replacements, keeps provider identifiers and artifacts, records estimated/effective fee amounts and an immutable fee JSON snapshot, and points to its fee version. `PaymentChargeStatusHistory` preserves lifecycle transitions.
- `PlatformIntegrationState` stores enable/pause and sanitized health information for Meta, Resend, Efí onboarding and Efí payments; it has no secret columns.
- `CommunicationConversation` and `CommunicationMessage` provide an additive global conversation path keyed by channel plus recipient hash. Messages carry optional company/invoice/debtor context, and both records carry retention/anonymization metadata. Existing tenant communication tables remain unchanged. `AuditLog.retentionExpiresAt` supports the five-year retention job.

## Domain interface

`payment-fee.types.ts` exports `FixedPaymentFeeComponent`, `PercentagePaymentFeeComponent`, their `PaymentFeeComponent` discriminated union, and the runtime type guard `validatePaymentFeeComponent(value)`. Fixed amounts accept safe non-negative integer cents. Percentages accept integer basis points from 0 through 10,000. Mixed or incomplete discriminants are rejected.

## TDD and verification

- RED: `npm test -- --runInBand src/payment-fees/payment-fee.types.spec.ts` failed because `payment-fee.types` did not exist.
- GREEN: the same command passed 16 tests after the minimal type guard implementation.
- Prisma: `npx prisma format`, `npx prisma validate`, and `npm run prisma:generate` passed.
- Offline diff: `npx prisma migrate diff --from-schema=C:/micro-saas/api-cobranca/prisma/schema.prisma --to-schema=prisma/schema.prisma` reported only the intended additive enums, tables, fields, indexes and foreign keys. The generated migration was augmented with SQL checks and append-only triggers.
- Full API tests: 32 suites and 185 tests passed.
- Focused ESLint initially reported one Prettier layout issue; it was corrected before final verification.
- API build initially reached TypeScript and failed in concurrently edited `payment-key-rotation.ts` on two `string | undefined` arguments. That file is outside Task 2 ownership. After its owning agent corrected it, `npm run build` passed.

## Migration and operational limitations

- Migration `20260909120000_add_efi_onboarding_domain` was generated with an offline schema-to-schema diff. It was not applied to any database.
- Data expiry/anonymization and status-history insertion are schema capabilities; scheduled cleanup and workflow services are later tasks.
- Existing Meta/Resend credentials, legacy invoice gateway columns, and split percentage fields remain for cutover compatibility. Their removal belongs to the later destructive migration.

## Commits

- `1349a2e feat: add Efi onboarding payment domain schema`
- The report itself is committed separately so it can name the functional commit exactly.
