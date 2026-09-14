# Task 6 report — cobrança, split e tarifas

## Status

Complete. Task 6 was recovered from the mixed uncommitted Task 6/7/8 worktree, reviewed, corrected, verified, and committed without discarding or staging the other tasks' work.

## Implemented behavior

- Added versioned global fees and company overrides for PIX, BOLETO, and BOLIX. Resolution is company override first, then global version; absent/invalid configuration fails closed.
- Fee components use integer cents/basis points and commercial half-up rounding per component. Quotes expose gross amount, combined `Taxa`, and estimated net only. Labels combine two percentages, two fixed components, or fixed plus percentage as required.
- Method enablement and issuance require a valid fee. Issuance is rejected when gross is not greater than the estimated Efí fee plus CifraMais fee.
- Every `PaymentCharge` snapshots the chosen fee version and calculated components. Later fee changes affect only new/replacement charges.
- PIX percentage split forwards the complete CifraMais percentage with `divisaoTarifa: assumir_total`; fixed PIX builds dynamic fixed values that add up to the gross amount. BOLETO/BOLIX use marketplace mode 1 so the Efí fee remains with the client account.
- Split configuration fails closed when the payee is missing or is the same as the client. BOLETO and BOLIX are distinguished only by whether the successful Efí banking-billet response contains the Pix payload; no unsupported request discriminator was invented.
- Invoice-to-charge reservation, settlement, refund, cancellation, and replacement use deterministic invoice-before-charge locking and tenant predicates. Provider identifiers are persisted before provider calls where the API permits it.
- Settlement is idempotent and monotonic, records effective Efí fee when supplied, freezes the effective CifraMais fee from the issuance snapshot, and creates an alert when divergence exceeds the greater of R$ 0.10 or 5% of the estimate.
- Refunds are provider-driven reflections only, apply only to the invoice's current charge, support partial/full events idempotently, and do not let an old replaced charge affect the invoice.
- Manual status cannot forge a paid invoice. Admin-only GET reconciliation is tenant-scoped, audited, queries only persisted provider identifiers, and persists terminal provider states only.
- Expired-charge replacement is manual and requires a new due date. It reserves under lock, cancels the old provider charge, snapshots the currently active fee, and fails the replacement reservation if the invoice changed concurrently.
- Invoice responses include safe financial summaries (gross, total fee, net, estimated/effective, charge status). Frontend components render the combined fee, financial summary, divergence alerts, and manual replacement confirmation.
- DRAFT invoices are not selected for explicit sends and queued initial jobs are consumed only after active financial onboarding; post-activation automatic processing may load DRAFT/PENDING without a broad automatic sweep.
- Added PostgreSQL integration coverage that applies all 28 migrations and exercises settlement/refund/replacement races and tenant isolation.

## RED → GREEN evidence

Recovered prior evidence:

- `.superpowers/sdd/efi-account-opening-plan/api-bolix-tests.log`: 2 failing suites / 2 failing tests (51 suites and 305 tests passing) when legacy BOLETO expectations hit the new PIX/BOLIX policy.
- `.superpowers/sdd/efi-account-opening-plan/api-current-types.log`: `payment-charge.service.ts(63,39) TS2532` before the optional dependency path was made type-safe.
- `.superpowers/sdd/efi-account-opening-plan/current-front-tests.log`: 3 failing suites / 3 failing tests (21 suites and 62 tests passing), including the old fee-label expectation.

RED → GREEN performed during this recovery:

- `npm test -- --runInBand src/payment/payment-charge.service.spec.ts`: new settlement assertion failed because `effectivePlatformFeeCents` was absent (1 failed, 15 passed). `recordSettlement` now freezes the effective platform fee from the charge snapshot; the suite passed 16/16.
- `npm test -- --runInBand src/payment/payment.service.spec.ts`: new replacement-race assertion expected `markFailed` once and received zero calls. The losing reservation is now marked failed before the conflict is returned; payment and charge suites then passed 24/24.
- `npm test -- --runInBand src/queue/workers/message.worker.payment.spec.ts`: mutation check removed the active-onboarding guard and restored PENDING-only loading; both new tests failed. Restoring the gate and source-aware DRAFT/PENDING predicate passed 2/2.
- The first PostgreSQL run exposed Docker not running and cleanup masking the original failure. The integration script now removes a container only after it was started. After Docker Desktop was available, the suite exposed a Prisma adapter deprecation caused by a relational reload inside an interactive transaction; moving the read after commit preserved atomic mutations and removed the warning.

## Verification

All commands were run from the Task 6 worktree on 2026-09-11.

Backend:

- `npm test -- --runInBand src/payment-fees/payment-fee.service.spec.ts src/payment/billing-method-policy.spec.ts src/payment/efi-boleto-mode.spec.ts src/payment/efi-split.spec.ts src/payment/payment-charge.service.spec.ts src/payment/payment-reconciliation.spec.ts src/payment/payment.controller.spec.ts src/payment/efi.service.spec.ts src/payment/payment.service.spec.ts src/invoices/invoices.service.spec.ts src/admin/admin.payment-policy.spec.ts src/queue/workers/message.worker.payment.spec.ts src/billing/billing.service.spec.ts` — PASS, 13 suites / 104 tests.
- `npm test -- --runInBand` — PASS, 58 suites / 334 tests.
- `npx prisma validate` — PASS.
- `npx tsc -p tsconfig.build.json --noEmit --incremental false` — PASS.
- changed-Task-6-file `npx eslint -- ...` — PASS, no findings.
- `npm run build` — PASS (Prisma Client generation and Nest production build).
- `node --trace-deprecation test/payment-postgres.cjs` — PASS: concurrent settlement and fee divergence; partial/full duplicate refunds; rollback and late settlement; replaced-charge ownership and cross-tenant rejection; payment/replacement race; current override snapshot; cancellation synchronization; all 28 migrations on PostgreSQL 16.

Frontend:

- `npx jest --runInBand src/lib/__tests__/billing-fees.test.ts src/components/features/__tests__/InvoiceTable.test.tsx src/components/features/__tests__/PaymentFeeAlerts.test.tsx src/components/features/__tests__/PaymentFeeConfirmation.test.tsx` — PASS, 4 suites / 10 tests.
- `npx jest --runInBand` — PASS, 27 suites / 69 tests.
- changed-Task-6-file `npx eslint -- ...` — PASS with one existing advisory warning from TanStack `useReactTable` in `InvoiceTable.tsx`; zero errors.
- `npx tsc --noEmit` — FAIL only in the explicitly shared Task 7 page:
  - `src/app/(dashboard)/cobrancas/page.tsx(339,32) TS2345`: `PaymentMethod` can be BOLETO but the Task 7 helper accepts only PIX/BOLIX.
  - `src/app/(dashboard)/cobrancas/page.tsx(340,62) TS2345`: `BillingMethod` can be BOLETO but the Task 7 helper accepts only PIX/BOLIX.
  The page was not modified or staged for Task 6.

Additional diagnostic: a deliberately broader backend lint target also included unchanged `src/payment/payment-link.service.ts` and reported its pre-existing `@typescript-eslint/no-unsafe-call` at line 204. The exact staged-file lint was clean.

## Commits and files

### `460d5e8 feat(payments): enforce fee-backed charge lifecycle`

- Migrations: `api-cobranca/prisma/migrations/20260910120000_payment_issuance_guards/migration.sql`, `20260911180000_bolix_default/migration.sql`.
- Admin/billing/invoice integration: `src/admin/admin.payment-policy.spec.ts`, `src/admin/admin.service.ts`, `src/admin/dto/admin-client.dto.ts`, `src/billing/billing.service.ts`, `src/billing/dto/update-billing-settings.dto.ts`, `src/invoices/dto/invoice.dto.ts`, `src/invoices/invoices.service.ts`, `src/invoices/invoices.service.spec.ts`.
- Fee domain: every file committed under `src/payment-fees/` changed by Task 6.
- Payment domain: `src/payment/billing-method-policy{.ts,.spec.ts}`, `dto/payment.dto.ts`, `efi-boleto-mode{.ts,.spec.ts}`, `efi-gateway.client.ts`, `efi-split.spec.ts`, `efi.service{.ts,.spec.ts}`, `payment-admin.controller.ts`, `payment-charge.service{.ts,.spec.ts}`, `payment-reconciliation.spec.ts`, `payment.controller{.ts,.spec.ts}`, `payment.module.ts`, `payment.service{.ts,.spec.ts}`.
- Issuance fence and integration: `src/queue/workers/message.worker.ts`, `src/queue/workers/message.worker.payment.spec.ts`, `test/payment-postgres.cjs`.

### `66af393 chore(prisma): align payment and template schema`

- `api-cobranca/prisma/schema.prisma` only. This intentionally contains the Task 6 defaults/relations plus canonical parity for the already committed global-template migration, as requested.

### `2a654df feat(frontend): surface payment fee summaries`

- `front-cobranca/src/components/features/InvoiceTable.tsx`
- `front-cobranca/src/components/features/UploadCSV.tsx`
- `front-cobranca/src/components/features/PaymentFeeAlerts.tsx`
- `front-cobranca/src/components/features/PaymentFeeConfirmation.tsx`
- Their three component tests plus `src/lib/billing-fees.ts` and `src/lib/__tests__/billing-fees.test.ts`.

## Intentionally uncommitted shared dependencies

- `front-cobranca/src/lib/api-client.ts` and `front-cobranca/src/app/(dashboard)/cobrancas/page.tsx` remain uncommitted for Task 7 integration exactly as directed. The Task 6 frontend components consume the shared `InvoicePaymentSummary` and `PaymentFeeQuote` types currently present in that working-tree dependency.
- Remaining unstaged portions of `api-cobranca/src/admin/admin.service.ts`, `src/billing/billing.service.ts`, and `src/queue/workers/message.worker.ts` are Task 7/8 central-channel, onboarding, and global-template integration; Task 6 hunks alone were committed.
- Communications, onboarding UI, Docker/infra, environment/dependency rearrangement, unrelated admin UI, payment notifications, webhooks, WhatsApp, and other Task 7/8 files remain intact and uncommitted.

## Self-review and concerns

- Tenant ownership is checked at controller/service boundaries and again in mutation predicates; provider reconciliation/refund paths do not accept arbitrary external identifiers.
- Invoice-before-charge lock order is consistent across settlement, cancellation, refund, and replacement. The PostgreSQL race tests cover the highest-risk transitions.
- Fee snapshots are immutable in normal service paths and protected by existing database triggers. Monetary calculations avoid floating-point arithmetic.
- No live Efí homologation call was made. Provider account settings (especially Boleto versus Bolix response shape, marketplace mode, payee code, and fixed PIX split) still require homologation with real sandbox/account credentials.
- The frontend Task 6 commit is intentionally dependent on the uncommitted shared Task 7 `api-client.ts`; do not cherry-pick it alone without that integration.
- No Task 7/8 changes were reset, discarded, or staged.
