import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutRecoveryItem } from "@/lib/api-client";
import CheckoutRecoveryPage from "@/app/(dashboard)/checkout/recuperacao/page";
import { recoveryWhatsAppLink } from "@/lib/checkout";

const mockApi = {
  listCheckoutProducts: jest.fn(),
  listCheckoutRecovery: jest.fn(),
  fetchCheckoutRecoveryCsv: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const pix: CheckoutRecoveryItem = {
  id: "o1",
  kind: "PIX",
  reason: "Pix não pago",
  productId: "p1",
  productName: "Porquim Anual",
  name: "Maria Souza",
  email: "maria@exemplo.test",
  phone: "11999999999",
  document: "52998224725",
  totalCents: 6700,
  createdAt: "2026-11-06T12:00:00.000Z",
  recovered: false,
};
const lead: CheckoutRecoveryItem = {
  ...pix,
  id: "l1",
  kind: "LEAD",
  reason: "Saiu antes de gerar o Pix",
  name: null,
  phone: null,
  totalCents: null,
};

describe("Recuperação do vendedor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.listCheckoutProducts.mockResolvedValue([{ id: "p1", name: "Porquim Anual" }]);
    mockApi.listCheckoutRecovery.mockResolvedValue({ total: 2, page: 1, pageSize: 20, items: [pix, lead] });
  });

  it("abre com quem está a recuperar nos últimos 30 dias", async () => {
    render(<CheckoutRecoveryPage />);

    expect(await screen.findByText("Maria Souza")).toBeInTheDocument();
    const [query] = mockApi.listCheckoutRecovery.mock.calls[0] as [{ state: string; from: string }];
    expect(query.state).toBe("OPEN");
    expect(Date.now() - new Date(query.from).getTime()).toBeGreaterThan(29 * 86_400_000);
    expect(Date.now() - new Date(query.from).getTime()).toBeLessThan(31 * 86_400_000);
  });

  it("WhatsApp só aparece com celular, com a mensagem pronta", async () => {
    render(<CheckoutRecoveryPage />);
    await screen.findByText("Maria Souza");

    const links = screen.getAllByRole("link", { name: /whatsapp/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", recoveryWhatsAppLink("11999999999", "Maria Souza", "Porquim Anual"));
    expect(decodeURIComponent(links[0]?.getAttribute("href") ?? "")).toContain(
      "Olá, Maria! Vi que você começou a compra de Porquim Anual e não concluiu. Posso ajudar?",
    );
    expect(screen.getByText("Sem nome")).toBeInTheDocument();
  });

  it("filtro de recuperados busca de novo, da primeira página", async () => {
    const user = userEvent.setup();
    render(<CheckoutRecoveryPage />);
    await screen.findByText("Maria Souza");

    mockApi.listCheckoutRecovery.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
    await user.selectOptions(screen.getByLabelText("Situação"), "RECOVERED");

    expect(await screen.findByText("Nenhuma compra recuperada neste período.")).toBeInTheDocument();
    expect(mockApi.listCheckoutRecovery).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "RECOVERED", page: 1 }),
      expect.any(AbortSignal),
    );
  });

  it("falha ao carregar não vira lista vazia", async () => {
    mockApi.listCheckoutRecovery.mockRejectedValue(new Error("Servidor fora do ar"));
    render(<CheckoutRecoveryPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Servidor fora do ar");
    expect(screen.queryByText(/ninguém para recuperar/i)).not.toBeInTheDocument();
  });

  it("exporta o CSV com os filtros da tela", async () => {
    const user = userEvent.setup();
    const createObjectURL = jest.fn(() => "blob:x");
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    mockApi.fetchCheckoutRecoveryCsv.mockResolvedValue(new Blob(["a;b"]));
    render(<CheckoutRecoveryPage />);
    await screen.findByText("Maria Souza");

    await user.selectOptions(screen.getByLabelText("Tipo"), "PIX");
    await user.click(screen.getByRole("button", { name: /exportar csv/i }));

    await waitFor(() =>
      expect(mockApi.fetchCheckoutRecoveryCsv).toHaveBeenCalledWith(expect.objectContaining({ kind: "PIX", state: "OPEN" })),
    );
    expect(createObjectURL).toHaveBeenCalled();
  });
});
