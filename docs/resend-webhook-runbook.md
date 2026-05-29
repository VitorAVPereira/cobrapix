# Resend Webhook Runbook

## Runtime Decision

CobraPix uses `resend.emails.send()` for dispatch and the Resend webhook only for async events after sending.

Do not use `webhooks.create`, `webhooks.get`, `webhooks.list`, or `webhooks.update` inside the normal billing flow. Register the webhook once in Resend Dashboard per environment.

## Production Setup

1. Run the backend behind HTTPS.
2. Register this endpoint in Resend Dashboard:
   `https://sua-api.com/webhooks/resend`
3. Enable these events:
   - `email.sent`
   - `email.delivered`
   - `email.opened`
   - `email.clicked`
   - `email.bounced`
   - `email.complained`
   - `email.failed`
   - `email.suppressed`
   - `email.delivery_delayed`
4. Set the API environment variable:
   ```dotenv
   RESEND_WEBHOOK_SECRET="whsec_live_signing_secret_from_resend"
   ```
5. Restart the API.

## Local Testing

1. Run `api-cobranca` locally on port 3001.
2. Expose port 3001 with an HTTPS tunnel.
3. Register the tunnel endpoint in Resend Dashboard:
   `https://seu-tunnel.com/webhooks/resend`
4. Send a test charge that dispatches email through Resend.
5. Verify a new `EmailEvent` row is stored.
6. Verify `CollectionAttempt.status` reflects the latest valid event.

## Safety Rules

- Production requires `RESEND_WEBHOOK_SECRET`.
- Production webhooks missing Svix headers or with invalid Svix signature return 401.
- Malformed JSON payloads or semantically invalid Resend payloads return 400.
- Duplicate `svix-id` creates no new `EmailEvent`.
- Old status does not downgrade `CLICKED`.
- Unknown `email_id` returns `processed: false`.
