import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettlementsAdmin } from "../SettlementsAdmin";
import type {
  SettlementDetail,
  SettlementList,
  SettlementSummary,
} from "@/lib/settlements";

const mockApi = {
  getSettlements: jest.fn(),
  getSettlementSummary: jest.fn(),
  getSettlement: jest.fn(),
  recordPlatformFeeEvidence: jest.fn(),
  resolveSettlementDivergence: jest.fn(),
  updateSettlementOptions: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const totals = {
  paymentCents: 10000,
  efiFeeCents: 100,
  platformFeeCents: 250,
  refundedCents: 0,
  platformFeeReversalCents: 0,
  duplicatePaymentsCents: 0,
  customerNetCents: 9650,
};
const list: SettlementList = {
  total: 2,
  page: 1,
  pageSize: 50,
  data: [
    {
      id: "s-1",
      companyId: "company-1",
      companyName: "Alfa",
      invoiceId: "invoice-1-abcdef",
      paymentChargeId: "charge-1",
      billingMethod: "PIX",
      status: "AWAITING_EVIDENCE",
      evidenceStatus: "PENDING",
      grossAmountCents: 10000,
      paidAmountCents: 10000,
      paidAt: "2026-09-20T12:00:00Z",
      platformFeeDueCents: 250,
      totals,
      openDivergences: [],
    },
    {
      id: "s-2",
      companyId: "company-1",
      companyName: "Alfa",
      invoiceId: "invoice-2-abcdef",
      paymentChargeId: "charge-2",
      billingMethod: "PIX",
      status: "DIVERGENT",
      evidenceStatus: "CONFIRMED",
      grossAmountCents: 10000,
      paidAmountCents: 9000,
      paidAt: "2026-09-21T12:00:00Z",
      platformFeeDueCents: 225,
      totals: { ...totals, paymentCents: 9000 },
      openDivergences: [
        { id: "d-1", code: "PAYMENT_BELOW_CHARGE", amountCents: 1000 },
      ],
    },
  ],
};
const summary: SettlementSummary = {
  options: { refundPlatformFeeOnRefund: false },
  settlements: { AWAITING_EVIDENCE: 1, DIVERGENT: 1 },
  receivedCents: 19000,
  efiFeeCents: 200,
  efiFeeEstimatedCents: 200,
  platformFeeCents: 475,
  refundedCents: 0,
  platformFeeReversalCents: 0,
  duplicatePaymentsCents: 0,
  platformFeeAwaitingEvidenceCents: 250,
  platformFeeEvidencedCents: 225,
  openDivergences: [
    { code: "PAYMENT_BELOW_CHARGE", count: 1, amountCents: 1000 },
  ],
};
const detail: SettlementDetail = {
  id: "s-2",
  companyId: "company-1",
  invoiceId: "invoice-2-abcdef",
  status: "DIVERGENT",
  evidenceStatus: "CONFIRMED",
  platformFeeDueCents: 225,
  paymentCharge: {
    billingMethod: "PIX",
    grossAmountCents: 10000,
    paidAmountCents: 9000,
    paidAt: "2026-09-21T12:00:00Z",
    status: "PAID",
    company: { corporateName: "Alfa" },
  },
  ledgerEntries: [
    {
      id: "l-1",
      kind: "PAYMENT",
      amountCents: 9000,
      estimated: false,
      source: "PROVIDER_WEBHOOK",
      evidenceReference: "E2E",
      occurredAt: "2026-09-21T12:00:00Z",
    },
    {
      id: "l-2",
      kind: "EFI_FEE",
      amountCents: -100,
      estimated: true,
      source: "PROVIDER_WEBHOOK",
      evidenceReference: "E2E",
      occurredAt: "2026-09-21T12:00:00Z",
    },
  ],
  divergences: [
    {
      id: "d-1",
      code: "PAYMENT_BELOW_CHARGE",
      reference: "",
      amountCents: 1000,
      status: "OPEN",
      decision: null,
      decisionReference: null,
      decisionNote: null,
      complementaryInvoiceId: null,
      resolvedAt: null,
      detectedAt: "2026-09-21T12:00:00Z",
    },
  ],
  platformFeeEvidence: null,
  totals: { ...totals, paymentCents: 9000 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getSettlements.mockResolvedValue(list);
  mockApi.getSettlementSummary.mockResolvedValue(summary);
  mockApi.getSettlement.mockResolvedValue(detail);
});

it("shows what CifraMais must reconcile, never a payout balance", async () => {
  render(<SettlementsAdmin companyId="company-1" />);
  expect(
    await screen.findByText("Remuneração a comprovar"),
  ).toBeInTheDocument();
  expect(screen.getByText("Saldo a conciliar")).toBeInTheDocument();
  expect(
    screen.queryByText(/disponível para repasse/i),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Nada nesta tela transfere dinheiro/),
  ).toBeInTheDocument();
  expect(mockApi.getSettlements).toHaveBeenCalledWith({
    companyId: "company-1",
    status: undefined,
    page: 1,
    pageSize: 50,
  });
});

it("selects only settlements awaiting evidence and sends the statement in cents", async () => {
  const user = userEvent.setup();
  mockApi.recordPlatformFeeEvidence.mockResolvedValue({
    id: "e-1",
    reference: "extrato-1",
    receivedAmountCents: 250,
    expectedAmountCents: 250,
    matched: true,
    settlementIds: ["s-1"],
  });
  render(<SettlementsAdmin />);
  const boxes = await screen.findAllByRole("checkbox", {
    name: /Selecionar cobrança/,
  });
  expect(boxes[1]).toBeDisabled();
  await user.click(boxes[0]);
  const form = screen.getByRole("form", { name: "Comprovar remuneração" });
  expect(within(form).getByText("R$ 2,50")).toBeInTheDocument();
  await user.type(
    within(form).getByLabelText("Referência no extrato"),
    "extrato-1",
  );
  await user.type(within(form).getByLabelText("Valor recebido (R$)"), "2,50");
  await user.click(
    within(form).getByRole("button", { name: "Registrar comprovação" }),
  );
  await waitFor(() =>
    expect(mockApi.recordPlatformFeeEvidence).toHaveBeenCalledWith({
      settlementIds: ["s-1"],
      reference: "extrato-1",
      receivedAmountCents: 250,
      note: undefined,
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "conferem com a remuneração esperada",
  );
});

it("shows a conflict from the server and reloads", async () => {
  const user = userEvent.setup();
  mockApi.recordPlatformFeeEvidence.mockRejectedValue(
    Object.assign(new Error("x"), {
      status: 409,
      data: { message: "Há cobranças que não aguardam conferência." },
    }),
  );
  render(<SettlementsAdmin />);
  const [first] = await screen.findAllByRole("checkbox", {
    name: /Selecionar cobrança/,
  });
  await user.click(first);
  await user.type(screen.getByLabelText("Referência no extrato"), "extrato-2");
  await user.type(screen.getByLabelText("Valor recebido (R$)"), "2,50");
  await user.click(
    screen.getByRole("button", { name: "Registrar comprovação" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "não aguardam conferência",
  );
  expect(mockApi.getSettlements).toHaveBeenCalledTimes(2);
});

it("decides a divergence with the fields that decision requires", async () => {
  const user = userEvent.setup();
  mockApi.resolveSettlementDivergence.mockResolvedValue({
    ...detail.divergences[0],
    status: "RESOLVED",
    complementaryInvoiceId: "invoice-3",
  });
  render(<SettlementsAdmin />);
  const buttons = await screen.findAllByRole("button", { name: "Detalhes" });
  await user.click(buttons[1]);
  const form = await screen.findByRole("form", {
    name: "Pago abaixo do valor",
  });
  expect(within(form).getByLabelText("Motivo")).toBeRequired();
  await user.selectOptions(
    within(form).getByLabelText("Decisão"),
    "ISSUE_COMPLEMENTARY",
  );
  expect(within(form).queryByLabelText("Motivo")).not.toBeInTheDocument();
  await user.type(
    within(form).getByLabelText("Vencimento da fatura complementar"),
    "2026-10-10",
  );
  await user.click(
    within(form).getByRole("button", { name: "Registrar decisão" }),
  );
  await waitFor(() =>
    expect(mockApi.resolveSettlementDivergence).toHaveBeenCalledWith("d-1", {
      decision: "ISSUE_COMPLEMENTARY",
      reference: undefined,
      note: undefined,
      dueDate: "2026-10-10",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "fatura complementar",
  );
});

it("shows access denied without data", async () => {
  mockApi.getSettlements.mockRejectedValue(
    Object.assign(new Error("Forbidden"), {
      status: 403,
      data: { message: "Acesso restrito ao admin da plataforma." },
    }),
  );
  render(<SettlementsAdmin />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Acesso restrito");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
