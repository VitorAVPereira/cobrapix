# Email Templates Design

## Context

The current templates screen at `/configuracoes/templates` manages WhatsApp templates backed by `MessageTemplate`. These templates include Meta-specific fields, approval status, footer and button configuration. Email sending currently builds a fixed HTML layout in the backend and may reuse a WhatsApp message body as plain body text, but it does not have a dedicated editable email template model.

The product goal is to let customers edit and preview email templates with the same care as WhatsApp templates, without mixing email behavior with Meta template approval rules.

## Decision

Use separate backend templates for email. WhatsApp templates stay on `MessageTemplate` and keep the existing Meta flow. Email templates get their own persistence model, API contract, editor and preview.

This avoids coupling email copy changes to WhatsApp approval state and gives the product room to evolve email-specific features such as subjects, preview text, layout blocks and deliverability-safe defaults.

## User Experience

The templates page will add channel tabs:

- `WhatsApp`: current experience, preserving the existing list, component tabs, Meta status, save and submit actions.
- `Email`: a parallel email editor for the same billing moments.

The Email tab will show:

- A template list for the same billing slugs used by the collection rule.
- Editable `subject`.
- Editable email body text.
- Active/inactive toggle.
- Placeholder buttons using the shared collection variables.
- A live email preview with sender/company header, subject, rendered body, billing summary, payment instructions and payment button.

The email preview should look like an actual customer-facing email, not a generic text box. It should render realistic sample values for variables and keep the existing backend email structure recognizable so the preview matches real sends closely.

## Data Model

Add an `EmailTemplate` model in `api-cobranca/prisma/schema.prisma`:

- `id`
- `companyId`
- `slug`
- `name`
- `subject`
- `content`
- `isActive`
- `createdAt`
- `updatedAt`

Constraints:

- Unique by `companyId + slug`.
- Same supported slugs as the WhatsApp template catalog.
- Email templates do not include Meta fields, footer component fields or WhatsApp button configuration.

Default email templates will be created for missing slugs when the company lists email templates, mirroring the default-template behavior already used by WhatsApp templates.

## API

Add an email template API under the authenticated backend:

- `GET /email/templates`: ensure and return company email templates.
- `POST /email/templates`: create a company email template for a slug.
- `PATCH /email/templates/:id`: update subject, content and active state.

The frontend API client will add typed methods for listing, creating and updating email templates.

Validation:

- `subject` and `content` are required when saving.
- Placeholder validation uses the existing template variable catalog.
- Unknown placeholders are rejected with a friendly message.
- Duplicate slugs for the same company return conflict.
- `slug` is stable after creation. Users choose/edit the billing moment through the existing template list, not by typing or changing slug values directly.

## Email Sending

Email sends should use `EmailTemplate` for the selected collection rule step when the channel is `EMAIL`.

The collection rule already stores `templateId` against rule steps. Because existing IDs point to `MessageTemplate`, the first implementation will resolve the email template by slug:

1. Load the rule step template, if present, to get its slug.
2. Find the active `EmailTemplate` for the same company and slug.
3. Use its `subject` and rendered `content` in the email HTML.
4. If no active email template exists, fall back to a safe default email template for that slug.

This preserves the current rule configuration while making email output editable.

## Rendering

Email rendering will use the same variable interpolation inputs as WhatsApp:

- `{{nome_devedor}}`
- `{{nome_empresa}}`
- `{{valor}}`
- `{{data_vencimento}}`
- `{{metodo_pagamento}}`
- `{{payment_link}}`
- `{{pix_copia_e_cola}}`
- `{{boleto_linha_digitavel}}`
- `{{boleto_link}}`
- `{{boleto_pdf}}`

The backend will render `subject` and `content` before sending. The HTML shell remains controlled by `EmailService.buildCollectionEmailHtml` so customers edit the message copy, not unsafe raw HTML.

## Frontend Structure

The templates page can remain a single route, but should be split into focused local components or helper functions if the file grows too large:

- Channel tab state: `whatsapp` or `email`.
- WhatsApp editor: current behavior.
- Email editor: list, form, placeholders and preview.
- Shared preview interpolation helpers where safe.

The UI should remain a dense dashboard tool, using Tailwind and the existing visual language. The Email tab should not introduce marketing-style layout or a decorative landing page.

## Testing

Backend tests:

- Ensure default email templates are created once.
- Validate unknown placeholders in email subject/content.
- Update email template fields.
- Email sending uses email template subject/content for the matching slug.
- Fallback remains safe when no email template exists.

Frontend tests:

- The page shows WhatsApp and Email channel tabs.
- WhatsApp tab still renders existing component tabs.
- Email tab loads templates and previews rendered subject/body.
- Editing subject/body and saving calls the email template API with the expected payload.

## Out Of Scope

- Rich HTML editing for customers.
- Drag-and-drop email layout builder.
- Per-customer branding controls beyond the existing company name and sender.
- Changing the collection rule UI to store separate WhatsApp and Email template IDs.
- Resend analytics or deliverability dashboards.
