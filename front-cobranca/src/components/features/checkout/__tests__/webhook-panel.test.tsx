import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutWebhookDelivery, CheckoutWebhookView } from "@/lib/api-client";
import { WebhookPanel } from "../WebhookPanel";

const mockApi = {
  getCheckoutWebhook: jest.fn(),
  listCheckoutWebhookDeliveries: jest.fn(),
  setCheckoutWebhookUrl: jest.fn(),
  rotateCheckoutWebhookSecret: jest.fn(),
  enableCheckoutWebhook: jest.fn(),
  testCheckoutWebhook: jest.fn(),
  resendCheckoutWebhook: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const view = (change: Partial<CheckoutWebhookView> = {}): CheckoutWebhookView => ({
  url: null,
  hasSecret: false,
  failingSince: null,
  disabledAt: null,
  version: 1,
  ...change,
});
const failed: CheckoutWebhookDelivery = {
  id: "d1",
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
    mockApi.listCheckoutWebhookDeliveries.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
  });

  it("a primeira URL mostra o segredo uma única vez", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutWebhook.mockResolvedValue(view());
    mockApi.setCheckoutWebhookUrl.mockResolvedValue({ ...view({ url: "https://api.porquim.test/hook", hasSecret: true }), secret: "whsec_abc" });
    render(<WebhookPanel />);

    await user.type(await screen.findByLabelText("URL do seu sistema"), "https://api.porquim.test/hook");
    await user.click(screen.getByRole("button", { name: /salvar url/i }));

    expect(mockApi.setCheckoutWebhookUrl).toHaveBeenCalledWith({ url: "https://api.porquim.test/hook" });
    expect(await screen.findByText("whsec_abc")).toBeInTheDocument();
  });

  it("desligado mostra o motivo e religa", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutWebhook.mockResolvedValue(
      view({ url: "https://api.porquim.test/hook", hasSecret: true, disabledAt: "2026-11-06T12:00:00.000Z" }),
    );
    mockApi.enableCheckoutWebhook.mockResolvedValue(view({ url: "https://api.porquim.test/hook", hasSecret: true }));
    render(<WebhookPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/3 dias sem responder/);
    await user.click(screen.getByRole("button", { name: /religar/i }));
    await waitFor(() => expect(mockApi.enableCheckoutWebhook).toHaveBeenCalled());
  });

  it("histórico mostra a resposta e permite reenviar o que falhou", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutWebhook.mockResolvedValue(view({ url: "https://api.porquim.test/hook", hasSecret: true }));
    mockApi.listCheckoutWebhookDeliveries.mockResolvedValue({ total: 1, page: 1, pageSize: 20, items: [failed] });
    mockApi.resendCheckoutWebhook.mockResolvedValue(undefined);
    render(<WebhookPanel />);

    expect(await screen.findByText("HTTP 500")).toBeInTheDocument();
    expect(screen.getByText("Falhou")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reenviar/i }));
    expect(mockApi.resendCheckoutWebhook).toHaveBeenCalledWith("d1");
  });

  it("o teste mostra se o sistema do vendedor aceitou", async () => {
    const user = userEvent.setup();
    mockApi.getCheckoutWebhook.mockResolvedValue(view({ url: "https://api.porquim.test/hook", hasSecret: true }));
    mockApi.testCheckoutWebhook.mockResolvedValue({ ...failed, eventType: "webhook.test", lastStatusCode: 401 });
    render(<WebhookPanel />);

    await user.click(await screen.findByRole("button", { name: /enviar teste/i }));
    expect(await screen.findByText(/o teste não foi aceito \(http 401\)/i)).toBeInTheDocument();
  });
});
