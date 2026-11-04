import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutApiKey } from "@/lib/api-client";
import { ApiKeysPanel } from "../ApiKeysPanel";

const mockApi = {
  listCheckoutApiKeys: jest.fn(),
  createCheckoutApiKey: jest.fn(),
  revokeCheckoutApiKey: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const key = (change: Partial<CheckoutApiKey> = {}): CheckoutApiKey => ({
  id: "k1",
  name: "ERP",
  prefix: "ckapi_abcdef",
  createdAt: "2026-11-11T12:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  ...change,
});

describe("ApiKeysPanel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("a chave nova aparece uma vez; a lista mostra só o prefixo", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutApiKeys.mockResolvedValueOnce([]).mockResolvedValue([key()]);
    mockApi.createCheckoutApiKey.mockResolvedValue({ ...key(), key: "ckapi_abcdef_segredo" });
    render(<ApiKeysPanel />);

    await user.type(await screen.findByLabelText("Nome da chave"), "ERP");
    await user.click(screen.getByRole("button", { name: /criar chave/i }));

    expect(mockApi.createCheckoutApiKey).toHaveBeenCalledWith("ERP");
    expect(await screen.findByText("ckapi_abcdef_segredo")).toBeInTheDocument();
    expect(await screen.findByText("ckapi_abcdef…")).toBeInTheDocument();
  });

  it("com 5 chaves ativas não cria outra", async () => {
    mockApi.listCheckoutApiKeys.mockResolvedValue(
      [1, 2, 3, 4, 5].map((n) => key({ id: `k${n}`, name: `Chave ${n}` })).concat(key({ id: "k6", revokedAt: "2026-11-11T13:00:00.000Z" })),
    );
    render(<ApiKeysPanel />);
    expect(await screen.findByRole("button", { name: /criar chave/i })).toBeDisabled();
    expect(screen.getByText(/Revogada em/)).toBeInTheDocument();
  });

  it("revogar pede confirmação", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutApiKeys.mockResolvedValue([key()]);
    mockApi.revokeCheckoutApiKey.mockResolvedValue(undefined);
    render(<ApiKeysPanel />);

    await user.click(await screen.findByRole("button", { name: "Revogar" }));
    expect(mockApi.revokeCheckoutApiKey).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /confirmar revogação/i }));
    await waitFor(() => expect(mockApi.revokeCheckoutApiKey).toHaveBeenCalledWith("k1"));
  });
});
