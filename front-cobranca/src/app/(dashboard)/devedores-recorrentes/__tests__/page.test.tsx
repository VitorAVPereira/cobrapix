import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RecurringInvoice, RecurringInvoiceListResponse } from "@/lib/api-client";
import RecorrentesPage from "../page";

const getRecurringInvoices = jest.fn();
const getBillingSettings = jest.fn();
const pauseRecurringInvoice = jest.fn();
const activateRecurringInvoice = jest.fn();
const updateRecurringInvoice = jest.fn();
const searchDebtors = jest.fn();
const createDebtorInvoice = jest.fn();
const mockApiClient = {
  getRecurringInvoices,
  getBillingSettings,
  pauseRecurringInvoice,
  activateRecurringInvoice,
  updateRecurringInvoice,
  searchDebtors,
  createDebtorInvoice,
};

const replace = jest.fn();
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => mockParams,
  usePathname: () => "/devedores-recorrentes",
}));

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("@/components/features/LateTermsFields", () => ({
  LateTermsFields: () => <div>Multa e juros</div>,
}));

function recurrence(overrides: Partial<RecurringInvoice> = {}): RecurringInvoice {
  return {
    recurrenceId: "recurrence-1",
    debtor: {
      debtorId: "debtor-1",
      name: "Ana Souza",
      document: "52998224725",
      phone_number: "+5511999990001",
    },
    amount: 250,
    billingType: "BOLIX",
    dueDay: 10,
    frequency: "MONTHLY",
    status: "ACTIVE",
    nextDueDate: "2026-11-10",
    lastGeneratedPeriod: "2026-10",
    pendingInvoice: { invoiceId: "invoice-1", dueDate: "2026-10-10", amount: 250, status: "PENDING" },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function listResponse(overrides: Partial<RecurringInvoiceListResponse> = {}): RecurringInvoiceListResponse {
  return {
    data: [
      recurrence(),
      recurrence({
        recurrenceId: "recurrence-2",
        debtor: { debtorId: "debtor-2", name: "Bruno Lima", phone_number: "+5511999990002" },
        status: "PAUSED",
        billingType: "CREDIT_CARD",
        dueDay: 5,
        pendingInvoice: null,
        nextDueDate: null,
      }),
    ],
    total: 1234,
    page: 1,
    pageSize: 20,
    summary: { active: 1200, paused: 34, activeMonthlyAmount: 300000.5 },
    ...overrides,
  };
}

describe("RecorrentesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = new URLSearchParams();
    getRecurringInvoices.mockResolvedValue(listResponse());
    getBillingSettings.mockResolvedValue({ enabledBillingMethods: ["BOLIX", "PIX"] });
    searchDebtors.mockResolvedValue([]);
  });

  it("lists one compact row per recurrence with the company summary", async () => {
    render(<RecorrentesPage />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("Ana Souza")).toBeInTheDocument();
    expect(within(rows[1]).getByText("10/10/2026")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Cartão")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Pausada")).toBeInTheDocument();
    const summary = screen.getByLabelText("Resumo");
    expect(within(summary).getByText("1.200 recorrências")).toBeInTheDocument();
    expect(within(summary).getByText("R$ 300.000,50")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 62")).toBeInTheDocument();
  });

  it("sends the filters of the URL to the API", async () => {
    mockParams = new URLSearchParams("search=Ana&status=PAUSED&billingType=BOLETO&page=2&pageSize=50");
    render(<RecorrentesPage />);

    await waitFor(() =>
      expect(getRecurringInvoices).toHaveBeenCalledWith(
        { page: 2, pageSize: 50, search: "Ana", status: "PAUSED", billingType: "BOLETO" },
        expect.any(AbortSignal),
      ),
    );
  });

  it("confirms a pause, saying the open invoice stays", async () => {
    pauseRecurringInvoice.mockResolvedValue({});
    render(<RecorrentesPage />);
    await screen.findByRole("table");

    await userEvent.click(screen.getByLabelText("Pausar recorrência de Ana Souza"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("A fatura de 10/10/2026 (R$ 250,00) já foi gerada e continua em aberto.");
    expect(pauseRecurringInvoice).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Pausar recorrência" }));
    expect(pauseRecurringInvoice).toHaveBeenCalledWith("recurrence-1");
    await waitFor(() => expect(getRecurringInvoices).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirms an activation, saying the paused period is not charged", async () => {
    activateRecurringInvoice.mockResolvedValue({});
    render(<RecorrentesPage />);
    await screen.findByRole("table");

    await userEvent.click(screen.getByLabelText("Ativar recorrência de Bruno Lima"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("(mensal · dia 5) voltam a ser geradas a partir de hoje");
    expect(dialog).toHaveTextContent("O período em que ficou pausada não é cobrado.");

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(activateRecurringInvoice).not.toHaveBeenCalled();
  });

  it("shows form errors inside the edit dialog", async () => {
    render(<RecorrentesPage />);
    await screen.findByRole("table");

    await userEvent.click(screen.getByLabelText("Editar recorrência de Ana Souza"));
    const dialog = screen.getByRole("dialog");
    const amount = within(dialog).getByDisplayValue("250");
    await userEvent.clear(amount);
    await userEvent.type(amount, "0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Informe um valor recorrente válido.");
    expect(updateRecurringInvoice).not.toHaveBeenCalled();
  });

  it("tells a failure apart from an empty list", async () => {
    getRecurringInvoices.mockRejectedValueOnce(new Error("offline"));
    render(<RecorrentesPage />);

    expect(await screen.findByText("Não foi possível carregar as recorrências.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma recorrência")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("offers to clear the filters when nothing matches", async () => {
    mockParams = new URLSearchParams("status=PAUSED");
    getRecurringInvoices.mockResolvedValue(listResponse({ data: [], total: 0 }));
    render(<RecorrentesPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Limpar filtros" }));
    expect(replace).toHaveBeenCalledWith("/devedores-recorrentes", { scroll: false });
  });
  it("marks a generated draft as not charged yet, also when pausing", async () => {
    getRecurringInvoices.mockResolvedValue(
      listResponse({
        data: [
          recurrence({
            pendingInvoice: { invoiceId: "invoice-9", dueDate: "2026-11-10", amount: 250, status: "DRAFT" },
          }),
        ],
        total: 1,
      }),
    );
    render(<RecorrentesPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("10/11/2026")).toBeInTheDocument();
    expect(within(table).getByText("Rascunho")).toHaveAttribute("title", expect.stringContaining("ainda não cobrada"));

    await userEvent.click(screen.getByLabelText("Pausar recorrência de Ana Souza"));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "A fatura de 10/11/2026 (R$ 250,00) já foi gerada como rascunho e continua em Cobranças, sem envio.",
    );
  });

  it("shows the frequency and keeps the weekday of a weekly recurrence when editing", async () => {
    getRecurringInvoices.mockResolvedValue(
      listResponse({
        data: [
          recurrence({
            frequency: "WEEKLY",
            dueDay: 26,
            pendingInvoice: { invoiceId: "invoice-w", dueDate: "2026-10-26", amount: 80, status: "PENDING" },
            nextDueDate: "2026-11-02",
            amount: 80,
          }),
        ],
        total: 1,
      }),
    );
    updateRecurringInvoice.mockResolvedValue({});
    render(<RecorrentesPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Semanal · segunda-feira")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Editar recorrência de Ana Souza"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("Dia de vencimento")).toBeNull();
    expect(dialog).toHaveTextContent("Periodicidade: Semanal. Ela não muda");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() =>
      expect(updateRecurringInvoice).toHaveBeenCalledWith(
        "recurrence-1",
        expect.objectContaining({ amount: 80, dueDay: undefined }),
      ),
    );
  });

  it("creates a recurrence from the button with frequency and first due date", async () => {
    searchDebtors.mockResolvedValue([
      { debtorId: "debtor-3", name: "Carla Dias", document: "52998224725", phone_number: "+5511999990003", email: null },
    ]);
    createDebtorInvoice.mockResolvedValue({});
    render(<RecorrentesPage />);
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Nova recorrência" }));
    const dialog = await screen.findByRole("dialog", { name: "Nova cobrança recorrente" });
    await userEvent.click(await within(dialog).findByText("Carla Dias"));
    await userEvent.type(within(dialog).getByLabelText("Valor (R$)"), "80");
    await userEvent.selectOptions(within(dialog).getByLabelText("Periodicidade"), "WEEKLY");
    fireEvent.change(within(dialog).getByLabelText("Primeiro vencimento"), {
      target: { value: "2030-03-04" },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar recorrência" }));

    await waitFor(() =>
      expect(createDebtorInvoice).toHaveBeenCalledWith(
        "debtor-3",
        expect.objectContaining({
          original_amount: 80,
          billing_type: "BOLIX",
          recurring: true,
          frequency: "WEEKLY",
          first_due_date: "2030-03-04",
        }),
      ),
    );
    expect(await screen.findByText("Recorrência criada para Carla Dias.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getRecurringInvoices).toHaveBeenCalledTimes(2);
  });

  it("opens the form with the client chosen in Cobranças and cleans the link", async () => {
    mockParams = new URLSearchParams("nova=1&cliente=debtor-3");
    searchDebtors.mockResolvedValue([
      { debtorId: "debtor-3", name: "Carla Dias", document: "52998224725", phone_number: "+5511999990003", email: null },
    ]);
    render(<RecorrentesPage />);

    const dialog = await screen.findByRole("dialog", { name: "Nova cobrança recorrente" });
    expect(await within(dialog).findByText("Carla Dias")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Trocar cliente" })).toBeInTheDocument();
    expect(searchDebtors).toHaveBeenCalledWith("", undefined, "debtor-3");
    expect(replace).toHaveBeenCalledWith("/devedores-recorrentes", { scroll: false });
  });

  it("refuses a first due date before today", async () => {
    mockParams = new URLSearchParams("nova=1&cliente=debtor-3");
    searchDebtors.mockResolvedValue([
      { debtorId: "debtor-3", name: "Carla Dias", document: "52998224725", phone_number: "+5511999990003", email: null },
    ]);
    render(<RecorrentesPage />);
    const dialog = await screen.findByRole("dialog", { name: "Nova cobrança recorrente" });
    await within(dialog).findByText("Carla Dias");

    await userEvent.type(within(dialog).getByLabelText("Valor (R$)"), "80");
    fireEvent.change(within(dialog).getByLabelText("Primeiro vencimento"), {
      target: { value: "2020-01-01" },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar recorrência" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("O primeiro vencimento não pode ser anterior a hoje.");
    expect(createDebtorInvoice).not.toHaveBeenCalled();
  });
});
