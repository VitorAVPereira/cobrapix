import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutBump, CheckoutProduct, CheckoutSettings } from "@/lib/api-client";
import { ProductForm } from "../ProductForm";
import { BumpsPanel } from "../BumpsPanel";
import CheckoutSettingsPage from "@/app/(dashboard)/checkout/configuracoes/page";

const mockApi = {
  getCheckoutSettings: jest.fn(),
  updateCheckoutSettings: jest.fn(),
  uploadCheckoutAsset: jest.fn(),
  checkoutAssetUrl: (id: string) => `http://api.test/checkout/public/assets/${id}`,
  createCheckoutBump: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

function product(id: string, bumps: CheckoutBump[] = []): CheckoutProduct {
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
    createdAt: "2026-11-03T12:00:00.000Z",
    bumps,
  };
}

function bump(index: number): CheckoutBump {
  return {
    id: `bump-${index}`,
    offeredProductId: `offered-${index}`,
    priceCents: 1490,
    compareAtPriceCents: null,
    headline: null,
    description: null,
    active: true,
    position: index,
    version: 1,
    offeredProduct: { id: `offered-${index}`, name: `Oferta ${index}`, priceCents: 2990, active: true },
  };
}

describe("ProductForm", () => {
  it("não envia preço abaixo de R$ 5,00", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<ProductForm submitLabel="Criar produto" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Nome do produto"), "Guia");
    await user.type(screen.getByLabelText("Preço (R$)"), "4,99");
    await user.type(screen.getByLabelText("Link de acesso"), "https://acesso.test");
    await user.click(screen.getByRole("button", { name: /criar produto/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("R$ 5,00");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("envia o preço em centavos e o período em meses", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(<ProductForm submitLabel="Criar produto" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Nome do produto"), "Porquim Anual");
    await user.type(screen.getByLabelText("Período de acesso (meses)"), "12");
    await user.type(screen.getByLabelText("Preço (R$)"), "67,00");
    await user.type(screen.getByLabelText('Preço "De" (R$)'), "97,00");
    await user.type(screen.getByLabelText("Link de acesso"), "https://acesso.test");
    await user.click(screen.getByRole("button", { name: /criar produto/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Porquim Anual",
          priceCents: 6700,
          compareAtPriceCents: 9700,
          accessPeriodMonths: 12,
        }),
      ),
    );
  });
});

describe("BumpsPanel", () => {
  it("bloqueia o sétimo order bump ativo", () => {
    const bumps = [1, 2, 3, 4, 5, 6].map(bump);
    render(
      <BumpsPanel
        product={product("main", bumps)}
        catalog={[product("main"), product("other")]}
        onChanged={jest.fn()}
        onConflict={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /adicionar order bump/i })).toBeDisabled();
    expect(screen.getByText(/limite de 6 order bumps ativos/i)).toBeInTheDocument();
  });
});

describe("CheckoutSettingsPage", () => {
  const settings: CheckoutSettings = {
    id: "settings-1",
    version: 1,
    updatedAt: "2026-11-03T12:00:00.000Z",
    displayName: "Porquim",
    logoAssetId: null,
    bannerAssetId: null,
    primaryColor: "#0F766E",
    supportEmail: null,
    supportWhatsapp: null,
    whatsappButtonPhone: null,
    pixEnabled: true,
    cardEnabled: false,
    maxInstallments: 12,
    pixFeePayer: "SELLER",
    cardFeePayer: "BUYER",
  };

  beforeEach(() => jest.clearAllMocks());

  it("o cartão aparece desabilitado", async () => {
    mockApi.getCheckoutSettings.mockResolvedValue(settings);
    render(<CheckoutSettingsPage />);

    expect(await screen.findByLabelText("Cartão de crédito")).toBeDisabled();
  });

  it("alteração em outra tela recarrega em vez de sobrescrever", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutSettings
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, version: 2, displayName: "Porquim IA" });
    mockApi.updateCheckoutSettings.mockRejectedValue(
      Object.assign(new Error("conflito"), { status: 409, data: { code: "VERSION_CHANGED" } }),
    );
    render(<CheckoutSettingsPage />);

    await user.click(await screen.findByRole("button", { name: /salvar configurações/i }));

    expect(mockApi.updateCheckoutSettings).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 1 }),
    );
    expect(await screen.findByDisplayValue("Porquim IA")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/alteradas em outra tela/i);
  });
});
