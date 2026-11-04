import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutFinanceOverview, CheckoutSale } from "@/lib/api-client";
import CheckoutSalesPage from "@/app/(dashboard)/checkout/vendas/page";
import { FinancePanel } from "../FinancePanel";

const mockApi = {
  getCheckoutBalance: jest.fn(),
  listCheckoutSales: jest.fn(),
  requestCheckoutRefund: jest.fn(),
  remindCheckoutRefundBuyer: jest.fn(),
  getCheckoutFinance: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const inAWeek = new Date(Date.now() + 6 * 86_400_000).toISOString();
const sale: CheckoutSale = {
  orderId: "order-1",
  status: "PAID",
  paidAt: "2026-11-04T15:00:00.000Z",
  buyer: { name: "Maria Souza", email: "maria@exemplo.test", phone: "11999999999" },
  items: [
    { kind: "MAIN", name: "Porquim Anual", unitPriceCents: 6700, discountCents: 670 },
    { kind: "BUMP", name: "Guia Renda Fixa", unitPriceCents: 1490, discountCents: 0 },
  ],
  paymentMethod: "PIX",
  installments: null,
  couponCode: null,
  utm: null,
  totalCents: 7611,
  efiFeeCents: 91,
  platformFeeCents: 188,
  refundedCents: 0,
  chargebackCents: 0,
  netCents: 7332,
  availableAt: "2026-11-11T15:00:00.000Z",
  openRefundRequest: null,
  refundedItemIndexes: [],
};
const balance = {
  releasedCents: 9000,
  suggestedPayoutCents: 7492,
  openRefundCents: 1508,
  pendingCents: 0,
  paidOutCents: 0,
  nextReleaseAt: null,
};

describe("Reembolso em Vendas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCheckoutBalance.mockResolvedValue(balance);
  });

  it("o vendedor pede o reembolso de um item só", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutSales.mockResolvedValue({ total: 1, page: 1, pageSize: 20, items: [sale] });
    mockApi.requestCheckoutRefund.mockResolvedValue({ id: "r1" });
    render(<CheckoutSalesPage />);

    await user.click(await screen.findByRole("button", { name: /pedir reembolso/i }));
    await user.click(screen.getByRole("checkbox", { name: /porquim anual/i }));
    await user.type(screen.getByLabelText("Motivo do reembolso"), "Cliente não quis o guia");
    await user.click(screen.getByRole("button", { name: /enviar pedido/i }));

    await waitFor(() =>
      expect(mockApi.requestCheckoutRefund).toHaveBeenCalledWith("order-1", "Cliente não quis o guia", [1]),
    );
  });

  it("pedido do comprador em retenção: prazo, WhatsApp sem link e reenvio do e-mail pela Cifra+", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutSales.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [
        {
          ...sale,
          openRefundRequest: {
            id: "r1",
            origin: "BUYER",
            createdAt: "2026-11-10T15:00:00.000Z",
            itemIndexes: [1],
            amountCents: 1508,
            holdUntil: inAWeek,
            buyerRemindedAt: null,
          },
        },
      ],
    });
    mockApi.remindCheckoutRefundBuyer.mockResolvedValue({ remindedAt: "2026-11-10T16:00:00.000Z" });
    render(<CheckoutSalesPage />);

    expect(await screen.findByText(/o comprador pediu reembolso de guia renda fixa/i)).toHaveTextContent("15,08");
    expect(screen.getByText(/você tem até/i)).toBeInTheDocument();
    const whatsapp = screen.getByRole("link", { name: /chamar no whatsapp/i });
    expect(whatsapp.getAttribute("href")).toContain("https://wa.me/5511999999999");
    // The seller never holds a link that withdraws the refund.
    expect(decodeURIComponent(whatsapp.getAttribute("href") ?? "")).not.toContain("/c/pedido/");
    expect(screen.queryByRole("button", { name: /pedir reembolso/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reenviar e-mail ao comprador/i }));
    await waitFor(() => expect(mockApi.remindCheckoutRefundBuyer).toHaveBeenCalledWith("order-1"));
    expect(await screen.findByRole("status")).toHaveTextContent(/reenviou o e-mail/i);
  });
});

describe("Reembolso no admin", () => {
  const overview = (holdUntil: string | null): CheckoutFinanceOverview => ({
    balance,
    refundRequests: [
      {
        id: "r1",
        origin: "BUYER",
        reason: "Não usei o guia",
        status: "REQUESTED",
        resolutionNote: null,
        createdAt: "2026-11-10T15:00:00.000Z",
        itemIndexes: [1],
        amountCents: 1508,
        holdUntil,
        order: {
          id: "order-1",
          buyerName: "Maria Souza",
          buyerEmail: "maria@exemplo.test",
          totalCents: 7611,
          paidAt: "2026-11-04T15:00:00.000Z",
          status: "PAID",
          items: [{ name: "Porquim Anual" }, { name: "Guia Renda Fixa" }],
        },
      },
    ],
    entries: [],
    chargebackIndex: { windowDays: 90, salesCount: 1, salesCents: 7611, chargebackCount: 0, chargebackCents: 0, ratioBasisPoints: 0 },
    sales: { total: 1, page: 1, pageSize: 50, items: [sale] },
  });

  beforeEach(() => jest.clearAllMocks());

  it("na retenção não registra a devolução; o repasse sugerido desconta o pedido aberto", async () => {
    mockApi.getCheckoutFinance.mockResolvedValue(overview(inAWeek));
    render(<FinancePanel companyId="company-1" />);

    expect(await screen.findByText(/em retenção até/i)).toBeInTheDocument();
    expect(screen.getByText(/itens: guia renda fixa/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /registrar devolução feita por fora/i })).toBeDisabled();
    expect(screen.getByText("Repasse sugerido").nextSibling).toHaveTextContent("74,92");
  });

  it("depois da retenção, o valor da devolução já vem com o valor do pedido", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutFinance.mockResolvedValue(overview(new Date(Date.now() - 60_000).toISOString()));
    render(<FinancePanel companyId="company-1" />);

    expect(await screen.findByText(/pronto para executar/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /registrar devolução feita por fora/i }));
    expect(screen.getByLabelText("Valor devolvido (R$)")).toHaveValue("15,08");
  });
});
