import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutPlatformView } from "@/lib/api-client";
import { PlatformAccountPanel } from "../PlatformAccountPanel";

const mockApi = {
  getCheckoutPlatformAccount: jest.fn(),
  validateCheckoutPlatformAccount: jest.fn(),
  setCheckoutPlatformPixFee: jest.fn(),
  uploadCheckoutPlatformCredentials: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const view = (change: Partial<CheckoutPlatformView> = {}): CheckoutPlatformView => ({
  current: {
    id: "settings-1",
    version: 2,
    pixFeeBasisPoints: null,
    cardEnabled: false,
    cardRates: null,
    cardCreditDays: null,
    webhookConfiguredAt: "2026-11-04T12:00:00.000Z",
    createdAt: "2026-11-04T12:00:00.000Z",
    identityId: "identity-1",
  },
  history: [],
  identity: {
    id: "identity-1",
    environment: "PRODUCTION",
    holderDocument: "11222333000181",
    efiAccountNumber: "123456",
    efiAccountDigit: null,
    payeeCode: "abc",
    pixKey: "pix@ciframais.test",
    credentialVersions: [
      {
        id: "credential-1",
        version: 1,
        status: "CANDIDATE",
        certificateExpiresAt: "2027-01-01T00:00:00.000Z",
        activatedAt: null,
        createdAt: "2026-11-04T12:00:00.000Z",
      },
    ],
  },
  webhookTarget: "https://api.test/webhooks/efi/pix?ignorar=",
  ready: false,
  ...change,
});

describe("PlatformAccountPanel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("só troca um webhook de outro endereço depois da confirmação", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutPlatformAccount.mockResolvedValue(view());
    mockApi.validateCheckoutPlatformAccount
      .mockRejectedValueOnce(
        Object.assign(new Error("ocupado"), {
          status: 409,
          data: { code: "PIX_WEBHOOK_IN_USE", currentUrl: "https://outro.test/pix" },
        }),
      )
      .mockResolvedValueOnce(view({ ready: true }));
    render(<PlatformAccountPanel />);

    await user.click(await screen.findByRole("button", { name: /validar e ligar webhook/i }));
    expect(await screen.findByText("https://outro.test/pix")).toBeInTheDocument();
    expect(mockApi.validateCheckoutPlatformAccount).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: /trocar pelo endereço da cifra\+/i }));
    await waitFor(() => expect(mockApi.validateCheckoutPlatformAccount).toHaveBeenLastCalledWith(true));
    expect(await screen.findByText("Pronta para vender")).toBeInTheDocument();
  });

  it("salva a tarifa em pontos-base com a versão atual", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutPlatformAccount.mockResolvedValue(view());
    mockApi.setCheckoutPlatformPixFee.mockResolvedValue(view({ ready: true }));
    render(<PlatformAccountPanel />);

    await user.type(await screen.findByLabelText("Nova tarifa do Pix (%)"), "1,19");
    await user.click(screen.getByRole("button", { name: /salvar tarifa/i }));

    expect(mockApi.setCheckoutPlatformPixFee).toHaveBeenCalledWith({ expectedVersion: 2, pixFeeBasisPoints: 119 });
  });

  it("não mostra client id, secret nem certificado", async () => {
    mockApi.getCheckoutPlatformAccount.mockResolvedValue(view());
    render(<PlatformAccountPanel />);
    await screen.findByText(/conta: 123456/i);
    expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  });
});
