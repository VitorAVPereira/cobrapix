import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutWebhookDelivery, CheckoutWebhookRule } from "@/lib/api-client";
import { WebhookPanel } from "../WebhookPanel";

const mockApi = {
  listCheckoutWebhookRules: jest.fn(),
  listCheckoutProducts: jest.fn(),
  createCheckoutWebhookRule: jest.fn(),
  updateCheckoutWebhookRule: jest.fn(),
  deleteCheckoutWebhookRule: jest.fn(),
  rotateCheckoutWebhookSecret: jest.fn(),
  enableCheckoutWebhookRule: jest.fn(),
  testCheckoutWebhookRule: jest.fn(),
  listCheckoutWebhookDeliveries: jest.fn(),
  resendCheckoutWebhook: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const rule = (change: Partial<CheckoutWebhookRule> = {}): CheckoutWebhookRule => ({
  id: "r1",
  name: "Área de membros",
  url: "https://api.porquim.test/hook",
  events: [],
  productIds: [],
  failingSince: null,
  disabledAt: null,
  version: 1,
  createdAt: "2026-11-06T12:00:00.000Z",
  ...change,
});
const failed: CheckoutWebhookDelivery = {
  id: "d1",
  ruleId: "r1",
  eventId: "evt_1",
  eventType: "order.paid",
  orderId: "o1",
  status: "FAILED",
  attempts: 9,
  lastStatusCode: 500,
  lastError: "HTTP_STATUS",
  nextAttemptAt: null,
  deliveredAt: null,
  createdAt: "2026-11-06T12:00:00.000Z",
};

describe("WebhookPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.listCheckoutProducts.mockResolvedValue([
      { id: "p1", name: "Porquim Anual" },
      { id: "p2", name: "Guia Renda Fixa" },
    ]);
    mockApi.listCheckoutWebhookDeliveries.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
  });

  it("nova regra com eventos e produtos mostra o segredo uma única vez", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutWebhookRules.mockResolvedValueOnce([]).mockResolvedValue([rule({ id: "r2", name: "Guia" })]);
    mockApi.createCheckoutWebhookRule.mockResolvedValue({ ...rule({ id: "r2", name: "Guia" }), secret: "whsec_abc" });
    render(<WebhookPanel />);

    await user.click(await screen.findByRole("button", { name: /nova regra/i }));
    const form = screen.getByRole("form", { name: "Nova regra" });
    await user.type(within(form).getByLabelText("Nome da regra"), "Guia");
    await user.type(within(form).getByLabelText("URL do seu sistema"), "https://guia.porquim.test/hook");
    await user.click(within(form).getByLabelText("Pago"));
    await user.click(within(form).getByLabelText("Guia Renda Fixa"));
    await user.click(within(form).getByRole("button", { name: /salvar regra/i }));

    expect(mockApi.createCheckoutWebhookRule).toHaveBeenCalledWith({
      name: "Guia",
      url: "https://guia.porquim.test/hook",
      events: ["order.paid"],
      productIds: ["p2"],
    });
    expect(await screen.findByText("whsec_abc")).toBeInTheDocument();
  });

  it("editar manda a versão; versão antiga recarrega em vez de sobrescrever", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutWebhookRules.mockResolvedValue([rule({ version: 3, productIds: ["p1"] })]);
    mockApi.updateCheckoutWebhookRule.mockRejectedValue(Object.assign(new Error("x"), { data: { code: "VERSION_CHANGED" } }));
    render(<WebhookPanel />);

    expect(await screen.findByText(/Produtos: Porquim Anual/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.click(screen.getByRole("button", { name: /salvar regra/i }));

    expect(mockApi.updateCheckoutWebhookRule).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ version: 3, productIds: ["p1"] }),
    );
    expect(await screen.findByText(/alterada em outra tela/)).toBeInTheDocument();
    await waitFor(() => expect(mockApi.listCheckoutWebhookRules).toHaveBeenCalledTimes(2));
  });

  it("regra desligada mostra o motivo e religa só ela", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutWebhookRules.mockResolvedValue([
      rule({ disabledAt: "2026-11-06T12:00:00.000Z" }),
      rule({ id: "r2", name: "Guia" }),
    ]);
    mockApi.enableCheckoutWebhookRule.mockResolvedValue(rule());
    render(<WebhookPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/3 dias sem responder/);
    await user.click(screen.getByRole("button", { name: /religar/i }));
    await waitFor(() => expect(mockApi.enableCheckoutWebhookRule).toHaveBeenCalledWith("r1"));
  });

  it("histórico da regra mostra a resposta e permite reenviar o que falhou", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutWebhookRules.mockResolvedValue([rule()]);
    mockApi.listCheckoutWebhookDeliveries.mockResolvedValue({ total: 1, page: 1, pageSize: 20, items: [failed] });
    mockApi.resendCheckoutWebhook.mockResolvedValue(undefined);
    render(<WebhookPanel />);

    await user.click(await screen.findByRole("button", { name: /ver histórico/i }));
    expect(await screen.findByText("HTTP 500")).toBeInTheDocument();
    expect(mockApi.listCheckoutWebhookDeliveries).toHaveBeenCalledWith("r1", { page: 1, pageSize: 20 }, expect.anything());
    await user.click(screen.getByRole("button", { name: /reenviar/i }));
    await waitFor(() => expect(mockApi.resendCheckoutWebhook).toHaveBeenCalledWith("d1"));
  });

  it("excluir pede confirmação", async () => {
    const user = userEvent.setup();
    mockApi.listCheckoutWebhookRules.mockResolvedValue([rule()]);
    mockApi.deleteCheckoutWebhookRule.mockResolvedValue(undefined);
    render(<WebhookPanel />);

    await user.click(await screen.findByRole("button", { name: "Excluir" }));
    expect(mockApi.deleteCheckoutWebhookRule).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /confirmar exclusão/i }));
    await waitFor(() => expect(mockApi.deleteCheckoutWebhookRule).toHaveBeenCalledWith("r1"));
  });

  it("falha ao carregar não aparece como lista vazia", async () => {
    mockApi.listCheckoutWebhookRules.mockRejectedValue(new Error("Falha de rede"));
    render(<WebhookPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    expect(screen.queryByText(/nenhuma regra/i)).not.toBeInTheDocument();
  });
});
