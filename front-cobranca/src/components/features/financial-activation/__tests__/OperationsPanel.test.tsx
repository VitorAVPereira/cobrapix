import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OperationsPanel } from "../OperationsPanel";

const mockAdmin = jest.fn();
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => ({ financialAdmin: mockAdmin }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAdmin.mockImplementation(async (path: string) => {
    if (path === "/admin/efi-onboarding/company-1")
      return { gateway: { status: "ACTIVE", environment: "production", healthStatus: "UNAVAILABLE", certificateExpiresAt: "2027-01-01T00:00:00Z", lastValidatedAt: "2026-09-25T10:00:00Z", consecutiveFailures: 2, lastError: "EFI_UNAVAILABLE" }, onboarding: null, timeline: [] };
    if (path === "/admin/payment-charges/company-1/attention")
      return [{ id: "charge-1", invoiceId: "invoice-12345678", billingMethod: "PIX", status: "PENDING", gatewayStatusRaw: "SUBMITTING", grossAmountCents: 3000, createdAt: "2026-09-25T09:00:00Z" }];
    if (path.endsWith("/reconcile")) return { status: "PAID" };
    return {};
  });
});

it("shows health, forces a check and reconciles an uncertain issuance without resubmitting", async () => {
  const user = userEvent.setup();
  render(<OperationsPanel companyId="company-1" />);
  expect(await screen.findByText("Indisponível — emissões bloqueadas")).toBeInTheDocument();
  expect(screen.getByText(/SUBMITTING/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Validar integração agora" }));
  await waitFor(() => expect(mockAdmin).toHaveBeenCalledWith("/admin/efi-onboarding/company-1/validate", "POST"));
  await user.click(screen.getByRole("button", { name: "Conciliar com a Efí" }));
  await waitFor(() => expect(mockAdmin).toHaveBeenCalledWith("/admin/payment-charges/company-1/charge-1/reconcile", "POST"));
  expect(await screen.findByRole("status")).toHaveTextContent("PAID");
  expect(mockAdmin.mock.calls.some(([path]) => String(path).includes("/payments/create"))).toBe(false);
});
