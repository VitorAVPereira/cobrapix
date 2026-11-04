import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicCheckoutOrder, PublicCheckoutProduct } from "@/lib/checkout-public";
import { CheckoutForm } from "../CheckoutForm";
import { OrderStatus } from "../OrderStatus";
import { RefundRequestPage } from "../RefundRequestPage";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockQuote = jest.fn();
const mockCreate = jest.fn();
const mockGetOrder = jest.fn();
const mockOpenAccess = jest.fn();
const mockRequestRefund = jest.fn();
const mockSaveLead = jest.fn();
jest.mock("@/lib/checkout-public", () => {
  const actual = jest.requireActual<typeof import("@/lib/checkout-public")>("@/lib/checkout-public");
  return {
    ...actual,
    quoteCheckout: (...args: unknown[]) => mockQuote(...args),
    createCheckoutOrder: (...args: unknown[]) => mockCreate(...args),
    getCheckoutOrder: (...args: unknown[]) => mockGetOrder(...args),
    openAccess: (url: string) => mockOpenAccess(url),
    requestCheckoutRefund: (...args: unknown[]) => mockRequestRefund(...args),
    saveCheckoutLead: (...args: unknown[]) => mockSaveLead(...args),
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
  payment: { pixEnabled: true, cardEnabled: false, maxInstallments: null },
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
    paymentMethod: "PIX",
    installments: null,
    processing: false,
    card: null,
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
    mockSaveLead.mockResolvedValue({ saved: true });
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
    // The order closes the lead of the same visit.
    const leadKey = (mockSaveLead.mock.calls.at(-1) as [string, { sessionKey: string }])[1].sessionKey;
    expect(mockCreate.mock.calls[0]?.[1]).toMatchObject({ sessionKey: leadKey });
  });

  it("ao sair de um campo grava o que já foi digitado, só com e-mail ou celular", async () => {
    const user = userEvent.setup();
    mockQuote.mockResolvedValue(quote(6700));
    render(<CheckoutForm data={product} />);
    await screen.findByTestId("checkout-total");

    await user.type(screen.getByLabelText("Nome completo"), "Maria Souza");
    await user.click(screen.getByLabelText("E-mail"));
    expect(mockSaveLead).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("E-mail"), "maria@exemplo.test");
    await user.click(screen.getByLabelText("CPF ou CNPJ"));
    expect(mockSaveLead).toHaveBeenCalledTimes(1);
    expect(mockSaveLead).toHaveBeenCalledWith("porquim-anual-ab12", {
      name: "Maria Souza",
      email: "maria@exemplo.test",
      document: "",
      phone: "",
      sessionKey: expect.any(String),
      utm: { utm_source: "LINK_PADRAO" },
    });
    // Nothing changed: no new call.
    await user.click(screen.getByLabelText("Celular com DDD"));
    expect(mockSaveLead).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /aviso de privacidade/i })).toHaveAttribute("href", "/privacidade-checkout");
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

describe("RefundRequestPage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("envia o motivo e confirma o recebimento", async () => {
    const user = userEvent.setup();
    mockGetOrder.mockResolvedValue(order({ status: "PAID", pix: null }));
    mockRequestRefund.mockResolvedValue({ id: "r1", status: "REQUESTED" });
    render(<RefundRequestPage token="token" />);

    await user.type(await screen.findByLabelText("Conte o motivo"), "Não era o que eu esperava");
    await user.click(screen.getByRole("button", { name: /enviar pedido de reembolso/i }));

    expect(mockRequestRefund).toHaveBeenCalledWith("token", "Não era o que eu esperava");
    expect(await screen.findByRole("status")).toHaveTextContent(/pedido recebido/i);
  });

  it("fora do prazo mostra a orientação do servidor", async () => {
    const user = userEvent.setup();
    mockGetOrder.mockResolvedValue(order({ status: "PAID", pix: null }));
    mockRequestRefund.mockRejectedValue(new Error("O prazo de 7 dias para pedir reembolso por aqui terminou."));
    render(<RefundRequestPage token="token" />);

    await user.type(await screen.findByLabelText("Conte o motivo"), "Mudei de ideia");
    await user.click(screen.getByRole("button", { name: /enviar pedido de reembolso/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/prazo de 7 dias/);
  });

  it("compra já reembolsada não mostra o formulário", async () => {
    mockGetOrder.mockResolvedValue(order({ status: "REFUNDED", pix: null }));
    render(<RefundRequestPage token="token" />);
    expect(await screen.findByText("Esta compra já foi reembolsada.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Conte o motivo")).not.toBeInTheDocument();
  });
});
