import { renderHook } from "@testing-library/react";
import { useSession } from "next-auth/react";
import { useApiClient } from "../use-api-client";

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(),
}));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

global.fetch = mockFetch;

describe("useApiClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUseSession.mockReset();
  });

  it("does not call protected API endpoints while the session token is missing", async () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "loading",
      update: jest.fn(),
    });

    const { result } = renderHook(() => useApiClient());

    await expect(result.current.getBillingMetrics("30d")).rejects.toMatchObject(
      {
        status: 401,
      },
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends the bearer token after the session is authenticated", async () => {
    mockUseSession.mockReturnValue({
      data: {
        access_token: "session-token",
        expires: "2026-05-31T00:00:00.000Z",
        user: {
          id: "user-1",
          email: "admin@cobrapix.com",
          companyId: "company-1",
          role: "COMPANY_ADMIN",
        },
      },
      status: "authenticated",
      update: jest.fn(),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        period: "30d",
        activeCharges: 0,
        pendingAmount: 0,
        recoveredAmount: 0,
        recoveryRate: 0,
        paidCharges: 0,
        overdueCharges: 0,
        generatedPayments: 0,
        queuedMessages: 0,
        sentMessages: 0,
      }),
    } as Response);

    const { result } = renderHook(() => useApiClient());

    await result.current.getBillingMetrics("30d");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/billing/metrics?period=30d",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
        }),
      }),
    );
  });
});
