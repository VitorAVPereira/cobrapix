import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanyFinancialView } from "../CompanyFinancialView";

const mockApi = {
  getFinancialProfile: jest.fn(),
  getCompanyReceipts: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const replace = jest.fn();
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => mockParams,
  usePathname: () => "/financeiro",
}));

const receipts = {
  totals: {
    receivedCents: 20000,
    efiFeeCents: 200,
    platformFeeCents: 500,
    refundedCents: 0,
    platformFeeReversalCents: 0,
    netCents: 19300,
  },
  total: 2,
  page: 1,
  pageSize: 20,
  data: [
    { invoiceId: "i-1", debtorName: "Maria", debtorDocument: "52998224725", billingMethod: "PIX", paidAt: "2026-09-20T12:00:00Z", grossAmountCents: 10000, paidAmountCents: 10000, efiFeeCents: 100, efiFeeEstimated: true, platformFeeCents: 250, refundedCents: 0, netCents: 9650, situation: "RECEIVED" },
    { invoiceId: "i-2", debtorName: "João", debtorDocument: null, billingMethod: "BOLIX", paidAt: "2026-09-21T12:00:00Z", grossAmountCents: 10000, paidAmountCents: 10000, efiFeeCents: 100, efiFeeEstimated: false, platformFeeCents: 250, refundedCents: 0, netCents: 9650, situation: "IN_REVIEW" },
  ],
};

const activeProfile = { openingEnabled: false, canIssue: true, status: "ACTIVE", accountMode: "CUSTOMER_ACCOUNT", enabledMethods: ["PIX", "BOLIX"], activatedAt: "2026-09-01T00:00:00Z", issuerAccount: "••••1234" };

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = new URLSearchParams();
  mockApi.getFinancialProfile.mockResolvedValue(activeProfile);
  mockApi.getCompanyReceipts.mockResolvedValue(receipts);
});

it("shows the company's own receipts, read-only, with its account masked", async () => {
  render(<CompanyFinancialView />);
  expect(await screen.findByText(/Conta Efí da própria empresa · conta ••••1234 · Pix, Bolix/)).toBeInTheDocument();
  const table = await screen.findByRole("table");
  expect(within(table).getByText("529.982.247-25")).toBeInTheDocument();
  expect(within(table).getByText("Bolix")).toBeInTheDocument();
  expect(within(table).getByText("Em análise")).toHaveAttribute("title", "Em análise pela CifraMais");
  expect(within(table).getByText("estimada")).toBeInTheDocument();
  expect(within(screen.getByLabelText("Totais")).getByText("R$ 193,00")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /salvar|alterar|registrar/i })).not.toBeInTheDocument();
});

it("opens on the current month", async () => {
  render(<CompanyFinancialView />);
  await waitFor(() =>
    expect(mockApi.getCompanyReceipts).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, period: "month" }),
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByLabelText("Filtrar por data do pagamento")).toHaveValue("month");
});

it("sends the filters of the URL, and the whole history for period=all", async () => {
  mockParams = new URLSearchParams("search=Maria&situation=REFUNDED&billingType=BOLETO&period=all&page=2&pageSize=50");
  render(<CompanyFinancialView />);
  await waitFor(() =>
    expect(mockApi.getCompanyReceipts).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 50,
        search: "Maria",
        situation: "REFUNDED",
        billingType: "BOLETO",
        period: undefined,
        startDate: undefined,
        endDate: undefined,
      },
      expect.any(AbortSignal),
    ),
  );
});

it("explains a pending activation and offers the whole history for an empty month", async () => {
  mockApi.getFinancialProfile.mockResolvedValue({ openingEnabled: false, canIssue: false, status: "PENDING", accountMode: null, enabledMethods: [], activatedAt: null, issuerAccount: null });
  mockApi.getCompanyReceipts.mockResolvedValue({ ...receipts, total: 0, data: [], totals: { ...receipts.totals, receivedCents: 0 } });
  render(<CompanyFinancialView />);
  expect(await screen.findByText(/Ativação financeira pendente/)).toBeInTheDocument();
  expect(await screen.findByText("Nenhum recebimento neste mês.")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Ver todo o histórico" }));
  expect(replace).toHaveBeenCalledWith("/financeiro?period=all", { scroll: false });
});

it("tells a failure apart from an empty list and hides totals it could not load", async () => {
  mockApi.getCompanyReceipts.mockRejectedValueOnce(new Error("offline"));
  render(<CompanyFinancialView />);
  expect(await screen.findByText("Não foi possível carregar os recebimentos.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Totais")).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
});

it("still shows the receipts when the account cannot be loaded", async () => {
  mockApi.getFinancialProfile.mockRejectedValue(new Error("offline"));
  render(<CompanyFinancialView />);
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.queryByLabelText("Conta de recebimento")).toBeNull();
});
