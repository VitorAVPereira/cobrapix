import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CardCheckout from "./CardCheckout";
const mockCardData = jest.fn();
const mockToken = jest.fn();
jest.mock("payment-token-efi", () => {
  const card = {
    setAccount: jest.fn().mockReturnThis(),
    setEnvironment: jest.fn().mockReturnThis(),
    setCreditCardData: (...args: unknown[]) => {
      mockCardData(...args);
      return card;
    },
    getPaymentToken: () => mockToken(),
  };
  return { __esModule: true, default: { CreditCard: card } };
});
const quote = {
  quoteId: "quote",
  validUntil: "2099-01-01T00:00:00Z",
  payeeCode: "issuer",
  environment: "sandbox",
  amounts: {
    principalCents: 10000,
    discountCents: 1000,
    lateFineCents: 200,
    lateInterestCents: 50,
    baseDebtCents: 9250,
  },
  options: [
    {
      installments: 1,
      totalCents: 9550,
      installmentValueCents: 9550,
      efiFeeCents: 300,
    },
    {
      installments: 6,
      totalCents: 9900,
      installmentValueCents: 1650,
      efiFeeCents: 650,
    },
  ],
};
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue(response(quote));
  mockToken.mockResolvedValue({ payment_token: "single-use-token" });
  Object.defineProperty(global.crypto, "randomUUID", {
    configurable: true,
    value: () => "confirm-key-123456789",
  });
});
async function simulate() {
  fireEvent.click(screen.getByRole("button", { name: "Simular pagamento" }));
  await screen.findByLabelText("Parcelamento");
}
function fill() {
  const values: Record<string, string> = {
    "Nome completo do titular": "Maria Silva",
    "CPF do titular (somente números)": "52998224725",
    "E-mail": "maria@example.test",
    "Telefone com DDD (somente números)": "11999999999",
    "Data de nascimento": "1990-01-01",
    "CEP (somente números)": "01001000",
    Rua: "Rua A",
    Número: "1",
    Bairro: "Centro",
    Cidade: "São Paulo",
    UF: "SP",
    "Número do cartão": "4111111111111111",
    "Mês de validade (MM)": "12",
    "Ano de validade (AAAA)": "2099",
    "Código de segurança": "123",
  };
  Object.entries(values).forEach(([label, value]) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } }),
  );
}
it("shows the complete total and no installment above six", async () => {
  render(<CardCheckout signedToken="signed" onRefresh={jest.fn()} />);
  await simulate();
  expect(screen.getByText("Desconto")).toBeInTheDocument();
  expect(screen.getByText("Multa")).toBeInTheDocument();
  expect(screen.getByText("Juros por atraso")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /6x de/ })).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: /7x de/ }),
  ).not.toBeInTheDocument();
});
it("sends only a single-use token to the API and locks an uncertain confirmation", async () => {
  const refresh = jest.fn();
  const fetcher = global.fetch as jest.Mock;
  fetcher
    .mockResolvedValueOnce(response(quote))
    .mockRejectedValueOnce(new Error("network"));
  render(<CardCheckout signedToken="signed" onRefresh={refresh} />);
  await simulate();
  fill();
  fireEvent.submit(
    screen
      .getByRole("button", { name: /Confirmar pagamento/ })
      .closest("form")!,
  );
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(mockCardData).toHaveBeenCalledWith(
    expect.objectContaining({
      number: "4111111111111111",
      cvv: "123",
      reuse: false,
    }),
  );
  const request = fetcher.mock.calls[1][1];
  const body = JSON.parse(request.body);
  expect(body.paymentToken).toBe("single-use-token");
  expect(request.body).not.toContain("4111111111111111");
  expect(body).not.toHaveProperty("cvv");
  expect(request.headers["Idempotency-Key"]).toBe("confirm-key-123456789");
  expect(
    screen.queryByRole("button", { name: /Confirmar pagamento/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "A confirmação não chegou",
  );
});
it("allows an explicit new simulation after a confirmed refusal", async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(response(quote))
    .mockResolvedValueOnce(response({ state: "DECLINED", canRetry: true }));
  render(<CardCheckout signedToken="signed" onRefresh={jest.fn()} />);
  await simulate();
  fill();
  fireEvent.submit(
    screen
      .getByRole("button", { name: /Confirmar pagamento/ })
      .closest("form")!,
  );
  await screen.findByText(/O pagamento não foi autorizado/);
  expect(
    screen.getByRole("button", { name: "Simular pagamento" }),
  ).toBeEnabled();
});
