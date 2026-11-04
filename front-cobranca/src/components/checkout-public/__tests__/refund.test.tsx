import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicCheckoutOrder } from "@/lib/checkout-public";
import { RefundRequestPage } from "../RefundRequestPage";

const mockGetOrder = jest.fn();
const mockRequestRefund = jest.fn();
const mockWithdraw = jest.fn();
jest.mock("@/lib/checkout-public", () => {
  const actual = jest.requireActual<typeof import("@/lib/checkout-public")>("@/lib/checkout-public");
  return {
    ...actual,
    getCheckoutOrder: (...args: unknown[]) => mockGetOrder(...args),
    requestCheckoutRefund: (...args: unknown[]) => mockRequestRefund(...args),
    withdrawCheckoutRefund: (...args: unknown[]) => mockWithdraw(...args),
  };
});

function paid(change: Partial<PublicCheckoutOrder> = {}): PublicCheckoutOrder {
  return {
    token: "token",
    productSlug: "porquim-anual-ab12",
    status: "PAID",
    paymentMethod: "PIX",
    installments: null,
    processing: false,
    card: null,
    expiresAt: new Date().toISOString(),
    items: [
      { kind: "MAIN", name: "Porquim Anual", unitPriceCents: 6700, discountCents: 670, accessUrl: null, accessInstructions: null, refundCents: 6103 },
      { kind: "BUMP", name: "Guia Renda Fixa", unitPriceCents: 1490, discountCents: 0, accessUrl: null, accessInstructions: null, refundCents: 1508 },
    ],
    refund: { open: null, refundedItemIndexes: [] },
    subtotalCents: 7520,
    discountCents: 670,
    surchargeCents: 91,
    totalCents: 7611,
    pix: null,
    redirectUrl: null,
    page: null,
    ...change,
  };
}

describe("Reembolso do comprador", () => {
  beforeEach(() => jest.clearAllMocks());

  it("devolve só um item, com o valor dele já com o acréscimo", async () => {
    const user = userEvent.setup();
    mockGetOrder.mockResolvedValue(paid());
    mockRequestRefund.mockResolvedValue({ id: "r1", status: "REQUESTED" });
    render(<RefundRequestPage token="token" />);

    await user.click(await screen.findByRole("checkbox", { name: /porquim anual/i }));
    expect(screen.getByText(/valor a devolver/i)).toHaveTextContent("15,08");
    await user.type(screen.getByLabelText("Conte o motivo"), "Não usei o guia");
    await user.click(screen.getByRole("button", { name: /enviar pedido de reembolso/i }));

    await waitFor(() => expect(mockRequestRefund).toHaveBeenCalledWith("token", "Não usei o guia", [1]));
  });

  it("item já reembolsado não pode ser escolhido de novo", async () => {
    mockGetOrder.mockResolvedValue(paid({ refund: { open: null, refundedItemIndexes: [1] } }));
    render(<RefundRequestPage token="token" />);

    expect(await screen.findByRole("checkbox", { name: /guia renda fixa/i })).toBeDisabled();
    expect(screen.getByText(/já reembolsado/i)).toBeInTheDocument();
  });

  it("pedido aberto mostra o prazo do vendedor e o comprador desiste com confirmação", async () => {
    const user = userEvent.setup();
    mockGetOrder.mockResolvedValueOnce(
      paid({
        refund: {
          open: { itemIndexes: [1], amountCents: 1508, holdUntil: "2026-11-17T15:00:00.000Z", createdAt: "2026-11-10T15:00:00.000Z" },
          refundedItemIndexes: [],
        },
      }),
    );
    mockGetOrder.mockResolvedValueOnce(paid());
    mockWithdraw.mockResolvedValue({ id: "r1", status: "WITHDRAWN" });
    render(<RefundRequestPage token="token" />);

    expect(await screen.findByText(/reembolso de guia renda fixa/i)).toHaveTextContent("15,08");
    expect(screen.getByText(/o vendedor pode falar com você até 17\/11\/2026/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Desistir do reembolso" }));
    await user.click(screen.getByRole("button", { name: "Sim, desistir" }));

    await waitFor(() => expect(mockWithdraw).toHaveBeenCalledWith("token"));
    expect(await screen.findByRole("status")).toHaveTextContent(/sua compra continua valendo/i);
  });
});
