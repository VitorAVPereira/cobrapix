# Payment Method Platform Rates Design

## Context

The company billing settings already store per-client platform split rates in basis points:

- `onTimeSplitPercentageBps`
- `overdueSplitPercentageBps`

The customer-facing billing settings screen still presents the platform fee as a fixed `R$ 0,50` inside payment method cards and summaries. Invoice creation selects also show the combined Efí/fixed-fee label, so operators see the wrong platform pricing when choosing Pix, Boleto, or Bolix.

## Approved Scope

Keep the database model and `Bps` storage exactly as implemented. Do not migrate to decimal percentage columns.

Update the frontend to display each client's recovered settings as percentages:

- `Taxa no prazo`
- `Taxa recuperada`

Remove user-visible fixed platform fee messaging from the payment-method selection UI.

## Design

Create a small frontend formatting helper that converts basis points to a Brazilian percentage string and builds labels for payment method selectors. Use the existing `BillingSettings` response as the source of truth, especially `onTimeSplitPercentageBps` and `overdueSplitPercentageBps`.

Update these frontend surfaces:

- `configuracoes/cobranca`: method cards and summary show the two platform percentages instead of `R$ 0,50`/combined fixed labels.
- `cobrancas`: manual invoice payment method options show the method plus the platform percentage summary.
- `devedores-recorrentes`: recurring invoice method options show the method plus the platform percentage summary.

The Efí tariff can remain visible as informational text where useful, but the platform fee must be represented by the client's percentage settings.

## Testing

Add a focused Jest test for the formatter. The failing behavior is that labels must be built from `onTimeSplitPercentageBps` and `overdueSplitPercentageBps`, not from `tariffs[method].combinedLabel`.
