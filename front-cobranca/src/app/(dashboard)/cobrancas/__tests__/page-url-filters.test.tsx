import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CobrancasPage from "../page";

const getInvoices = jest.fn();
const getBillingSettings = jest.fn();
const searchParams = new URLSearchParams("debtorId=debtor-1&status=PENDING");

const mockApiClient = {
  getInvoices,
  getBillingSettings,
  importInvoices: jest.fn(),
  createInvoice: jest.fn(),
  createDebtorInvoice: jest.fn(),
  runSelectedBilling: jest.fn(),
  createPayment: jest.fn(),
  getInvoicePaymentStatus: jest.fn(),
  cancelInvoice: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("@/components/features/InvoiceTable", () => ({
  InvoiceTable: () => <div>Tabela de cobrancas</div>,
}));

jest.mock("@/components/features/UploadCSV", () => ({
  UploadCSV: () => <div>Upload CSV</div>,
}));

jest.mock("@/components/features/DebtorSettingsModal", () => ({
  DebtorSettingsModal: () => <div>Configuracao</div>,
}));

jest.mock("@/components/features/DebtorPaymentHistoryModal", () => ({
  DebtorPaymentHistoryModal: () => <div>Historico</div>,
}));

describe("CobrancasPage URL filters", () => {
  beforeEach(() => {
    getInvoices.mockReset();
    getBillingSettings.mockReset();
    getInvoices.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    getBillingSettings.mockResolvedValue({
      preferredBillingMethod: "PIX",
      enabledBillingMethods: ["PIX"],
      collectionReminderDays: [0],
      autoGenerateFirstCharge: true,
      autoDiscountEnabled: false,
      autoDiscountDaysAfterDue: null,
      autoDiscountPercentage: null,
      businessSegment: "GENERAL",
      paymentNotificationEnabled: true,
      paymentNotificationEmails: [],
      tariffs: {},
    });
  });

  it("passes debtorId and status from the URL to getInvoices", async () => {
    render(<CobrancasPage />);

    await waitFor(() => {
      expect(getInvoices).toHaveBeenCalledWith(
        expect.objectContaining({
          debtorId: "debtor-1",
          status: "PENDING",
        }),
      );
    });
    expect(
      screen.getByText(/filtradas pelo cliente selecionado/i),
    ).toBeInTheDocument();
  });

  it("keeps Bolix as default and hides traditional Boleto even with legacy settings", async () => {
    getBillingSettings.mockResolvedValueOnce({
      preferredBillingMethod: "BOLETO",
      enabledBillingMethods: ["PIX", "BOLETO", "BOLIX"],
      collectionReminderDays: [0],
      autoGenerateFirstCharge: false,
      autoDiscountEnabled: false,
      autoDiscountDaysAfterDue: null,
      autoDiscountPercentage: null,
      businessSegment: "GENERAL",
      paymentNotificationEnabled: true,
      paymentNotificationEmails: [],
      tariffs: {},
    });
    render(<CobrancasPage />);
    await waitFor(() => expect(getBillingSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Adicionar Manual/i }));
    expect(screen.queryByRole("option", { name: /^Boleto$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Bolix/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Bolix/i }).closest("select")).toHaveValue("BOLIX");
  });
});
