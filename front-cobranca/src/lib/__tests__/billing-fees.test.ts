import type { BillingSettings } from "../api-client";
import {
  formatBillingMethodRateLabel,
  formatPercentageBps,
  formatPlatformRateSummary,
} from "../billing-fees";

const settings = {
  preferredBillingMethod: "PIX",
  tariffs: {
    PIX: {
      method: "PIX",
      combinedLabel: "1,19% + R$ 0,50",
      configured: true,
    },
  },
} as unknown as BillingSettings;

describe("billing fee formatting", () => {
  it("formats basis points as a pt-BR percentage", () => {
    expect(formatPercentageBps(150)).toBe("1,50%");
  });

  it("uses the centrally configured tariff summary", () => {
    expect(formatPlatformRateSummary(settings)).toBe("1,19% + R$ 0,50");
  });

  it("uses the combined tariff label for payment method options", () => {
    expect(formatBillingMethodRateLabel("PIX", settings)).toBe(
      "Pix · Taxa 1,19% + R$ 0,50",
    );
  });
});
