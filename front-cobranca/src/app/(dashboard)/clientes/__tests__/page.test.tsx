import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CollectionRuleProfile,
  CreateDebtorInput,
  DebtorListResponse,
  UpdateDebtorInput,
} from "@/lib/api-client";
import ClientesPage from "../page";

const push = jest.fn();
const getDebtors = jest.fn() as jest.MockedFunction<
  () => Promise<DebtorListResponse>
>;
const getRules = jest.fn() as jest.MockedFunction<
  () => Promise<CollectionRuleProfile[]>
>;
const createDebtor = jest.fn() as jest.MockedFunction<
  (data: CreateDebtorInput) => Promise<DebtorListResponse["data"][number]>
>;
const updateDebtor = jest.fn() as jest.MockedFunction<
  (
    debtorId: string,
    data: UpdateDebtorInput,
  ) => Promise<DebtorListResponse["data"][number]>
>;
const createDebtorInvoice = jest.fn();
const getBillingSettings = jest.fn();
const mockApiClient = {
  getBillingSettings,
  getDebtors,
  getRules,
  createDebtor,
  updateDebtor,
  createDebtorInvoice,
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("@/components/features/DebtorPaymentHistoryModal", () => ({
  DebtorPaymentHistoryModal: ({ debtorName }: { debtorName: string }) => (
    <div>Historico de {debtorName}</div>
  ),
}));

jest.mock("@/components/features/DebtorSettingsModal", () => ({
  DebtorSettingsModal: ({ debtorName }: { debtorName: string }) => (
    <div>Configuracao de {debtorName}</div>
  ),
}));

const profile: CollectionRuleProfile = {
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

const debtorResponse: DebtorListResponse = {
  data: [
    {
      debtorId: "debtor-1",
      name: "Maria Silva",
      document: "12345678909",
      phone_number: "+5511999999999",
      email: null,
      whatsapp_opt_in: true,
      whatsappOptInAt: "2026-06-01T12:00:00.000Z",
      collectionProfile: {
        id: "profile-new",
        name: "Novo Cliente",
        profileType: "NEW",
      },
      openInvoicesCount: 2,
      openInvoicesAmount: 120,
      paidInvoicesCount: 3,
      paidInvoicesAmount: 300,
      lastInvoiceAt: "2026-06-04T12:00:00.000Z",
      lastPaymentAt: "2026-06-03T12:00:00.000Z",
      createdAt: "2026-06-01T12:00:00.000Z",
      updatedAt: "2026-06-02T12:00:00.000Z",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  summary: {
    totalDebtors: 1,
    openInvoiceAmount: 120,
    openInvoiceCount: 2,
    paidInvoiceAmount: 300,
    paidInvoiceCount: 3,
  },
};

describe("ClientesPage", () => {
  beforeEach(() => {
    push.mockReset();
    getDebtors.mockReset();
    getRules.mockReset();
    createDebtor.mockReset();
    updateDebtor.mockReset();
    createDebtorInvoice.mockReset();
    getDebtors.mockResolvedValue(debtorResponse);
    getRules.mockResolvedValue([profile]);
    createDebtor.mockResolvedValue(debtorResponse.data[0]);
    updateDebtor.mockResolvedValue(debtorResponse.data[0]);
    createDebtorInvoice.mockResolvedValue({});
    getBillingSettings.mockResolvedValue({
      lateFinePercentage: 2,
      lateInterestMonthlyPercentage: 1,
      paymentDaysAfterDue: 30,
    });
  });

  it("renders operational debtor data", async () => {
    render(<ClientesPage />);

    expect(await screen.findByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getAllByText("Novo Cliente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 cobrancas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 pagas").length).toBeGreaterThan(0);
    expect(screen.queryByText(/sem perfil/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/abrir menu/i)).not.toBeInTheDocument();
  });

  it("opens actions menu and navigates to open invoices", async () => {
    const user = userEvent.setup();
    render(<ClientesPage />);

    await screen.findByText("Maria Silva");
    await user.click(
      screen.getByRole("button", { name: /abrir acoes do cliente maria/i }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: /ver cobrancas em aberto/i }),
    );

    expect(push).toHaveBeenCalledWith(
      "/cobrancas?debtorId=debtor-1&status=PENDING",
    );
  });

  it("creates debtor with Novo pagador as default profile", async () => {
    const user = userEvent.setup();
    render(<ClientesPage />);

    await user.click(await screen.findByRole("button", { name: /novo cliente/i }));
    expect(screen.getByLabelText(/perfil de pagador/i)).toHaveValue(
      "profile-new",
    );
    await user.type(screen.getByLabelText(/^nome/i), "Joao Souza");
    await user.type(screen.getByLabelText(/cpf\/cnpj/i), "12345678909");
    await user.type(screen.getByLabelText("WhatsApp"), "11999999999");
    await user.click(screen.getByRole("button", { name: /salvar cliente/i }));

    await waitFor(() => {
      expect(createDebtor).toHaveBeenCalledWith({
        name: "Joao Souza",
        document: "12345678909",
        phone_number: "+5511999999999",
        email: null,
        whatsappOptIn: false,
        collectionProfileId: "profile-new",
      });
    });
  });

  it("edits debtor data from the row menu", async () => {
    const user = userEvent.setup();
    render(<ClientesPage />);

    await screen.findByText("Maria Silva");
    await user.click(
      screen.getByRole("button", { name: /abrir acoes do cliente maria/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /editar cliente/i }));
    await user.type(screen.getByLabelText(/e-mail/i), "maria@email.com");
    await user.click(screen.getByRole("button", { name: /salvar cliente/i }));

    await waitFor(() => {
      expect(updateDebtor).toHaveBeenCalledWith(
        "debtor-1",
        expect.objectContaining({
          email: "maria@email.com",
          collectionProfileId: "profile-new",
        }),
      );
    });
  });

  it("creates a new charge for an existing debtor", async () => {
    const user = userEvent.setup();
    render(<ClientesPage />);

    await screen.findByText("Maria Silva");
    await user.click(
      screen.getByRole("button", { name: /abrir acoes do cliente maria/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /nova cobranca/i }));
    await user.type(screen.getByLabelText(/valor/i), "120");
    await user.type(screen.getByLabelText(/data de vencimento/i), "2026-07-10");
    await user.click(screen.getByRole("button", { name: /salvar cobranca/i }));

    await waitFor(() => {
      expect(createDebtorInvoice).toHaveBeenCalledWith("debtor-1", {
        original_amount: 120,
        due_date: "2026-07-10",
        billing_type: "BOLIX",
        late_fine_percentage: 2,
        late_interest_monthly_percentage: 1,
        payment_days_after_due: 30,
      });
    });
  });

  it("starts a charge with the company late terms and lets the user change them", async () => {
    const user = userEvent.setup();
    render(<ClientesPage />);

    await screen.findByText("Maria Silva");
    await waitFor(() => expect(getBillingSettings).toHaveBeenCalled());
    await user.click(
      screen.getByRole("button", { name: /abrir acoes do cliente maria/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /nova cobranca/i }));
    expect(screen.getByLabelText(/^multa \(%\)/i)).toHaveValue("2");
    expect(screen.getByLabelText(/^juros ao mês/i)).toHaveValue("1");
    expect(screen.getByLabelText(/^dias aceitando pagamento/i)).toHaveValue("30");

    await user.clear(screen.getByLabelText(/^multa \(%\)/i));
    await user.type(screen.getByLabelText(/^multa \(%\)/i), "3");
    expect(screen.getByRole("alert")).toHaveTextContent(/limita a multa a 2%/i);
    await user.clear(screen.getByLabelText(/^juros ao mês/i));
    await user.clear(screen.getByLabelText(/^dias aceitando pagamento/i));
    await user.type(screen.getByLabelText(/^dias aceitando pagamento/i), "0");
    await user.type(screen.getByLabelText(/valor/i), "120");
    await user.type(screen.getByLabelText(/data de vencimento/i), "2026-07-10");
    await user.click(screen.getByRole("button", { name: /salvar cobranca/i }));

    await waitFor(() => {
      expect(createDebtorInvoice).toHaveBeenCalledWith(
        "debtor-1",
        expect.objectContaining({
          late_fine_percentage: 3,
          // Cleared: the company default applies on the server.
          late_interest_monthly_percentage: null,
          payment_days_after_due: 0,
        }),
      );
    });
  });
});
