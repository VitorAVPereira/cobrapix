import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicOffer } from "@/lib/checkout-public";
import { OfferPage } from "../OfferPage";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockGet = jest.fn();
const mockQuote = jest.fn();
const mockAccept = jest.fn();
const mockDecline = jest.fn();
const mockOpenAccess = jest.fn();
jest.mock("@/lib/checkout-public", () => {
  const actual = jest.requireActual<typeof import("@/lib/checkout-public")>("@/lib/checkout-public");
  return {
    ...actual,
    getCheckoutOffer: (...args: unknown[]) => mockGet(...args),
    quoteCheckoutOfferCard: (...args: unknown[]) => mockQuote(...args),
    acceptCheckoutOffer: (...args: unknown[]) => mockAccept(...args),
    declineCheckoutOffer: (...args: unknown[]) => mockDecline(...args),
    openAccess: (url: string) => mockOpenAccess(url),
  };
});

const TOKEN = "o".repeat(43);
const page = {
  displayName: "Porquim",
  primaryColor: "#0F766E",
  logoUrl: null,
  supportEmail: null,
  supportWhatsapp: null,
};

function offer(change: Partial<PublicOffer> = {}): PublicOffer {
  return {
    state: "OFFER",
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    accessUrl: "https://acesso.test/porquim",
    page,
    offer: {
      id: "offer-up",
      kind: "UPSELL",
      name: "Mentoria Porquim",
      headline: "A mentoria pela metade",
      description: "Encontros ao vivo.",
      priceCents: 9700,
      compareAtPriceCents: 19700,
      imageUrl: null,
      accessPeriodMonths: 12,
    },
    order: null,
    payment: { pixEnabled: true, card: { brand: "visa", maxInstallments: 12 } },
    ...change,
  };
}

describe("Oferta depois da compra", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuote.mockResolvedValue({
      quoteId: "quote-offer",
      validUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      subtotalCents: 9700,
      options: [
        { installments: 1, installmentValueCents: 10000, totalCents: 10000 },
        { installments: 2, installmentValueCents: 5100, totalCents: 10200 },
      ],
    });
  });

  it("aceita no mesmo cartão com um clique: a primeira parcela já vem marcada", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(offer());
    mockAccept.mockResolvedValue({ token: "offer-order" });
    render(<OfferPage token={TOKEN} offerId={null} />);

    expect(await screen.findByText("A mentoria pela metade")).toBeInTheDocument();
    expect(await screen.findByLabelText("Parcelas")).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: /sim, quero por r\$\s?100,00/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/c/pedido/offer-order"));
    expect(mockAccept).toHaveBeenCalledWith(TOKEN, {
      offerId: "offer-up",
      method: "CARD",
      quoteId: "quote-offer",
      installments: 1,
      idempotencyKey: expect.any(String) as string,
    });
  });

  it("o comprador pode trocar as parcelas ou pagar com Pix", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(offer());
    mockAccept.mockResolvedValue({ token: "offer-order" });
    render(<OfferPage token={TOKEN} offerId={null} />);

    await user.selectOptions(await screen.findByLabelText("Parcelas"), "2");
    expect(screen.getByRole("button", { name: /sim, quero/i })).toHaveTextContent("102,00");
    await user.click(screen.getByRole("radio", { name: "Pix" }));
    await user.click(screen.getByRole("button", { name: /sim, quero por r\$\s?97,00/i }));

    await waitFor(() => expect(mockAccept).toHaveBeenCalled());
    expect(mockAccept.mock.calls[0]?.[1]).toEqual({
      offerId: "offer-up",
      method: "PIX",
      idempotencyKey: expect.any(String) as string,
    });
  });

  it("recusa o upsell e vê o downsell; recusa de novo e vai para o acesso", async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(offer({ payment: { pixEnabled: true, card: null } }));
    mockDecline.mockResolvedValueOnce(
      offer({
        payment: { pixEnabled: true, card: null },
        offer: {
          id: "offer-down",
          kind: "DOWNSELL",
          name: "Planilha Porquim",
          headline: null,
          description: null,
          priceCents: 1900,
          compareAtPriceCents: null,
          imageUrl: null,
          accessPeriodMonths: null,
        },
      }),
    );
    mockDecline.mockResolvedValueOnce(offer({ state: "DONE", offer: null }));
    render(<OfferPage token={TOKEN} offerId={null} />);

    await user.click(await screen.findByRole("button", { name: /não, obrigado/i }));
    expect(await screen.findByText("Espere! Uma última oferta")).toBeInTheDocument();
    expect(screen.getByText("Planilha Porquim")).toBeInTheDocument();
    // No kept card: Pix only, no installments to choose.
    expect(screen.queryByLabelText("Parcelas")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /não, obrigado/i }));
    expect(await screen.findByText("Compra concluída")).toBeInTheDocument();
    expect(mockDecline).toHaveBeenLastCalledWith(TOKEN, "offer-down");
    await waitFor(() => expect(mockOpenAccess).toHaveBeenCalledWith("https://acesso.test/porquim"), {
      timeout: 3000,
    });
  });

  it("prazo vencido mostra o acesso e não oferece nada", async () => {
    mockGet.mockResolvedValue(offer({ state: "CLOSED", offer: null }));
    render(<OfferPage token={TOKEN} offerId={null} />);

    expect(await screen.findByText(/o prazo desta oferta terminou/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acessar minha compra" })).toHaveAttribute(
      "href",
      "https://acesso.test/porquim",
    );
    expect(screen.queryByRole("button", { name: /sim, quero/i })).not.toBeInTheDocument();
  });

  it("oferta já aceita segue para o pagamento dela; link de outra oferta vai junto na consulta", async () => {
    mockGet.mockResolvedValue(offer({ order: { token: "offer-order", status: "PENDING" } }));
    render(<OfferPage token={TOKEN} offerId="0b3f7a3e-5a4c-4b8e-9b1e-7a0c1d2e3f40" />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/c/pedido/offer-order"));
    expect(mockGet).toHaveBeenCalledWith(TOKEN, "0b3f7a3e-5a4c-4b8e-9b1e-7a0c1d2e3f40", expect.anything());
  });
});
