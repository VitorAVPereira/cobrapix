import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CobrancasPage from "../page";

const getInvoices = jest.fn();
const getBillingSettings = jest.fn();
const mockReplace = jest.fn();
let mockParams = new URLSearchParams("debtorId=debtor-1&status=PENDING");

const mockApiClient = {
  getInvoices,
  getBillingSettings,
  importInvoices: jest.fn(),
  createDebtorInvoice: jest.fn(),
  searchDebtors: jest.fn(),
  previewInvoiceImport: jest.fn(),
  runSelectedBilling: jest.fn(),
  createPayment: jest.fn(),
  getInvoicePaymentStatus: jest.fn(),
  cancelInvoice: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/cobrancas",
}));

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("@/components/features/InvoiceTable", () => ({
  InvoiceTable: () => <div>Tabela de cobrancas</div>,
}));

const mockRows = [
  { name: "Ana Souza", document: "52998224725", phone_number: "11999990001", original_amount: 100, due_date: "2026-11-10" },
  { name: "Bruno", document: "11144477735", phone_number: "11999990002", original_amount: 50, due_date: "2026-11-10" },
];
jest.mock("@/components/features/UploadCSV", () => ({
  UploadCSV: ({ onUploadSuccess }: { onUploadSuccess: (rows: unknown[]) => void }) => (
    <button type="button" onClick={() => onUploadSuccess(mockRows)}>
      Enviar planilha
    </button>
  ),
}));

jest.mock("@/components/features/DebtorSettingsModal", () => ({
  DebtorSettingsModal: () => <div>Configuracao</div>,
}));

jest.mock("@/components/features/DebtorPaymentHistoryModal", () => ({
  DebtorPaymentHistoryModal: () => <div>Historico</div>,
}));

const invoice = {
  id: "invoice-1",
  invoiceId: "invoice-1",
  name: "Ana",
  phone_number: "+5511999990001",
  original_amount: 100,
  due_date: "2026-11-10",
  status: "PENDING",
};

describe("CobrancasPage URL filters", () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockReplace.mockReset();
    mockParams = new URLSearchParams("debtorId=debtor-1&status=PENDING");
    getInvoices.mockReset();
    getBillingSettings.mockReset();
    getInvoices.mockResolvedValue({ data: [invoice], total: 1, page: 1, pageSize: 20 });
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

  it("passes the filters of the URL to getInvoices", async () => {
    mockParams = new URLSearchParams(
      "debtorId=debtor-1&status=OVERDUE&billingType=BOLETO&sort=dueDate_asc&page=3&pageSize=50&search=Ana",
    );
    render(<CobrancasPage />);

    await waitFor(() => {
      expect(getInvoices).toHaveBeenCalledWith(
        {
          debtorId: "debtor-1",
          status: "OVERDUE",
          billingType: "BOLETO",
          sort: "dueDate_asc",
          page: 3,
          pageSize: 50,
          search: "Ana",
        },
        expect.any(AbortSignal),
      );
    });
    expect(screen.getByText(/Mostrando as cobranças de um cliente/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Filtrar por situação")).toHaveValue("OVERDUE");
    expect(screen.getByLabelText("Filtrar por forma de pagamento")).toHaveValue("BOLETO");

    fireEvent.click(screen.getByRole("button", { name: "Ver todas" }));
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/cobrancas?search=Ana&status=OVERDUE&billingType=BOLETO&sort=dueDate_asc&pageSize=50",
      { scroll: false },
    );
  });

  it("ignores unknown values in the URL", async () => {
    mockParams = new URLSearchParams("status=ALL&sort=hack&pageSize=5000&page=-2");
    render(<CobrancasPage />);

    await waitFor(() => expect(getInvoices).toHaveBeenCalled());
    expect(getInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined, sort: "createdAt_desc", page: 1, pageSize: 20 }),
      expect.any(AbortSignal),
    );
  });

  it("writes a filter change to the URL and goes back to the first page", async () => {
    mockParams = new URLSearchParams("page=4&sort=amount_desc");
    render(<CobrancasPage />);
    await screen.findByText("Tabela de cobrancas");

    fireEvent.change(screen.getByLabelText("Filtrar por forma de pagamento"), {
      target: { value: "PIX" },
    });
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/cobrancas?billingType=PIX&sort=amount_desc",
      { scroll: false },
    );
  });

  it("searches once the user stops typing", async () => {
    mockParams = new URLSearchParams("");
    render(<CobrancasPage />);
    await screen.findByText("Tabela de cobrancas");
    jest.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Buscar cobranças"), {
      target: { value: "123.456" },
    });
    expect(mockReplace).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(mockReplace).toHaveBeenCalledWith("/cobrancas?search=123.456", { scroll: false });
  });

  it("a failure is an error with retry, not an empty list", async () => {
    getInvoices.mockRejectedValueOnce(new Error("offline"));
    render(<CobrancasPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar as cobranças.",
    );
    expect(screen.queryByText(/Nenhuma cobrança/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Tabela de cobrancas")).toBeInTheDocument();
  });

  it("offers to clear the filters when nothing matches", async () => {
    getInvoices.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });
    render(<CobrancasPage />);

    expect(await screen.findByText("Nenhuma cobrança encontrada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(mockReplace).toHaveBeenLastCalledWith("/cobrancas", { scroll: false });
  });

  describe("Nova cobrança", () => {
    const ana = {
      debtorId: "debtor-ana",
      name: "Ana Souza",
      document: "52998224725",
      phone_number: "+5511999990001",
      email: null,
    };

    beforeEach(() => {
      mockApiClient.searchDebtors.mockReset();
      mockApiClient.searchDebtors.mockResolvedValue([ana]);
      mockApiClient.createDebtorInvoice.mockReset();
      mockApiClient.createDebtorInvoice.mockResolvedValue({});
      mockParams = new URLSearchParams("");
    });

    it("only accepts a registered client and links to Clientes to register a new one", async () => {
      render(<CobrancasPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Nova cobrança" }));

      expect(screen.queryByLabelText(/Nome do Devedor/i)).toBeNull();
      expect(screen.getByRole("link", { name: /Cadastrar novo cliente/ })).toHaveAttribute(
        "href",
        "/clientes?novo=1",
      );
      fireEvent.change(screen.getByLabelText("Buscar cliente"), {
        target: { value: "529.982" },
      });
      await waitFor(() =>
        expect(mockApiClient.searchDebtors).toHaveBeenLastCalledWith(
          "529.982",
          expect.any(AbortSignal),
        ),
      );

      fireEvent.click(screen.getByRole("button", { name: "Salvar Cobrança" }));
      expect(
        await within(screen.getByRole("dialog")).findByRole("alert"),
      ).toHaveTextContent("Escolha o cliente da cobrança.");
      expect(mockApiClient.createDebtorInvoice).not.toHaveBeenCalled();
    });

    it("creates the charge for the chosen client", async () => {
      const { container } = render(<CobrancasPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Nova cobrança" }));
      fireEvent.click(await screen.findByRole("option", { name: /Ana Souza/ }));
      expect(screen.getByText("529.982.247-25 · +55 (11) 99999-0001")).toBeInTheDocument();

      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "150" } });
      const dueDate = container.querySelector("input[type=date]") as HTMLInputElement;
      fireEvent.change(dueDate, { target: { value: "2026-11-10" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar Cobrança" }));

      await waitFor(() =>
        expect(mockApiClient.createDebtorInvoice).toHaveBeenCalledWith(
          "debtor-ana",
          expect.objectContaining({ original_amount: 150, due_date: "2026-11-10" }),
        ),
      );
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
      fireEvent.click(screen.getByRole("button", { name: "Nova cobrança" }));
      const dialog = screen.getByRole("dialog", { name: "Nova cobrança" });
      expect(within(dialog).queryByRole("option", { name: /^Boleto$/i })).not.toBeInTheDocument();
      expect(within(dialog).getByRole("option", { name: /Bolix/i }).closest("select")).toHaveValue(
        "BOLIX",
      );
    });
  });

  describe("Importação por planilha", () => {
    const newClient = (document: string, rows: number[], name: string) => ({
      document,
      rows,
      csv: { name, phone: "+5511999990001", email: null },
      optIn: false,
      phoneOwner: null,
      kind: "NEW",
    });

    beforeEach(() => {
      mockParams = new URLSearchParams("");
      mockApiClient.previewInvoiceImport.mockReset();
      mockApiClient.importInvoices.mockReset();
    });

    async function upload() {
      render(<CobrancasPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Importar planilha" }));
      fireEvent.click(screen.getByRole("button", { name: "Enviar planilha" }));
    }

    it("shows a summary and imports when no client needs review", async () => {
      mockApiClient.previewInvoiceImport.mockResolvedValue({
        clients: [newClient("52998224725", [0], "Ana Souza"), newClient("11144477735", [1], "Bruno")],
      });
      mockApiClient.importInvoices.mockResolvedValue({
        success: true,
        count: 2,
        initialChargeQueued: 0,
        skipped: [],
      });
      await upload();

      expect(await screen.findByText("2 de 2")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Importar 2 cobranças" }));

      await waitFor(() =>
        expect(mockApiClient.importInvoices).toHaveBeenCalledWith(mockRows, [], {
          send_now: true,
          send_channels: ["WHATSAPP"],
        }),
      );
      expect(await screen.findByText("2 cobranças importadas.")).toBeInTheDocument();
    });

    it("reviews a client with different data and leaves it out when asked", async () => {
      mockApiClient.previewInvoiceImport.mockResolvedValue({
        clients: [
          {
            ...newClient("52998224725", [0], "Ana Souza"),
            kind: "DIFFERENT",
            existing: {
              debtorId: "debtor-ana",
              document: "52998224725",
              name: "Ana Maria",
              phone: "+5511999990001",
              email: null,
              whatsappOptIn: false,
              version: "v1",
            },
            differences: ["name"],
          },
          newClient("11144477735", [1], "Bruno"),
        ],
      });
      await upload();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Não importar este cliente" }));

      expect(await screen.findByText(/Ficam de fora as cobranças de 1 cliente/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Importar 1 cobrança" }));
      await waitFor(() =>
        expect(mockApiClient.importInvoices).toHaveBeenCalledWith(
          mockRows,
          [{ document: "52998224725", action: "SKIP" }],
          { send_now: true, send_channels: ["WHATSAPP"] },
        ),
      );
    });

    it("sends the WhatsApp consent of every row when the user confirms it for all", async () => {
      mockApiClient.previewInvoiceImport.mockResolvedValue({
        clients: [newClient("52998224725", [0], "Ana Souza"), newClient("11144477735", [1], "Bruno")],
      });
      mockApiClient.importInvoices.mockResolvedValue({
        success: true,
        count: 2,
        initialChargeQueued: 0,
        skipped: [],
      });
      await upload();

      fireEvent.click(
        await screen.findByLabelText(/Todos os clientes desta planilha autorizaram/),
      );
      fireEvent.click(screen.getByRole("button", { name: "Importar 2 cobranças" }));
      await waitFor(() =>
        expect(mockApiClient.importInvoices).toHaveBeenCalledWith(
          mockRows.map((row) => ({ ...row, whatsapp_opt_in: true })),
          [],
          { send_now: true, send_channels: ["WHATSAPP"] },
        ),
      );
    });

    it("reviews again when the clients changed since the review", async () => {
      mockApiClient.previewInvoiceImport.mockResolvedValue({
        clients: [newClient("52998224725", [0, 1], "Ana Souza")],
      });
      mockApiClient.importInvoices.mockRejectedValue(
        Object.assign(new Error("Os cadastros de clientes mudaram desde a revisão."), {
          status: 409,
          data: { code: "IMPORT_CHANGED" },
        }),
      );
      await upload();

      fireEvent.click(await screen.findByRole("button", { name: "Importar 2 cobranças" }));
      expect(await screen.findByText(/mudaram desde a revisão/)).toBeInTheDocument();
      await waitFor(() => expect(mockApiClient.previewInvoiceImport).toHaveBeenCalledTimes(2));
    });
  });
});
