# Task 3c — central communications

## Delivered contracts

- `WhatsappService.sendTemplateMessage` preserves the onboarding-compatible input and adds optional `invoiceId`, `debtorId`, and `content`. It returns `{ messageId, status }` and uses `META_PHONE_NUMBER_ID` plus `META_ACCESS_TOKEN` from server configuration.
- WhatsApp and email sends upsert one global `CommunicationConversation` by `(channel, recipientHash)` and an idempotent `CommunicationMessage` by unique `externalMessageId`. Outbound records retain optional company, invoice, and debtor business context.
- Email sends use server `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `RESEND_REPLY_TO`; the Resend adapter accepts optional `replyTo` and `idempotencyKey`.
- Meta webhook traffic is accepted only for server `META_PHONE_NUMBER_ID`; status events correlate globally by `externalMessageId`, and inbound events create global conversations/messages without tenant attribution.
- Tenant endpoint: `GET /communications/outbound`, paginated and always scoped to authenticated `companyId` plus `OUTBOUND` direction.
- Administrator endpoints (JWT plus `PlatformAdminGuard`): `GET /communications/admin/conversations`, `GET /communications/admin/conversations/:id`, and `PATCH /communications/admin/conversations/:id/status`.
- Legacy customer inbox routes require `PlatformAdminGuard`. Tenant Meta configure/disconnect writes fail closed; status output is derived from server configuration and does not expose provider identifiers or secrets.
- Provider template creation/synchronization and Resend template creation/publishing/deletion now require platform administrator access. Approved catalog slugs remain defined by `template-catalog.ts` and `email-template-catalog.ts` while legacy tenant rows remain for cutover compatibility.
- Message worker passes invoice/debtor context into the central WhatsApp record and no longer logs debtor names or phone numbers in the changed send path.

## Verification

- Focused communications tests: 7 suites / 42 tests passed.
- Full API suite passed at the Task 3 checkpoint: 41 suites / 248 tests. A later fresh run after concurrent Task 4 files appeared passed 42 suites / 251 tests and failed only 4 new `onboarding-provisioner.spec.ts` assertions outside Task 3 ownership.
- Focused ESLint for all changed TypeScript files passed with no findings.
- Production TypeScript compilation reached only a concurrent Task 4 error in `src/efi-onboarding/onboarding-maintenance.ts:49`; Task 3 files produced no compiler errors. The parent agent owns and is actively changing that file.

## Commits

- `764bda6 feat: centralize outbound communication channels`

## Integration and limitations

- `CommunicationsModule` must be imported by the parent in `AppModule`; Task 3c was explicitly prohibited from editing `app.module.ts`.
- The additive Task 2 schema names used are `CommunicationConversation` and `CommunicationMessage`; no additional schema migration was required.
- Legacy per-company secret columns and tenant template rows remain in the database for cutover compatibility. Runtime delivery no longer reads tenant Meta/Resend secrets.
- Existing catalog customization is still stored in legacy tenant template rows. Route guards prevent customer provider-template creation, but a later UI/domain refinement is needed if greeting, instructions, and signature must become separately typed fields rather than validated catalog content.
- No provider or configured database calls were executed.
