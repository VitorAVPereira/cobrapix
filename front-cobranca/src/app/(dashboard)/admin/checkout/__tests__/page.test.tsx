import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutClientDetail } from "@/lib/api-client";
import AdminCheckoutPage from "../page";

const mockApi = {
  listCheckoutClients: jest.fn(),
  getCheckoutClient: jest.fn(),
  createCheckoutClient: jest.fn(),
  updateCheckoutTerms: jest.fn(),
  getCheckoutPlatformAccount: jest.fn().mockResolvedValue({
    current: null,
    history: [],
    identity: null,
    webhookTarget: "https://api.test/webhooks/efi/pix?ignorar=",
    ready: false,
  }),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

function detail(version: number, bps: number): CheckoutClientDetail {
  return {
    id: "company-1",
    corporateName: "Treze Digital",
    document: "11222333000181",
    email: "contato@treze.test",
    phoneNumber: "11999999999",
    status: "ACTIVE",
    createdAt: "2026-11-03T12:00:00.000Z",
    users: [
      { id: "user-1", name: "Pedro", email: "pedro@treze.test", mustChangePassword: true },
    ],
    terms: [
      {
        id: `terms-${version}`,
        version,
        platformFeeBasisPoints: bps,
        payoutDocument: "11222333000181",
        payoutPixKey: "52998224725",
        changedByUserId: "admin-1",
        createdAt: "2026-11-03T12:00:00.000Z",
      },
    ],
  };
}

describe("AdminCheckoutPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.listCheckoutClients.mockResolvedValue([
      {
        id: "company-1",
        corporateName: "Treze Digital",
        document: "11222333000181",
        email: "contato@treze.test",
        status: "ACTIVE",
        createdAt: "2026-11-03T12:00:00.000Z",
        currentTerms: { version: 1, platformFeeBasisPoints: 250 },
        activeProducts: 2,
      },
    ]);
  });

  it("falha ao carregar não aparece como lista vazia", async () => {
    mockApi.listCheckoutClients.mockRejectedValue(new Error("offline"));
    render(<AdminCheckoutPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(
      screen.queryByText(/nenhum cliente de checkout/i),
    ).not.toBeInTheDocument();
  });

  it("cria cliente com a % em pontos-base e mostra a senha uma vez", async () => {
    const user = userEvent.setup();
    mockApi.createCheckoutClient.mockResolvedValue({
      client: detail(1, 250),
      temporaryPassword: "senha-temp",
    });
    mockApi.getCheckoutClient.mockResolvedValue(detail(1, 250));
    render(<AdminCheckoutPage />);
    await screen.findByText("Treze Digital");

    await user.click(screen.getByRole("button", { name: /novo cliente de checkout/i }));
    await user.type(screen.getByLabelText("Razão social"), "Treze Digital");
    await user.type(screen.getByLabelText("CPF/CNPJ"), "11.222.333/0001-81");
    await user.type(screen.getByLabelText("E-mail da empresa"), "contato@treze.test");
    await user.type(screen.getByLabelText("Telefone"), "11999999999");
    await user.type(screen.getByLabelText("Nome do usuário"), "Pedro");
    await user.type(screen.getByLabelText("E-mail de acesso"), "pedro@treze.test");
    await user.type(screen.getByLabelText("% Cifra+ por venda"), "2,5");
    await user.type(screen.getByLabelText("CPF/CNPJ de repasse"), "11222333000181");
    await user.type(screen.getByLabelText("Chave Pix de repasse"), "52998224725");
    await user.click(screen.getByRole("button", { name: /criar cliente/i }));

    await waitFor(() =>
      expect(mockApi.createCheckoutClient).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: {
            platformFeeBasisPoints: 250,
            payoutDocument: "11222333000181",
            payoutPixKey: "52998224725",
          },
        }),
      ),
    );
    expect(await screen.findByText("senha-temp")).toBeInTheDocument();
  });

  it("termos alterados por outra pessoa são recarregados, sem sobrescrever", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutClient
      .mockResolvedValueOnce(detail(1, 250))
      .mockResolvedValueOnce(detail(2, 300));
    mockApi.updateCheckoutTerms.mockRejectedValue(
      Object.assign(new Error("Outra pessoa alterou"), {
        status: 409,
        data: { code: "VERSION_CHANGED" },
      }),
    );
    render(<AdminCheckoutPage />);

    await user.click(await screen.findByRole("button", { name: /ver termos/i }));
    await screen.findByText(/termos atuais \(versão 1\)/i);
    await user.click(screen.getByRole("button", { name: /salvar nova versão/i }));

    expect(mockApi.updateCheckoutTerms).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ expectedVersion: 1, platformFeeBasisPoints: 250 }),
    );
    expect(await screen.findByText(/termos atuais \(versão 2\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText("% Cifra+ por venda")).toHaveValue("3");
    expect(screen.getByRole("alert")).toHaveTextContent(/outra pessoa alterou/i);
  });
});
