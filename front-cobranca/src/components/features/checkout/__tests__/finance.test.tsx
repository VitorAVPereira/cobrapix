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
  getCheckoutFinance: jest.fn(),
  recordCheckoutPayout: jest.fn(),
  recordCheckoutOrderMoney: jest.fn(),
  recordCheckoutAdjustment: jest.fn(),
  rejectCheckoutRefundRequest: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const sale: CheckoutSale = {
  orderId: "order-1",
  status: "PAID",
  paidAt: "2026-11-04T15:00:00.000Z",
  buyer: { name: "Maria Souza", email: "maria@exemplo.test", phone: "11999999999" },
  items: [{ kind: "MAIN", name: "Porquim Anual", unitPriceCents: 6700, discountCents: 0 }],
  paymentMethod: "PIX",
  installments: null,
  couponCode: null,
  utm: { utm_source: "LINK_PADRAO" },
  totalCents: 6700,
  efiFeeCents: 80,
  platformFeeCents: 168,
  refundedCents: 0,
  chargebackCents: 0,
  netCents: 6452,
  availableAt: "2026-11-11T15:00:00.000Z",
  openRefundRequest: null,
};
const balance = { releasedCents: 5000, pendingCents: 6452, paidOutCents: 0, nextReleaseAt: "2026-11-11T15:00:00.000Z" };

describe("Vendas do vendedor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCheckoutBalance.mockResolvedValue(balance);
    mockApi.listCheckoutSales.mockResolvedValue({ total: 1, page: 1, pageSize: 20, items: [sale] });
  });

  it("mostra saldo, tarifas, líquido e a origem da venda", async () => {
    render(<CheckoutSalesPage />);

    expect(await screen.findByText("Porquim Anual")).toBeInTheDocument();
    expect(screen.getByText("A liberar")).toBeInTheDocument();
    expect(screen.getByText(/origem LINK_PADRAO/)).toBeInTheDocument();
    // Pending balance and the sale net are both R$ 64,52 here.
    expect(screen.getAllByText(/64,52/)).toHaveLength(2);
    expect(mockApi.listCheckoutSales).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, from: expect.any(String) as string }),
      expect.any(AbortSignal),
    );
  });

  it("pede reembolso com o motivo e recarrega a lista", async () => {
    const user = userEvent.setup();
    mockApi.requestCheckoutRefund.mockResolvedValue({ id: "r1" });
    render(<CheckoutSalesPage />);

    await user.click(await screen.findByRole("button", { name: /pedir reembolso/i }));
    await user.type(screen.getByLabelText("Motivo do reembolso"), "Cliente desistiu");
    await user.click(screen.getByRole("button", { name: /enviar pedido/i }));

    expect(mockApi.requestCheckoutRefund).toHaveBeenCalledWith("order-1", "Cliente desistiu");
    expect(await screen.findByRole("status")).toHaveTextContent(/pedido de reembolso enviado/i);
    await waitFor(() => expect(mockApi.listCheckoutSales).toHaveBeenCalledTimes(2));
  });

  it("falha ao carregar não vira lista vazia", async () => {
    mockApi.listCheckoutSales.mockRejectedValue(new Error("offline"));
    render(<CheckoutSalesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.queryByText(/nenhuma venda/i)).not.toBeInTheDocument();
  });
});

describe("Financeiro do cliente no admin", () => {
  const overview: CheckoutFinanceOverview = {
    balance,
    refundRequests: [
      {
        id: "r1",
        origin: "BUYER",
        reason: "Não era o que eu esperava",
        status: "REQUESTED",
        resolutionNote: null,
        createdAt: "2026-11-05T10:00:00.000Z",
        order: {
          id: "order-1",
          buyerName: "Maria Souza",
          buyerEmail: "maria@exemplo.test",
          totalCents: 6700,
          paidAt: "2026-11-04T15:00:00.000Z",
          status: "PAID",
        },
      },
    ],
    entries: [],
    chargebackIndex: { windowDays: 90, salesCount: 1, salesCents: 6700, chargebackCount: 0, chargebackCents: 0, ratioBasisPoints: 0 },
    sales: { total: 1, page: 1, pageSize: 50, items: [sale] },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCheckoutFinance.mockResolvedValue(overview);
  });

  it("registra repasse com a chave da tela e mostra o aviso de saldo negativo", async () => {
    const user = userEvent.setup();
    mockApi.recordCheckoutPayout.mockResolvedValue({
      warning: "O repasse passou do saldo liberado. O saldo do vendedor ficou negativo.",
      balance,
    });
    render(<FinancePanel companyId="company-1" />);

    const amounts = await screen.findAllByLabelText("Valor (R$)");
    await user.type(amounts[0] as HTMLElement, "60,00");
    await user.click(screen.getByRole("button", { name: /registrar repasse/i }));

    await waitFor(() =>
      expect(mockApi.recordCheckoutPayout).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({ amountCents: 6000, idempotencyKey: expect.any(String) as string }),
      ),
    );
    expect(await screen.findByText(/saldo do vendedor ficou negativo/i)).toBeInTheDocument();
  });

  it("recusa um pedido de reembolso com motivo", async () => {
    const user = userEvent.setup();
    mockApi.rejectCheckoutRefundRequest.mockResolvedValue(undefined);
    render(<FinancePanel companyId="company-1" />);

    await user.click(await screen.findByRole("button", { name: /recusar/i }));
    await user.type(screen.getByLabelText("Motivo da recusa"), "Comprador desistiu do pedido");
    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    expect(mockApi.rejectCheckoutRefundRequest).toHaveBeenCalledWith("company-1", "r1", "Comprador desistiu do pedido");
  });
});
