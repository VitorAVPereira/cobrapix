import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminClientAnalyticsResponse } from "@/lib/api-client";
import AdminOverviewPage from "../page";

const mockGetAdminClientAnalytics = jest.fn() as jest.MockedFunction<
  (params?: unknown) => Promise<AdminClientAnalyticsResponse>
>;
const mockApiClient = {
  getAdminClientAnalytics: mockGetAdminClientAnalytics,
};

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        role: "PLATFORM_ADMIN",
      },
    },
  }),
}));

function createAnalyticsFixture(): AdminClientAnalyticsResponse {
  return {
    period: {
      key: "current_month",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-07-01T00:00:00.000Z",
    },
    totals: {
      totalChargedAmount: 1100,
      activeChargesCount: 1,
      overduePendingChargesCount: 1,
      canceledChargesCount: 1,
      pendingTotalAmount: 300,
      overduePendingAmount: 200,
      whatsappSentCount: 2,
      whatsappCostAmount: 0.66,
      emailSentCount: 1,
      emailCostAmount: 0,
      averageTicketAmount: 200,
      recoveredChargesCount: 1,
      recoveredAmount: 300,
    },
    clients: [
      {
        companyId: "company-1",
        corporateName: "Alpha Escola",
        document: "11111111000191",
        email: "alpha@example.com",
        status: "ACTIVE",
        metrics: {
          totalChargedAmount: 800,
          activeChargesCount: 1,
          overduePendingChargesCount: 1,
          canceledChargesCount: 1,
          pendingTotalAmount: 300,
          overduePendingAmount: 200,
          whatsappSentCount: 1,
          whatsappCostAmount: 0.33,
          emailSentCount: 1,
          emailCostAmount: 0,
          averageTicketAmount: 150,
          recoveredChargesCount: 0,
          recoveredAmount: 0,
        },
      },
    ],
    pagination: { page: 1, pageSize: 50, total: 1 },
  };
}

describe("AdminOverviewPage", () => {
  beforeEach(() => {
    mockGetAdminClientAnalytics.mockReset();
    mockGetAdminClientAnalytics.mockResolvedValue(createAnalyticsFixture());
  });

  it("renders macro cards and client table", async () => {
    render(<AdminOverviewPage />);

    expect(await screen.findByText("Visao geral")).toBeInTheDocument();
    expect(await screen.findByText(/R\$\s*1\.100,00/)).toBeInTheDocument();
    expect(screen.getByText("Alpha Escola")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*0,66/)).toBeInTheDocument();
    expect(mockGetAdminClientAnalytics).toHaveBeenCalledWith({
      period: "current_month",
      search: "",
    });
  });

  it("reloads analytics when searching for a client", async () => {
    const user = userEvent.setup();
    render(<AdminOverviewPage />);

    await screen.findByText("Alpha Escola");
    await user.type(screen.getByLabelText("Buscar cliente"), "beta");

    await waitFor(() =>
      expect(mockGetAdminClientAnalytics).toHaveBeenLastCalledWith({
        period: "current_month",
        search: "beta",
      }),
    );
  });

  it("loads analytics with a custom date range", async () => {
    const user = userEvent.setup();
    render(<AdminOverviewPage />);

    await screen.findByText("Alpha Escola");
    await user.click(screen.getByRole("button", { name: "Personalizado" }));
    await user.type(screen.getByLabelText("Data inicial"), "2026-06-01");
    await user.type(screen.getByLabelText("Data final"), "2026-06-30");

    await waitFor(() =>
      expect(mockGetAdminClientAnalytics).toHaveBeenLastCalledWith({
        period: "custom",
        search: "",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
      }),
    );
  });
});
