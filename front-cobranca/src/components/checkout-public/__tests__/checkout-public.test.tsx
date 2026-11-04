import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicCheckoutOrder, PublicCheckoutProduct } from "@/lib/checkout-public";
import { CheckoutForm } from "../CheckoutForm";
import { OrderStatus } from "../OrderStatus";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockQuote = jest.fn();
const mockCreate = jest.fn();
const mockGetOrder = jest.fn();
const mockOpenAccess = jest.fn();
jest.mock("@/lib/checkout-public", () => {
  const actual = jest.requireActual<typeof import("@/lib/checkout-public")>("@/lib/checkout-public");
  return {
    ...actual,
    quoteCheckout: (...args: unknown[]) => mockQuote(...args),
    createCheckoutOrder: (...args: unknown[]) => mockCreate(...args),
    getCheckoutOrder: (...args: unknown[]) => mockGetOrder(...args),
    openAccess: (url: string) => mockOpenAccess(url),
  };
});

const product: PublicCheckoutProduct = {
  available: true,
  unavailableMessage: null,
  product: {
    slug: "porquim-anual-ab12",
    name: "Porquim Anual",
    description: null,
    priceCents: 6700,
    compareAtPriceCents: 9700,
    imageUrl: null,
    accessPeriodMonths: 12,
  },
  bumps: [
    {
      id: "bump-1",
      name: "Guia Renda Fixa",
      headline: "GUIA COM 50% OFF",
      description: "Um guia simples",
      priceCents: 1490,
      compareAtPriceCents: 2990,
      imageUrl: null,
      accessPeriodMonths: null,
    },
  ],
  page: {
    displayName: "Porquim",
    logoUrl: null,
    bannerUrl: null,
    primaryColor: "#0F766E",
    supportEmail: null,
    supportWhatsapp: null,
    whatsappButtonPhone: null,
  },
  payment: { pixEnabled: true, cardEnabled: false },
};

const quote = (totalCents: number) => ({
  items: [{ kind: "MAIN", name: "Porquim Anual", unitPriceCents: 6700, discountCents: 0 }],
  couponCode: null,
  discountCents: 0,
  subtotalCents: totalCents,
  surchargeCents: 0,
  totalCents,
});

function order(change: Partial<PublicCheckoutOrder> = {}): PublicCheckoutOrder {
  return {
    token: "token",
    productSlug: "porquim-anual-ab12",
    status: "PENDING",
    processing: false,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    items: [
      {
        kind: "MAIN",
        name: "Porquim Anual",
        unitPriceCents: 6700,
        discountCents: 0,
        accessUrl: null,
        accessInstructions: null,
      },
    ],
    subtotalCents: 6700,
    discountCents: 0,
    surchargeCents: 0,
    totalCents: 6700,
    pix: { copyPaste: "000201pix", qrCodeImage: "data:image/png;base64,AA" },
    redirectUrl: null,
    page: null,
    ...change,
  };
}

describe("CheckoutForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/c/porquim-anual-ab12?utm_source=LINK_PADRAO&outro=x");
  });

  it("mostra o total calculado pelo servidor, também com bump", async () => {
    const user = userEvent.setup();
    mockQuote.mockResolvedValueOnce(quote(6700)).mockResolvedValueOnce(quote(8190));
    render(<CheckoutForm data={product} />);

    expect(await screen.findByTestId("checkout-total")).toHaveTextContent("67,00");
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByTestId("checkout-total")).toHaveTextContent("81,90"));
    expect(mockQuote).toHaveBeenLastCalledWith(
      "porquim-anual-ab12",
      { bumpIds: ["bump-1"], couponCode: null },
      expect.any(AbortSignal),
    );
  });

  it("barra CPF inválido sem chamar o servidor", async () => {
    const user = userEvent.setup();
    mockQuote.mockResolvedValue(quote(6700));
    render(<CheckoutForm data={product} />);
    await screen.findByTestId("checkout-total");

    await user.type(screen.getByLabelText("Nome completo"), "Maria Souza");
    await user.type(screen.getByLabelText("E-mail"), "maria@exemplo.test");
    await user.type(screen.getByLabelText("CPF ou CNPJ"), "111.111.111-11");
    await user.type(screen.getByLabelText("Celular com DDD"), "11999999999");
    await user.click(screen.getByRole("button", { name: /gerar pix/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("CPF ou CNPJ");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("gera o pedido com as UTMs do link e abre a página do pedido", async () => {
    const user = userEvent.setup();
    mockQuote.mockResolvedValue(quote(6700));
    mockCreate.mockResolvedValue(order());
    render(<CheckoutForm data={product} />);
    await screen.findByTestId("checkout-total");

    await user.type(screen.getByLabelText("Nome completo"), "Maria Souza");
    await user.type(screen.getByLabelText("E-mail"), "maria@exemplo.test");
    await user.type(screen.getByLabelText("CPF ou CNPJ"), "529.982.247-25");
    await user.type(screen.getByLabelText("Celular com DDD"), "(11) 99999-9999");
    await user.click(screen.getByRole("button", { name: /gerar pix/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/c/pedido/token"));
    expect(mockCreate).toHaveBeenCalledWith(
      "porquim-anual-ab12",
      expect.objectContaining({
        buyer: {
          name: "Maria Souza",
          email: "maria@exemplo.test",
          document: "52998224725",
          phone: "11999999999",
        },
        utm: { utm_source: "LINK_PADRAO" },
      }),
    );
  });
});

describe("OrderStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("mostra o Pix e confirma sozinho quando pago", async () => {
    mockGetOrder
      .mockResolvedValueOnce(order())
      .mockResolvedValueOnce(
        order({
          status: "PAID",
          pix: null,
          redirectUrl: "https://acesso.test/porquim",
          items: [{ ...order().items[0], accessUrl: "https://acesso.test/porquim" }],
        }),
      );
    render(<OrderStatus token="token" />);

    expect(await screen.findByAltText("QR Code do Pix")).toBeInTheDocument();
    expect(screen.getByTestId("countdown")).toHaveTextContent(/^(30|29):\d{2}$/);
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(await screen.findByText("Pagamento confirmado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /acessar porquim anual/i })).toHaveAttribute(
      "href",
      "https://acesso.test/porquim",
    );
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(mockOpenAccess).toHaveBeenCalledWith("https://acesso.test/porquim");
  });

  it("Pix expirado oferece gerar outro", async () => {
    mockGetOrder.mockResolvedValue(order({ status: "EXPIRED", pix: null }));
    render(<OrderStatus token="token" />);

    expect(await screen.findByText("Este Pix expirou")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /gerar novo pix/i })).toHaveAttribute("href", "/c/porquim-anual-ab12");
  });

  it("enquanto a Efí não responde, mostra que o Pix está sendo gerado", async () => {
    mockGetOrder.mockResolvedValue(order({ processing: true, pix: null }));
    render(<OrderStatus token="token" />);
    expect(await screen.findByText(/gerando seu pix/i)).toBeInTheDocument();
  });
});
