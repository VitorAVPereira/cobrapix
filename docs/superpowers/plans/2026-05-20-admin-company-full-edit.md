# Admin Company Full Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `PLATFORM_ADMIN` edit complete company settings from the admin clients screen, with a confirmation modal listing changed fields before save.

**Architecture:** Extend the existing `api-cobranca/src/admin` module instead of adding a parallel API. Reuse the current admin clients page, adding edit mode, safe full client snapshots, and a local confirmation diff. Secrets are write-only after save: the API returns presence flags, and the UI only shows newly typed secret values in the confirmation modal.

**Tech Stack:** NestJS, Prisma, class-validator, Next.js App Router, React client components, TailwindCSS, Jest, Testing Library.

---

### Task 1: Backend Admin Contract And Tests

**Files:**
- Modify: `api-cobranca/src/admin/dto/admin-client.dto.ts`
- Modify: `api-cobranca/src/admin/admin.service.spec.ts`
- Modify: `api-cobranca/src/admin/admin.service.ts`

- [ ] **Step 1: Write failing backend tests**

Add tests in `api-cobranca/src/admin/admin.service.spec.ts` that call `updateClient('company-1', payload)` with changed company, billing, notifications, WhatsApp, integration and Efi fields. Assert:

```ts
expect(companyUpdate).toHaveBeenCalledWith(expect.objectContaining({
  where: { id: 'company-1' },
  data: expect.objectContaining({
    corporateName: 'Empresa Editada',
    gatewayStatus: 'ACTIVE',
    paymentNotificationEmails: ['financeiro@editada.com'],
    resendFromEmail: 'cobranca@editada.com',
  }),
}));
expect(upsertManualGatewayAccount).toHaveBeenCalledWith(
  'company-1',
  expect.objectContaining({ efiClientSecret: 'new-efi-secret' }),
);
expect(JSON.stringify(result)).not.toContain('new-efi-secret');
```

Add a second test where secrets are omitted, asserting `upsertManualGatewayAccount` is not called for an empty Efi secret-only update and response flags still show existing secret presence.

- [ ] **Step 2: Verify backend tests fail**

Run:

```bash
cd api-cobranca && npm test -- admin.service.spec.ts --runInBand
```

Expected: FAIL because the current DTO/service does not accept the full update payload or return presence flags.

- [ ] **Step 3: Implement backend DTOs and response mapping**

Extend `UpdateAdminClientDto` with typed optional sections:

```ts
company?: AdminCompanyUpdateDto;
billing?: AdminBillingUpdateDto;
notifications?: AdminNotificationsDto;
whatsapp?: AdminWhatsappUpdateDto;
integrations?: AdminIntegrationsDto;
efi?: AdminEfiUpdateDto;
```

Extend `AdminClientResponse` so it includes non-secret company fields, Meta fields, notification fields, Efi non-secret fields, and boolean secret flags.

- [ ] **Step 4: Implement backend persistence**

Update `AdminService.updateClient` so it:

```ts
await this.prisma.company.update({ where: { id }, data: companyData });
if (dto.efi && this.hasEfiMutation(dto.efi)) {
  await this.efiService.upsertManualGatewayAccount(id, efiPayload);
}
return this.getClient(id);
```

Use helpers for normalization, decimal/nullable values, secret hashing/encryption decisions, and Efi payload construction.

- [ ] **Step 5: Verify backend tests pass**

Run:

```bash
cd api-cobranca && npm test -- admin.service.spec.ts --runInBand
```

Expected: PASS.

### Task 2: API Client Contract And Tests

**Files:**
- Modify: `front-cobranca/src/lib/api-client.ts`
- Modify: `front-cobranca/src/lib/__tests__/api-client-admin.test.ts`

- [ ] **Step 1: Write failing api-client test**

Add a test:

```ts
await apiClient.updateAdminClient('company-1', {
  company: { corporateName: 'Empresa Editada' },
  efi: { efiCertificateBase64: 'Y2VydA==', efiCertificatePath: '/tmp/old.p12' },
});
expect(mockFetch).toHaveBeenCalledWith(
  'http://api.test/admin/clients/company-1',
  expect.objectContaining({ method: 'PUT' }),
);
```

Assert the JSON body has `efiCertificatePath: ''` when base64 is present.

- [ ] **Step 2: Verify api-client test fails**

Run:

```bash
cd front-cobranca && npx jest src/lib/__tests__/api-client-admin.test.ts --runInBand
```

Expected: FAIL because `updateAdminClient` does not exist.

- [ ] **Step 3: Implement api-client types and method**

Add `UpdateAdminClientInput`, extend `AdminClient`, reuse certificate normalization, and add:

```ts
async updateAdminClient(clientId: string, data: UpdateAdminClientInput): Promise<AdminClient> {
  return this.fetch<AdminClient>(`/admin/clients/${clientId}`, {
    method: 'PUT',
    body: JSON.stringify(normalizeUpdateAdminClientPayload(data)),
  });
}
```

- [ ] **Step 4: Verify api-client test passes**

Run:

```bash
cd front-cobranca && npx jest src/lib/__tests__/api-client-admin.test.ts --runInBand
```

Expected: PASS.

### Task 3: Admin UI Edit Mode, Confirmation Modal, And Tests

**Files:**
- Modify: `front-cobranca/src/app/(dashboard)/admin/clientes/page.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/admin/clientes/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests that:

```ts
await user.click(screen.getByRole('button', { name: /editar empresa certificada/i }));
await user.clear(screen.getByLabelText('Razao social'));
await user.type(screen.getByLabelText('Razao social'), 'Empresa Editada');
await user.type(screen.getByLabelText('Meta token'), 'novo-token-meta-com-mais-de-quarenta-caracteres');
await user.click(screen.getByRole('button', { name: /salvar alteracoes/i }));
expect(await screen.findByText('Confirmar alteracoes')).toBeInTheDocument();
expect(screen.getByText('Empresa Editada')).toBeInTheDocument();
expect(screen.getByText('novo-token-meta-com-mais-de-quarenta-caracteres')).toBeInTheDocument();
```

Then click confirm and assert `mockUpdateAdminClient` is called. Add a cancel test asserting the API is not called.

- [ ] **Step 2: Verify UI tests fail**

Run:

```bash
cd front-cobranca && npx jest 'src/app/(dashboard)/admin/clientes/__tests__/page.test.tsx' --runInBand
```

Expected: FAIL because edit mode, modal, and `updateAdminClient` are missing.

- [ ] **Step 3: Implement edit state and payload building**

Add state for selected client, original snapshot, pending changes, and mode. Convert `AdminClient` to `ClientFormState` with non-secret fields populated and secret fields blank. Build create and update payloads separately so edit mode omits blank secrets.

- [ ] **Step 4: Implement confirmation modal**

Before `updateAdminClient`, compute changed fields from the original snapshot and form. Render a modal with rows for field label, current value and new value. Show current secret values as `Protegido` and newly typed secret values only inside the modal. Cancel closes the modal without API call.

- [ ] **Step 5: Implement table actions and cleanup**

Add accessible `Editar {client.corporateName}` buttons. After successful save, reload clients, clear secret fields, close modal, and keep the form in a safe state.

- [ ] **Step 6: Verify UI tests pass**

Run:

```bash
cd front-cobranca && npx jest 'src/app/(dashboard)/admin/clientes/__tests__/page.test.tsx' --runInBand
```

Expected: PASS.

### Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run backend targeted verification**

Run:

```bash
cd api-cobranca && npm test -- admin.service.spec.ts admin.guard.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run frontend targeted verification**

Run:

```bash
cd front-cobranca && npx jest src/lib/__tests__/api-client-admin.test.ts 'src/app/(dashboard)/admin/clientes/__tests__/page.test.tsx' --runInBand
```

Expected: PASS.

- [ ] **Step 3: Inspect working tree**

Run:

```bash
git status --short
```

Expected: show only local changes, with no commit created by the implementation.
