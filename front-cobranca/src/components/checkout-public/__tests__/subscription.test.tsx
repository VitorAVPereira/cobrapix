import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutPublicError, type PublicCheckoutSubscription } from "@/lib/checkout-public";
import { SubscriptionPage } from "../SubscriptionPage";

const mockGet = jest.fn();
const mockCancel = jest.fn();
jest.mock("@/lib/checkout-public", () => {
  const actual = jest.requireActual<typeof import("@/lib/checkout-public")>("@/lib/checkout-public");
  return {
    ...actual,
    getCheckoutSubscription: (...args: unknown[]) => mockGet(...args),
    cancelCheckoutSubscription: (...args: unknown[]) => mockCancel(...args),
  };
});

const active: PublicCheckoutSubscription = {
  status: "ACTIVE",
  productName: "Porquim",
  planName: "Trimestral",
  intervalMonths: 3,
  cycleCents: 3095,
  currentPeriodEnd: "2027-03-01T15:00:00.000Z",
  canceledAt: null,
  accessEndsAt: null,
  seller: { displayName: "Porquim", supportEmail: "suporte@porquim.test", supportWhatsapp: null },
};

describe("Página da assinatura", () => {
  beforeEach(() => jest.clearAllMocks());

  it("mostra o valor e a próxima cobrança; cancelar pede confirmação e mantém o acesso até o fim do período", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(active);
    mockCancel.mockResolvedValue({
      ...active,
      status: "CANCELED",
      canceledAt: "2026-12-01T15:00:00.000Z",
      accessEndsAt: "2027-03-01T15:00:00.000Z",
    });
    render(<SubscriptionPage token="token-assinatura" />);

    expect(await screen.findByText("Ativa")).toBeInTheDocument();
    expect(screen.getByText(/30,95 por trimestre/)).toBeInTheDocument();
    expect(screen.getByText("01/03/2027")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancelar assinatura/i }));
    expect(mockCancel).not.toHaveBeenCalled();
    expect(screen.getByText(/continua com acesso até 01\/03\/2027/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirmar cancelamento/i }));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("token-assinatura"));
    expect(await screen.findByRole("status")).toHaveTextContent(/não será cobrada de novo/);
    expect(screen.getByText("Acesso até")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancelar assinatura/i })).not.toBeInTheDocument();
  });

  it("falha ao cancelar mostra o erro e a assinatura continua", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(active);
    mockCancel.mockRejectedValue(new Error("Não foi possível cancelar agora. Tente de novo em instantes."));
    render(<SubscriptionPage token="token-assinatura" />);

    await user.click(await screen.findByRole("button", { name: /cancelar assinatura/i }));
    await user.click(screen.getByRole("button", { name: /confirmar cancelamento/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/tente de novo/i);
    expect(screen.getByText("Ativa")).toBeInTheDocument();
  });

  it("link desconhecido não vira erro genérico; falha de rede não diz que não existe", async () => {
    mockGet.mockRejectedValueOnce(new CheckoutPublicError("não encontrada", 404, null));
    const { unmount } = render(<SubscriptionPage token="token-ruim" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/não encontramos esta assinatura/i);
    unmount();

    mockGet.mockRejectedValueOnce(new Error("offline"));
    render(<SubscriptionPage token="token-assinatura" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível carregar/i);
  });
});
