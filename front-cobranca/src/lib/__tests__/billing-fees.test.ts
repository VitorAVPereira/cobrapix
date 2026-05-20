import type { BillingSettings } from "../api-client";
import {
  formatBillingMethodRateLabel,
  formatPercentageBps,
  formatPlatformRateSummary,
} from "../billing-fees";

const settings = {
  onTimeSplitPercentageBps: 150,
  overdueSplitPercentageBps: 1200,
  tariffs: {
    PIX: { combinedLabel: "1,19% + R$ 0,50" },
  },
} as unknown as BillingSettings;

describe("billing fee formatting", () => {
  it("formats basis points as a pt-BR percentage", () => {
    expect(formatPercentageBps(150)).toBe("1,50%");
  });

  it("builds the platform rate summary from client percentages", () => {
    expect(formatPlatformRateSummary(settings)).toBe(
      "No prazo: 1,50% | Recuperada: 12,00%",
    );
  });

  it("does not use the fixed combined tariff label for payment method options", () => {
    expect(formatBillingMethodRateLabel("PIX", settings)).toBe(
      "Pix - No prazo: 1,50% | Recuperada: 12,00%",
    );
  });
});
