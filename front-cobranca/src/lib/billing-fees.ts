import type { BillingMethod, BillingSettings } from "./api-client";

export function getBillingMethodLabel(method: BillingMethod): string {
  if (method === "BOLETO") return "Boleto";
  if (method === "BOLIX") return "Bolix";
  return "Pix";
}

export function formatPercentageBps(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)}%`;
}

export function formatPlatformRateSummary(
  settings: Pick<
    BillingSettings,
    "onTimeSplitPercentageBps" | "overdueSplitPercentageBps"
  >,
): string {
  return `No prazo: ${formatPercentageBps(settings.onTimeSplitPercentageBps)} | Recuperada: ${formatPercentageBps(settings.overdueSplitPercentageBps)}`;
}

export function formatBillingMethodRateLabel(
  method: BillingMethod,
  settings: BillingSettings | null,
): string {
  const label = getBillingMethodLabel(method);
  return settings ? `${label} - ${formatPlatformRateSummary(settings)}` : label;
}
