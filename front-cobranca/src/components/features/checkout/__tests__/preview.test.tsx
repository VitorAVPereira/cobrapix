import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutBump, CheckoutProduct, CheckoutSettings } from "@/lib/api-client";
import { ProductForm, type ProductDraft } from "../ProductForm";
import { CheckoutPreview } from "../CheckoutPreview";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => ({ checkoutAssetUrl: (id: string) => `http://api.test/checkout/public/assets/${id}` }),
}));
const mockQuote = jest.fn();
const mockCreate = jest.fn();
const mockLead = jest.fn();
jest.mock("@/lib/checkout-public", () => {
  const actual = jest.requireActual<typeof import("@/lib/checkout-public")>("@/lib/checkout-public");
  return {
    ...actual,
    quoteCheckout: (...args: unknown[]) => mockQuote(...args),
    createCheckoutOrder: (...args: unknown[]) => mockCreate(...args),
    saveCheckoutLead: (...args: unknown[]) => mockLead(...args),
  };
});

const settings = {
  displayName: "Porquim",
  logoAssetId: "logo-geral",
  bannerAssetId: "banner-geral",
  primaryColor: "#0F766E",
  supportEmail: null,
  supportWhatsapp: null,
  whatsappButtonPhone: "11999999999",
  pixEnabled: true,
  cardEnabled: false,
} as CheckoutSettings;

const offered = {
  id: "guia",
  name: "Guia Renda Fixa",
  description: "Descrição do produto",
  imageAssetId: "img-guia",
  accessPeriodMonths: 3,
} as CheckoutProduct;

const bump: CheckoutBump = {
  id: "bump-1",
  offeredProductId: "guia",
  priceCents: 1490,
  compareAtPriceCents: 2990,
  headline: "GUIA COM 60% OFF",
  callToAction: "Pare de deixar seu dinheiro parado",
  description: null,
  active: true,
  position: 0,
  version: 1,
  offeredProduct: { id: "guia", name: "Guia Renda Fixa", priceCents: 2990, active: true },
};

const draft: ProductDraft = {
  name: "Porquim I.A",
  description: null,
  priceCents: 2990,
  compareAtPriceCents: 4700,
  imageAssetId: null,
  logoAssetId: null,
  bannerAssetId: "banner-produto",
  primaryColor: null,
  accessPeriodMonths: 3,
};

describe("CheckoutPreview", () => {
  beforeEach(() => jest.clearAllMocks());

  it("mostra a página com o que está sendo digitado, sem chamar a API pública", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CheckoutPreview draft={draft} bumps={[bump]} catalog={[offered]} settings={settings} />,
    );

    expect(screen.getByRole("heading", { name: "Porquim I.A" })).toBeInTheDocument();
    expect(screen.getByText("Trimestral")).toBeInTheDocument();
    // The product and the bump, both quarterly.
    expect(screen.getAllByText("por trimestre")).toHaveLength(2);
    // The product banner wins; without its own logo, the settings' one.
    const images = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(images.some((src) => src?.endsWith("/checkout/public/assets/banner-produto"))).toBe(true);
    expect(images.some((src) => src?.endsWith("/checkout/public/assets/logo-geral"))).toBe(true);
    expect(images.some((src) => src?.endsWith("/checkout/public/assets/img-guia"))).toBe(true);
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("29,90");
    // The floating WhatsApp button would cover the seller's screen.
    expect(screen.queryByRole("link", { name: /whatsapp/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /pare de deixar/i }));
    expect(screen.getByText("Adicionado ao carrinho")).toBeInTheDocument();
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("44,80");

    await user.type(screen.getByLabelText("E-mail"), "maria@exemplo.test");
    await user.click(screen.getByLabelText("Nome completo"));
    await user.click(screen.getByRole("button", { name: /gerar pix/i }));
    expect(mockQuote).not.toHaveBeenCalled();
    expect(mockLead).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("ProductForm, aparência e prévia", () => {
  it("envia logo, banner e cor; cor em branco usa a das configurações", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const onDraftChange = jest.fn();
    render(
      <ProductForm submitLabel="Criar produto" defaultColor="#0F766E" onSubmit={onSubmit} onDraftChange={onDraftChange} />,
    );

    await user.type(screen.getByLabelText("Nome do produto"), "Guia");
    await user.type(screen.getByLabelText("Preço (R$)"), "29,90");
    await user.type(screen.getByLabelText("Link de acesso"), "https://acesso.test");
    await waitFor(() =>
      expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Guia", priceCents: 2990 })),
    );

    await user.type(screen.getByPlaceholderText(/das configurações/i), "#zz");
    await user.click(screen.getByRole("button", { name: /criar produto/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("#RRGGBB");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /usar a padrão/i }));
    await user.click(screen.getByRole("button", { name: /criar produto/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ logoAssetId: null, bannerAssetId: null, primaryColor: null }),
      ),
    );
  });
});
