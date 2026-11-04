import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicCheckoutOrder, PublicCheckoutProduct } from "@/lib/checkout-public";
import { CheckoutForm } from "../CheckoutForm";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockQuote = jest.fn();
const mockCardQuote = jest.fn();
const mockCardOrder = jest.fn();
const mockCardPay = jest.fn();
jest.mock("@/lib/checkout-public", () => {
  const actual = jest.requireActual<typeof import("@/lib/checkout-public")>("@/lib/checkout-public");
  return {
    ...actual,
    quoteCheckout: (...args: unknown[]) => mockQuote(...args),
    quoteCheckoutCard: (...args: unknown[]) => mockCardQuote(...args),
    createCheckoutCardOrder: (...args: unknown[]) => mockCardOrder(...args),
    payCheckoutCard: (...args: unknown[]) => mockCardPay(...args),
    saveCheckoutLead: () => Promise.resolve({ saved: true }),
  };
});
const mockTokenize = jest.fn();
jest.mock("@/lib/checkout-card", () => ({
  detectCardBrand: () => Promise.resolve("visa"),
  tokenizeCard: (...args: unknown[]) => mockTokenize(...args),
  lookupCep: () => Promise.resolve({ street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", state: "SP" }),
}));

const product: PublicCheckoutProduct = {
  available: true,
  unavailableMessage: null,
  product: {
    slug: "porquim-anual-ab12",
    name: "Porquim Anual",
    description: null,
    priceCents: 10000,
    compareAtPriceCents: null,
    imageUrl: null,
    accessPeriodMonths: 12,
  },
  bumps: [],
  page: {
    displayName: "Porquim",
    logoUrl: null,
    bannerUrl: null,
    primaryColor: "#0F766E",
    supportEmail: null,
    supportWhatsapp: null,
    whatsappButtonPhone: null,
  },
  payment: { pixEnabled: true, cardEnabled: true, maxInstallments: 12 },
};

function order(change: Partial<PublicCheckoutOrder>): PublicCheckoutOrder {
  return {
    token: "token-card",
    productSlug: "porquim-anual-ab12",
    status: "PENDING",
    paymentMethod: "CARD",
    installments: 3,
    processing: false,
    card: { declined: false, canRetry: true },
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    items: [],
    subtotalCents: 10000,
    discountCents: 0,
    surchargeCents: 600,
    totalCents: 10600,
    pix: null,
    redirectUrl: null,
    page: null,
    ...change,
  };
}

async function fillCard(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nome completo"), "Maria Souza");
  await user.type(screen.getByLabelText("E-mail"), "maria@exemplo.test");
  await user.type(screen.getByLabelText("CPF ou CNPJ"), "529.982.247-25");
  await user.type(screen.getByLabelText("Celular com DDD"), "11999999999");
  await user.click(screen.getByLabelText("Cartão"));
  await user.type(screen.getByLabelText("Número do cartão"), "4111111111111111");
  await user.type(screen.getByLabelText("Nome impresso no cartão"), "MARIA SOUZA");
  await user.type(screen.getByLabelText("Validade (MM/AA)"), "12/40");
  await user.type(screen.getByLabelText("Código de segurança"), "123");
  await user.type(screen.getByLabelText("CEP"), "01001000");
  await user.type(screen.getByLabelText("Número do endereço"), "10");
}

describe("Cartão na página de pagamento", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mockQuote.mockResolvedValue({
      items: [{ kind: "MAIN", name: "Porquim Anual", unitPriceCents: 10000, discountCents: 0 }],
      couponCode: null,
      discountCents: 0,
      subtotalCents: 10000,
      surchargeCents: 0,
      totalCents: 10000,
    });
    mockCardQuote.mockResolvedValue({
      quoteId: "quote-1",
      validUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      payeeCode: "payee-cifra",
      environment: "sandbox",
      subtotalCents: 10000,
      options: [
        { installments: 1, installmentValueCents: 10309, totalCents: 10309 },
        { installments: 3, installmentValueCents: 3534, totalCents: 10602 },
      ],
    });
    mockTokenize.mockResolvedValue("tok_abc");
  });

  it("parcelas vêm do servidor, o endereço vem do CEP e o cartão vai só para a Efí", async () => {
    const user = userEvent.setup();
    mockCardOrder.mockResolvedValue(order({ processing: true }));
    render(<CheckoutForm data={product} />);
    await screen.findByTestId("checkout-total");

    await fillCard(user);
    await user.selectOptions(await screen.findByLabelText("Parcelas"), "3");
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("106,02");
    expect(screen.getByLabelText("Cidade")).toHaveValue("São Paulo");

    await user.click(screen.getByRole("button", { name: /pagar com cartão/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/c/pedido/token-card"));
    expect(mockTokenize).toHaveBeenCalledWith(
      expect.objectContaining({ payeeCode: "payee-cifra", environment: "sandbox" }),
      expect.objectContaining({ brand: "visa", number: "4111111111111111", holderDocument: "52998224725" }),
      false,
    );
    const body = mockCardOrder.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({
      quoteId: "quote-1",
      installments: 3,
      paymentToken: "tok_abc",
      address: { zipcode: "01001000", city: "São Paulo", state: "SP", number: "10" },
    });
    // The card number never goes to our API.
    expect(JSON.stringify(body)).not.toContain("4111111111111111");
  });

  it("produto com oferta depois da compra pede à Efí um token reutilizável", async () => {
    const user = userEvent.setup();
    mockCardOrder.mockResolvedValue(order({ processing: true }));
    render(<CheckoutForm data={{ ...product, payment: { ...product.payment, cardReuse: true } }} />);
    await screen.findByTestId("checkout-total");

    await fillCard(user);
    await screen.findByLabelText("Parcelas");
    await user.click(screen.getByRole("button", { name: /pagar com cartão/i }));

    await waitFor(() => expect(mockTokenize).toHaveBeenCalled());
    expect(mockTokenize.mock.calls[0]?.[2]).toBe(true);
  });

  it("recusa permite tentar de novo no mesmo pedido; depois do limite, sugere o Pix", async () => {
    const user = userEvent.setup();
    mockCardOrder.mockResolvedValue(order({ card: { declined: true, canRetry: true } }));
    mockCardPay.mockResolvedValue(order({ card: { declined: true, canRetry: false } }));
    render(<CheckoutForm data={product} />);
    await screen.findByTestId("checkout-total");

    await fillCard(user);
    await screen.findByLabelText("Parcelas");
    await user.click(screen.getByRole("button", { name: /pagar com cartão/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não autorizado pelo banco/i);

    await user.type(screen.getByLabelText("Número do cartão"), "5555555555554444");
    await user.type(screen.getByLabelText("Validade (MM/AA)"), "11/39");
    await user.type(screen.getByLabelText("Código de segurança"), "321");
    await screen.findByLabelText("Parcelas");
    await user.click(screen.getByRole("button", { name: /pagar com cartão/i }));

    await waitFor(() => expect(mockCardPay).toHaveBeenCalledWith("token-card", expect.objectContaining({ quoteId: "quote-1" })));
    expect(await screen.findByRole("alert")).toHaveTextContent(/pague com pix/i);
    expect(screen.getByRole("button", { name: /gerar pix/i })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("validade vencida não chega a tokenizar", async () => {
    const user = userEvent.setup();
    render(<CheckoutForm data={product} />);
    await screen.findByTestId("checkout-total");

    await fillCard(user);
    await user.clear(screen.getByLabelText("Validade (MM/AA)"));
    await user.type(screen.getByLabelText("Validade (MM/AA)"), "01/20");
    await screen.findByLabelText("Parcelas");
    await user.click(screen.getByRole("button", { name: /pagar com cartão/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/validade/i);
    expect(mockTokenize).not.toHaveBeenCalled();
  });
});
