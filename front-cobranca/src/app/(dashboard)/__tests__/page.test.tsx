import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { CompanyDashboard } from "@/lib/api-client";
import DashboardPage from "../page";

const mockApi = {
  getCompanyDashboard: jest.fn(),
  getWhatsappUsage: jest.fn(),
  getChannelCapacity: jest.fn(),
};
// The client changes once the session token arrives, as useApiClient does.
let mockClient: typeof mockApi = mockApi;
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockClient }));

// Recharts measures its container; jsdom has no ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function dashboard(overrides: Partial<CompanyDashboard> = {}): CompanyDashboard {
  return {
    period: {
      key: "30d",
      startDate: "2026-09-18",
      endDate: "2026-10-17",
      previousStartDate: "2026-08-19",
      previousEndDate: "2026-09-17",
      granularity: "day",
    },
    received: { amount: 1500, count: 3 },
    collectionRate: { dueAmount: 2000, paidAmount: 1500, rate: 75, previousRate: 80 },
    open: {
      amount: 900,
      count: 4,
      upcomingAmount: 600,
      upcomingCount: 3,
      overdueAmount: 300,
      overdueCount: 1,
    },
    overdueAging: [
      { range: "1-15", amount: 300, count: 1 },
      { range: "16-30", amount: 0, count: 0 },
      { range: "31-60", amount: 0, count: 0 },
      { range: "60+", amount: 0, count: 0 },
    ],
    receivedSeries: [
      { date: "2026-10-16", amount: 1000, count: 2 },
      { date: "2026-10-17", amount: 500, count: 1 },
    ],
    receivedByMethod: [
      { method: "PIX", amount: 1000, count: 2 },
      { method: "BOLETO", amount: 0, count: 0 },
      { method: "CARD", amount: 500, count: 1 },
    ],
    whatsapp: { sent: 7, delivered: 6, read: 4, failed: 1, replies: 3 },
    email: { sent: 9, delivered: 8, opened: 5, clicked: 2 },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = mockApi;
  mockApi.getCompanyDashboard.mockResolvedValue(dashboard());
});

it("shows the period, the indicators with their change and every block", async () => {
  render(<DashboardPage />);

  expect(screen.getByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
  expect(
    await screen.findByText(
      "18 de set. a 17 de out. de 2026",
    ),
  ).toBeInTheDocument();
  expect(mockApi.getCompanyDashboard).toHaveBeenCalledWith(
    { period: "30d" },
    expect.any(AbortSignal),
  );

  const kpis = screen.getByRole("region", { name: "Indicadores" });
  expect(within(kpis).getByText("R$ 1.500,00")).toBeInTheDocument();
  expect(within(kpis).getByText("75%")).toBeInTheDocument();
  // Received has no comparison, and a lower rate (75% after 80%) is not highlighted.
  expect(within(kpis).queryByText(/período anterior|antes:/)).toBeNull();
  expect(within(kpis).getByText("R$ 900,00")).toBeInTheDocument();
  expect(within(kpis).getByText("1 fatura hoje")).toBeInTheDocument();

  for (const name of [
    "Recebimentos por dia",
    "Carteira em aberto",
    "Vencidas por atraso",
    "Recebido por forma de pagamento",
    "Comunicação",
  ])
    expect(screen.getByRole("region", { name })).toBeInTheDocument();

  const methods = screen.getByRole("region", { name: "Recebido por forma de pagamento" });
  expect(within(methods).getByText("Pix")).toBeInTheDocument();
  expect(within(methods).getByText("Boleto")).toBeInTheDocument();
  expect(within(methods).getByText("Cartão")).toBeInTheDocument();

  const communication = screen.getByRole("region", { name: "Comunicação" });
  for (const [label, value] of [
    ["Enviadas", "7"],
    ["Lidas", "4"],
    ["Respostas", "3"],
    ["Abertos", "5"],
  ])
    expect(within(communication).getByText(label).nextElementSibling).toHaveTextContent(value);
});

it("has no technical jargon nor channel limits", async () => {
  render(<DashboardPage />);
  await screen.findByRole("region", { name: "Indicadores" });

  expect(screen.queryByText(/Cockpit|webhook|Efí|fila|ROI|logs/i)).toBeNull();
  expect(screen.queryByText(/Limite|restantes|Tier|qualidade/i)).toBeNull();
  expect(mockApi.getWhatsappUsage).not.toHaveBeenCalled();
  expect(mockApi.getChannelCapacity).not.toHaveBeenCalled();
});

it("reloads with the chosen preset and validates a custom range before applying it", async () => {
  render(<DashboardPage />);
  await screen.findByRole("region", { name: "Indicadores" });

  fireEvent.click(screen.getByRole("button", { name: "Este mês" }));
  expect(mockApi.getCompanyDashboard).toHaveBeenLastCalledWith(
    { period: "month" },
    expect.any(AbortSignal),
  );
  await screen.findByRole("region", { name: "Indicadores" });

  fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
  fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-30" } });
  fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
  expect(await screen.findByText("A data final deve ser igual ou posterior à inicial.")).toBeVisible();
  expect(mockApi.getCompanyDashboard).toHaveBeenCalledTimes(2);

  fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-30" } });
  fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
  expect(mockApi.getCompanyDashboard).toHaveBeenLastCalledWith(
    { period: "custom", startDate: "2026-09-01", endDate: "2026-09-30" },
    expect.any(AbortSignal),
  );
  await screen.findByRole("region", { name: "Indicadores" });
});

it("drops a slower answer of a previous period", async () => {
  const slow = deferred<CompanyDashboard>();
  mockApi.getCompanyDashboard
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValueOnce(dashboard({ received: { amount: 42, count: 1 } }));
  render(<DashboardPage />);

  fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
  expect(await screen.findByText("R$ 42,00")).toBeInTheDocument();
  await act(async () => slow.resolve(dashboard()));
  expect(screen.getByText("R$ 42,00")).toBeInTheDocument();
  expect(screen.queryByText("R$ 1.500,00")).toBeNull();
});

it("a failure is an error with retry, not an empty dashboard", async () => {
  mockApi.getCompanyDashboard.mockRejectedValueOnce(new Error("offline"));
  render(<DashboardPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar o painel.");
  expect(screen.queryByRole("region", { name: "Indicadores" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("region", { name: "Indicadores" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("explains empty blocks instead of drawing empty charts", async () => {
  const empty = dashboard();
  mockApi.getCompanyDashboard.mockResolvedValue({
    ...empty,
    received: { amount: 0, count: 0 },
    collectionRate: { dueAmount: 0, paidAmount: 0, rate: null, previousRate: null },
    open: { amount: 0, count: 0, upcomingAmount: 0, upcomingCount: 0, overdueAmount: 0, overdueCount: 0 },
    overdueAging: empty.overdueAging.map((row) => ({ ...row, amount: 0, count: 0 })),
    receivedSeries: empty.receivedSeries.map((row) => ({ ...row, amount: 0, count: 0 })),
    receivedByMethod: empty.receivedByMethod.map((row) => ({ ...row, amount: 0, count: 0 })),
  });
  render(<DashboardPage />);

  expect(await screen.findAllByText("Nenhum recebimento no período.")).toHaveLength(2);
  expect(screen.getByText("Nenhuma fatura em aberto.")).toBeInTheDocument();
  expect(screen.getByText("Nenhuma fatura vencida.")).toBeInTheDocument();
  expect(screen.getByText("Nenhuma fatura venceu no período")).toBeInTheDocument();
  expect(screen.queryByText(/antes:/)).toBeNull();
});

it("an attempt before the session loads does not leave an error once it loads", async () => {
  mockClient = {
    ...mockApi,
    getCompanyDashboard: jest.fn().mockRejectedValue(new Error("Sessao autenticada ainda nao carregada.")),
  };
  const { rerender } = render(<DashboardPage />);
  expect(await screen.findByRole("alert")).toBeVisible();

  mockClient = mockApi;
  rerender(<DashboardPage />);
  expect(await screen.findByRole("region", { name: "Indicadores" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("highlights the collection rate only when it improved, with the previous rate", async () => {
  mockApi.getCompanyDashboard.mockResolvedValue(
    dashboard({ collectionRate: { dueAmount: 2000, paidAmount: 1800, rate: 90, previousRate: 82.5 } }),
  );
  render(<DashboardPage />);

  const kpis = await screen.findByRole("region", { name: "Indicadores" });
  expect(within(kpis).getByText("antes: 82,5%")).toBeInTheDocument();
});
