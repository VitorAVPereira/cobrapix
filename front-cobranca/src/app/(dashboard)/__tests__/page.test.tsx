import { render, screen, within } from "@testing-library/react";
import DashboardPage from "../page";

const mockApi = {
  getBillingMetrics: jest.fn(),
  getWhatsappStats: jest.fn(),
  getWhatsappUsage: jest.fn(),
  getChannelCapacity: jest.fn(),
  getEmailStats: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getBillingMetrics.mockResolvedValue({
    period: "30d",
    activeCharges: 3,
    pendingAmount: 300,
    recoveredAmount: 100,
    recoveryRate: 25,
    paidCharges: 1,
    overdueCharges: 1,
    generatedPayments: 2,
    queuedMessages: 1,
    sentMessages: 2,
  });
  mockApi.getWhatsappStats.mockResolvedValue({
    period: "rolling_24h",
    interactions: { outbound: 7, delivered: 6, read: 4, inbound: 3, failed: 1 },
  });
  mockApi.getEmailStats.mockResolvedValue({
    period: "30d",
    periodStart: "2026-08-30T15:00:00.000Z",
    sent: 9,
    delivered: 8,
    opened: 5,
    clicked: 2,
    bounced: 0,
    complained: 0,
    failed: 1,
  });
});

it("keeps the company's own WhatsApp and e-mail results with their real periods", async () => {
  render(<DashboardPage />);
  const whatsapp = await screen.findByRole("region", { name: "WhatsApp" });
  expect(within(whatsapp).getByRole("heading", { name: "Mensagens de WhatsApp" })).toBeInTheDocument();
  expect(within(whatsapp).getAllByText("Últimas 24 horas")).toHaveLength(2);
  for (const [value, label] of [
    ["7", "enviadas"],
    ["6", "entregues"],
    ["4", "lidas"],
    ["1", "falhas"],
    ["3", "mensagens recebidas"],
  ])
    expect(within(whatsapp).getByText(label).previousElementSibling).toHaveTextContent(value);
  expect(await screen.findByRole("heading", { name: "E-mails de cobrança" })).toBeInTheDocument();
  expect(screen.getByText("Últimos 30 dias")).toBeInTheDocument();
});

it("shows no channel limit, capacity, tier or quality to a company", async () => {
  render(<DashboardPage />);
  const whatsapp = await screen.findByRole("region", { name: "WhatsApp" });
  expect(screen.queryByText(/Limite|restantes|Tier|qualidade|seu n[uú]mero/i)).toBeNull();
  // A moving 24 h window is not called "today".
  expect(within(whatsapp).queryByText(/hoje/i)).toBeNull();
  expect(mockApi.getWhatsappUsage).not.toHaveBeenCalled();
  expect(mockApi.getChannelCapacity).not.toHaveBeenCalled();
});

it("still renders the financial dashboard when message statistics are unavailable", async () => {
  mockApi.getWhatsappStats.mockRejectedValue(new Error("offline"));
  mockApi.getEmailStats.mockRejectedValue(new Error("offline"));
  render(<DashboardPage />);
  expect(await screen.findByText("Cobranças Ativas")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "WhatsApp" })).toBeNull();
});
