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
  lateFinePercentage: 0,
  lateInterestMonthlyPercentage: 0,
  paymentDaysAfterDue: 30,
  tariffs: {
    PIX: { method: "PIX", combinedLabel: "Pix", configured: true },
    BOLIX: { method: "BOLIX", combinedLabel: "Bolix", configured: true },
    BOLETO: { method: "BOLETO", combinedLabel: "Boleto", configured: false },
  },
};

describe("company profile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBillingSettings.mockResolvedValue({ ...settings, businessSegment: "EDUCATION" });
    mockUpdateBillingSettings.mockImplementation(async (input) => ({ ...settings, ...input }));
  });

  it("does not let the company change its segment: only the admin sets it", async () => {
    const user = userEvent.setup();
    render(<BillingSettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^salvar$/i })).toBeEnabled());
    expect(screen.queryByText("Perfil da empresa")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /educacao/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^salvar$/i }));
    await waitFor(() => expect(mockUpdateBillingSettings).toHaveBeenCalledTimes(1));
    expect(mockUpdateBillingSettings.mock.calls[0]?.[0]).not.toHaveProperty("businessSegment");
  });
});

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
    const toggle = screen.getByRole("switch", { name: /ativar desconto automático/i });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText("Dias após o vencimento")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Percentual de desconto")).not.toBeInTheDocument();

    await user.click(toggle);
    await user.clear(screen.getByLabelText("Dias após o vencimento"));
    await user.type(screen.getByLabelText("Dias após o vencimento"), "3");
    await user.type(screen.getByLabelText("Percentual de desconto"), "10");
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    await waitFor(() => expect(mockUpdateBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
      autoDiscountEnabled: true, autoDiscountDaysAfterDue: 3, autoDiscountPercentage: 10,
    })));
    await screen.findByText("Configurações salvas.");
    await user.click(toggle);
    expect(screen.queryByLabelText("Dias após o vencimento")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Percentual de desconto")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));
    await waitFor(() => expect(mockUpdateBillingSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      autoDiscountEnabled: false, autoDiscountDaysAfterDue: null, autoDiscountPercentage: null,
    })));
    await screen.findByText("Configurações salvas.");
  });

  it("restores an enabled discount previously saved by the user", async () => {
    mockGetBillingSettings.mockResolvedValue({
      ...settings, autoDiscountEnabled: true, autoDiscountDaysAfterDue: 5, autoDiscountPercentage: 15,
    });
    render(<BillingSettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^salvar$/i })).toBeEnabled());
    expect(screen.getByLabelText("Dias após o vencimento")).toHaveValue(5);
    expect(screen.getByLabelText("Percentual de desconto")).toHaveValue(15);
    expect(screen.getByRole("switch", { name: /ativar desconto automático/i })).toBeChecked();
  });
});

describe("late terms defaults", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBillingSettings.mockResolvedValue(settings);
    mockUpdateBillingSettings.mockImplementation(async (input) => ({ ...settings, ...input }));
  });

  it("starts without fine or interest and 30 days, and saves new defaults", async () => {
    const user = userEvent.setup();
    render(<BillingSettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^salvar$/i })).toBeEnabled());
    expect(screen.getByLabelText(/^multa \(%\)/i)).toHaveValue("0");
    expect(screen.getByLabelText(/^juros ao mês/i)).toHaveValue("0");
    expect(screen.getByLabelText(/^dias aceitando pagamento/i)).toHaveValue("30");
    expect(screen.getByText(/sem multa, sem juros/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^multa \(%\)/i));
    await user.type(screen.getByLabelText(/^multa \(%\)/i), "2,5");
    await user.clear(screen.getByLabelText(/^juros ao mês/i));
    await user.type(screen.getByLabelText(/^juros ao mês/i), "1");
    await user.clear(screen.getByLabelText(/^dias aceitando pagamento/i));
    await user.type(screen.getByLabelText(/^dias aceitando pagamento/i), "10");
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));

    await waitFor(() => expect(mockUpdateBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
      lateFinePercentage: 2.5, lateInterestMonthlyPercentage: 1, paymentDaysAfterDue: 10,
    })));
  });

  it("refuses a fine above the Efí limit without saving", async () => {
    const user = userEvent.setup();
    render(<BillingSettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^salvar$/i })).toBeEnabled());
    await user.clear(screen.getByLabelText(/^multa \(%\)/i));
    await user.type(screen.getByLabelText(/^multa \(%\)/i), "12");
    await user.click(screen.getByRole("button", { name: /^salvar$/i }));
    expect(await screen.findByText(/multa deve estar entre 0 e 10%/i)).toBeInTheDocument();
    expect(mockUpdateBillingSettings).not.toHaveBeenCalled();
  });
});

describe("loading and saving state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateBillingSettings.mockImplementation(async (input) => ({ ...settings, ...input }));
  });

  it("does not offer to save defaults when the settings could not be loaded", async () => {
    const user = userEvent.setup();
    mockGetBillingSettings.mockRejectedValueOnce(new Error("Falha de rede"));
    mockGetBillingSettings.mockResolvedValueOnce(settings);
    render(<BillingSettingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    expect(screen.queryByRole("button", { name: /^salvar$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /tentar novamente/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^salvar$/i })).toBeEnabled());
    expect(mockUpdateBillingSettings).not.toHaveBeenCalled();
  });

  it("flags unsaved changes until they are saved", async () => {
    const user = userEvent.setup();
    mockGetBillingSettings.mockResolvedValue(settings);
    render(<BillingSettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^salvar$/i })).toBeEnabled());
    expect(screen.getByText("Nenhuma alteração")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^bolix/i }));
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^bolix/i })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /^salvar$/i }));
    await screen.findByText("Configurações salvas.");
    expect(mockUpdateBillingSettings).toHaveBeenCalledWith(expect.objectContaining({ preferredBillingMethod: "BOLIX" }));
    expect(screen.queryByText("Alterações não salvas")).not.toBeInTheDocument();
  });
});
