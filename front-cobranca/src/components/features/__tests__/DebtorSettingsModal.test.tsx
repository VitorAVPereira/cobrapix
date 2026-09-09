import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DebtorSettingsModal } from "../DebtorSettingsModal";

const getDebtorBillingSettings = jest.fn();
const getRules = jest.fn();
const updateDebtorBillingSettings = jest.fn();

const mockApiClient = {
  getDebtorBillingSettings,
  getRules,
  updateDebtorBillingSettings,
};

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

const settingsResponse = {
  debtorId: "debtor-1",
  debtorName: "Maria Silva",
  document: "12345678909",
  whatsappOptIn: true,
  whatsappOptInAt: "2026-06-01T00:00:00.000Z",
  whatsappOptInSource: "manual-client-page",
  collectionProfile: {
    id: "profile-new",
    name: "Novo Cliente",
    profileType: "NEW",
  },
  useGlobalBillingSettings: true,
  customPreferredBillingMethod: null,
  customCollectionReminderDays: [],
  customAutoGenerateFirstCharge: null,
  customAutoDiscountEnabled: null,
  customAutoDiscountDaysAfterDue: null,
  customAutoDiscountPercentage: null,
  globalSettings: {
    preferredBillingMethod: "PIX",
    enabledBillingMethods: ["PIX"],
    collectionReminderDays: [0],
    autoGenerateFirstCharge: true,
    autoDiscountEnabled: false,
    autoDiscountDaysAfterDue: null,
    autoDiscountPercentage: null,
    onTimeSplitPercentageBps: 350,
    overdueSplitPercentageBps: 1200,
    businessSegment: "GENERAL",
    paymentNotificationEnabled: true,
    paymentNotificationEmails: [],
    tariffs: {},
  },
  effectiveSettings: {
    preferredBillingMethod: "PIX",
    enabledBillingMethods: ["PIX"],
    collectionReminderDays: [0],
    autoGenerateFirstCharge: true,
    autoDiscountEnabled: false,
    autoDiscountDaysAfterDue: null,
    autoDiscountPercentage: null,
    onTimeSplitPercentageBps: 350,
    overdueSplitPercentageBps: 1200,
    businessSegment: "GENERAL",
    paymentNotificationEnabled: true,
    paymentNotificationEmails: [],
    tariffs: {},
  },
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const profile = {
  id: "profile-new",
  companyId: "company-1",
  name: "Novo Cliente",
  profileType: "NEW",
  isDefault: true,
  isActive: true,
  daysOverdueMin: null,
  daysOverdueMax: null,
  steps: [],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

describe("DebtorSettingsModal", () => {
  beforeEach(() => {
    getDebtorBillingSettings.mockReset();
    getRules.mockReset();
    updateDebtorBillingSettings.mockReset();
    getDebtorBillingSettings.mockResolvedValue(settingsResponse);
    getRules.mockResolvedValue([profile]);
    updateDebtorBillingSettings.mockResolvedValue(settingsResponse);
  });

  it("does not allow saving without a payer profile", async () => {
    const user = userEvent.setup();
    render(
      <DebtorSettingsModal
        debtorId="debtor-1"
        debtorName="Maria Silva"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText("Novo Cliente")).toBeInTheDocument();
    expect(screen.queryByText(/sem perfil manual/i)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /salvar configuracoes/i }),
    );

    await waitFor(() => {
      expect(updateDebtorBillingSettings).toHaveBeenCalledWith(
        "debtor-1",
        expect.objectContaining({ collectionProfileId: "profile-new" }),
      );
    });
  });
});
