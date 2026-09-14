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

export function formatPlatformRateSummary(settings: BillingSettings): string {
  return (
    settings.tariffs?.[settings.preferredBillingMethod]?.combinedLabel ??
    "Tarifa não configurada"
  );
}
export function formatBillingMethodRateLabel(
  method: BillingMethod,
  settings: BillingSettings | null,
): string {
  const label = getBillingMethodLabel(method);
  const fee = settings?.tariffs?.[method]?.combinedLabel;
  return fee ? `${label} · Taxa ${fee}` : label;
}
