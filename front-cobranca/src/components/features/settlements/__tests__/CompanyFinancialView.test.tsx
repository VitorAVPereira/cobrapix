import { render, screen } from "@testing-library/react";
import { CompanyFinancialView } from "../CompanyFinancialView";

const mockApi = {
  getFinancialProfile: jest.fn(),
  getCompanyReceipts: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

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
    { invoiceId: "i-1", debtorName: "Maria", billingMethod: "PIX", paidAt: "2026-09-20T12:00:00Z", grossAmountCents: 10000, paidAmountCents: 10000, efiFeeCents: 100, efiFeeEstimated: true, platformFeeCents: 250, refundedCents: 0, netCents: 9650, situation: "RECEIVED" },
    { invoiceId: "i-2", debtorName: "João", billingMethod: "BOLIX", paidAt: "2026-09-21T12:00:00Z", grossAmountCents: 10000, paidAmountCents: 10000, efiFeeCents: 100, efiFeeEstimated: false, platformFeeCents: 250, refundedCents: 0, netCents: 9650, situation: "IN_REVIEW" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCompanyReceipts.mockResolvedValue(receipts);
});

it("shows the company's own receipts, read-only, with its account masked", async () => {
  mockApi.getFinancialProfile.mockResolvedValue({ openingEnabled: false, canIssue: true, status: "ACTIVE", accountMode: "CUSTOMER_ACCOUNT", enabledMethods: ["PIX", "BOLIX"], activatedAt: "2026-09-01T00:00:00Z", issuerAccount: "••••1234" });
  render(<CompanyFinancialView />);
  expect(await screen.findByText(/Conta Efí da própria empresa · conta ••••1234/)).toBeInTheDocument();
  expect(screen.getByText("R$ 193,00")).toBeInTheDocument();
  expect(screen.getByText("Em análise pela CifraMais")).toBeInTheDocument();
  expect(screen.getByText("estimada")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /salvar|alterar|registrar/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("explains a pending activation", async () => {
  mockApi.getFinancialProfile.mockResolvedValue({ openingEnabled: false, canIssue: false, status: "PENDING", accountMode: null, enabledMethods: [], activatedAt: null, issuerAccount: null });
  mockApi.getCompanyReceipts.mockResolvedValue({ ...receipts, total: 0, data: [], totals: { ...receipts.totals, receivedCents: 0 } });
  render(<CompanyFinancialView />);
  expect(await screen.findByText(/Ativação financeira pendente/)).toBeInTheDocument();
  expect(screen.getByText("Nenhum recebimento ainda.")).toBeInTheDocument();
});
