import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BillingSettings, UpdateBillingSettingsInput } from "@/lib/api-client";
import BillingSettingsPage from "../page";

const mockGetBillingSettings = jest.fn<Promise<BillingSettings>, []>();
const mockUpdateBillingSettings = jest.fn<Promise<BillingSettings>, [UpdateBillingSettingsInput]>();
const mockApiClient = {
  getBillingSettings: mockGetBillingSettings,
  updateBillingSettings: mockUpdateBillingSettings,
};

jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApiClient }));
jest.mock("@/components/features/financial-activation-context", () => ({
  useFinancialActivation: () => ({ canIssue: true }),
}));

const settings: BillingSettings = {
  preferredBillingMethod: "PIX",
  enabledBillingMethods: ["PIX", "BOLIX"],
  collectionReminderDays: [0],
  autoGenerateFirstCharge: true,
  autoDiscountEnabled: false,
  autoDiscountDaysAfterDue: null,
  autoDiscountPercentage: null,
  businessSegment: "GENERAL",
  paymentNotificationEnabled: true,
  paymentNotificationEmails: [],
  tariffs: {
    PIX: { method: "PIX", combinedLabel: "Pix", configured: true },
    BOLIX: { method: "BOLIX", combinedLabel: "Bolix", configured: true },
    BOLETO: { method: "BOLETO", combinedLabel: "Boleto", configured: false },
  },
};

describe("automatic discounts after login", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBillingSettings.mockResolvedValue(settings);
    mockUpdateBillingSettings.mockImplementation(async (input) => ({ ...settings, ...input }));
  });

  it("starts disabled and shows configuration only when the user activates it", async () => {
    const user = userEvent.setup();
    render(<BillingSettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^salvar$/i })).toBeEnabled());
    const toggle = screen.getByRole("checkbox", { name: /ativar desconto automatico/i });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText("Dias apos o vencimento")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Percentual de desconto")).not.toBeInTheDocument();

    await user.click(toggle);
    await user.clear(screen.getByLabelText("Dias apos o vencimento"));
    await user.type(screen.getByLabelText("Dias apos o vencimento"), "3");
    await user.type(screen.getByLabelText("Percentual de desconto"), "10");
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    await waitFor(() => expect(mockUpdateBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
      autoDiscountEnabled: true, autoDiscountDaysAfterDue: 3, autoDiscountPercentage: 10,
    })));
    await screen.findByText("Configuracoes de cobranca salvas.");
    await user.click(toggle);
    expect(screen.queryByLabelText("Dias apos o vencimento")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Percentual de desconto")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));
    await waitFor(() => expect(mockUpdateBillingSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      autoDiscountEnabled: false, autoDiscountDaysAfterDue: null, autoDiscountPercentage: null,
    })));
    await screen.findByText("Configuracoes de cobranca salvas.");
  });

  it("restores an enabled discount previously saved by the user", async () => {
    mockGetBillingSettings.mockResolvedValue({
      ...settings, autoDiscountEnabled: true, autoDiscountDaysAfterDue: 5, autoDiscountPercentage: 15,
    });
    render(<BillingSettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^salvar$/i })).toBeEnabled());
    expect(screen.getByLabelText("Dias apos o vencimento")).toHaveValue(5);
    expect(screen.getByLabelText("Percentual de desconto")).toHaveValue(15);
    expect(screen.getByRole("checkbox", { name: /ativar desconto automatico/i })).toBeChecked();
  });
});
