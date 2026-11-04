import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutOffer, CheckoutProduct } from "@/lib/api-client";
import { ProductForm } from "../ProductForm";
import { OffersPanel } from "../OffersPanel";

const mockApi = { createCheckoutOffer: jest.fn(), updateCheckoutOffer: jest.fn() };
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

function product(id: string, change: Partial<CheckoutProduct> = {}): CheckoutProduct {
  return {
    id,
    name: `Produto ${id}`,
    description: null,
    priceCents: 6700,
    compareAtPriceCents: null,
    imageAssetId: null,
    accessPeriodMonths: 12,
    deliveryMode: "ACCESS_LINK",
    accessUrl: "https://acesso.test",
    accessInstructions: null,
    slug: `produto-${id}`,
    active: true,
    version: 1,
    createdAt: "2026-11-09T12:00:00.000Z",
    afterPurchase: "OFFER",
    afterPurchaseUrl: null,
    offerWindowMinutes: 30,
    offers: [],
    ...change,
  };
}

const upsell: CheckoutOffer = {
  id: "offer-up",
  kind: "UPSELL",
  offeredProductId: "p2",
  priceCents: 9700,
  compareAtPriceCents: 19700,
  headline: "A mentoria pela metade",
  description: null,
  active: true,
  version: 2,
  offeredProduct: { id: "p2", name: "Produto p2", priceCents: 19700, active: true },
};

describe("Depois da compra (produto)", () => {
  it("página externa exige https e a validade fica entre 15 minutos e 24 horas", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(<ProductForm product={product("p1")} submitLabel="Salvar produto" onSubmit={onSubmit} />);

    await user.selectOptions(screen.getByLabelText("Para onde o comprador vai"), "EXTERNAL");
    await user.type(screen.getByLabelText("Endereço da sua página de oferta"), "http://loja.test/oferta");
    await user.click(screen.getByRole("button", { name: /salvar produto/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("https://");

    const url = screen.getByLabelText("Endereço da sua página de oferta");
    await user.clear(url);
    await user.type(url, "https://loja.test/oferta");
    const window = screen.getByLabelText("Validade da oferta (minutos)");
    await user.clear(window);
    await user.type(window, "2000");
    await user.click(screen.getByRole("button", { name: /salvar produto/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("24 horas");

    await user.clear(window);
    await user.type(window, "60");
    await user.click(screen.getByRole("button", { name: /salvar produto/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          afterPurchase: "EXTERNAL",
          afterPurchaseUrl: "https://loja.test/oferta",
          offerWindowMinutes: 60,
        }),
      ),
    );
  });
});

describe("Ofertas depois da compra (vendedor)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("cria o upsell; o downsell só depois dele", async () => {
    const user = userEvent.setup();
    const onChanged = jest.fn();
    mockApi.createCheckoutOffer.mockResolvedValue(product("p1", { offers: [upsell] }));
    render(
      <OffersPanel
        product={product("p1")}
        catalog={[product("p1"), product("p2")]}
        onChanged={onChanged}
        onConflict={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /adicionar downsell/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /adicionar upsell/i }));
    await user.selectOptions(screen.getByLabelText("Produto do upsell"), "p2");
    await user.type(screen.getByLabelText("Preço da oferta (R$)"), "97,00");
    await user.type(screen.getByLabelText('Preço "De" (R$)'), "197,00");
    await user.click(screen.getByRole("button", { name: /salvar upsell/i }));

    await waitFor(() =>
      expect(mockApi.createCheckoutOffer).toHaveBeenCalledWith("p1", {
        kind: "UPSELL",
        offeredProductId: "p2",
        priceCents: 9700,
        compareAtPriceCents: 19700,
        headline: null,
        description: null,
        active: true,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("edição com versão antiga recarrega em vez de sobrescrever", async () => {
    const user = userEvent.setup();
    const onConflict = jest.fn();
    mockApi.updateCheckoutOffer.mockRejectedValue(
      Object.assign(new Error("Outra pessoa alterou este registro."), { data: { code: "VERSION_CHANGED" } }),
    );
    render(
      <OffersPanel
        product={product("p1", { offers: [upsell] })}
        catalog={[product("p1"), product("p2")]}
        onChanged={jest.fn()}
        onConflict={onConflict}
      />,
    );

    await user.click(screen.getByRole("button", { name: /editar/i }));
    await user.click(screen.getByRole("button", { name: /salvar upsell/i }));

    await waitFor(() => expect(onConflict).toHaveBeenCalled());
    expect(mockApi.updateCheckoutOffer).toHaveBeenCalledWith(
      "p1",
      "offer-up",
      expect.objectContaining({ expectedVersion: 2 }),
    );
    expect(await screen.findByText(/alteradas em outra tela/i)).toBeInTheDocument();
  });

  it("com a página do vendedor, mostra o link de 1 clique de cada oferta", () => {
    render(
      <OffersPanel
        product={product("p1", { afterPurchase: "EXTERNAL", offers: [upsell] })}
        catalog={[product("p1"), product("p2")]}
        onChanged={jest.fn()}
        onConflict={jest.fn()}
      />,
    );
    expect(screen.getByText(/\/c\/oferta\/\{cifra_oferta\}\?oferta=offer-up/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copiar link de 1 clique/i })).toBeInTheDocument();
  });
});
