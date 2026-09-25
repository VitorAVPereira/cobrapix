import { render, screen } from "@testing-library/react";
import { FinancialHistoryPanel } from "../FinancialHistoryPanel";

const mockApi = { getFinancialHistory: jest.fn() };
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

it("lists versions and redacted events of the requested company", async () => {
  mockApi.getFinancialHistory.mockResolvedValue({
    versions: [
      { id: "v2", version: 2, status: "ACTIVE", origin: "MANUAL_ADMIN", accountMode: "CUSTOMER_ACCOUNT", payoutMode: "DIRECT_TO_CUSTOMER", environment: "PRODUCTION", enabledMethods: ["PIX"], issuerAccount: "••••1234", credentialVersion: 2, certificateExpiresAt: "2027-01-01T00:00:00Z", authorizationKind: "ACCOUNT_INTEGRATION_AUTHORIZATION", authorizationReference: "contrato-7", activatedAt: "2026-09-01T00:00:00Z", activatedBy: "Admin", supersededAt: null, canceledAt: null, cancelReason: null, createdAt: "2026-08-30T00:00:00Z" },
      { id: "v1", version: 1, status: "SUPERSEDED", origin: "AUTOMATIC_OPENING", accountMode: "CUSTOMER_ACCOUNT", payoutMode: "DIRECT_TO_CUSTOMER", environment: "PRODUCTION", enabledMethods: ["PIX"], issuerAccount: "••••9999", credentialVersion: 1, certificateExpiresAt: null, authorizationKind: null, authorizationReference: null, activatedAt: null, activatedBy: null, supersededAt: "2026-09-01T00:00:00Z", canceledAt: null, cancelReason: null, createdAt: "2026-08-01T00:00:00Z" },
    ],
    events: [
      { id: "e1", action: "FINANCIAL_ACTIVATION_ACTIVATED", entityType: "FinancialProfileVersion", actor: "Admin", createdAt: "2026-09-01T00:00:00Z", details: { credentialVersion: 2 } },
    ],
  });
  render(<FinancialHistoryPanel companyId="company-1" />);
  expect(await screen.findByText(/Versão 2 · Ativo|Versão 2/)).toBeInTheDocument();
  expect(screen.getByText(/abertura automática/)).toBeInTheDocument();
  expect(screen.getByText(/Conta ••••1234/)).toBeInTheDocument();
  expect(screen.getByText("Financeiro ativado")).toBeInTheDocument();
  expect(screen.getByText("credentialVersion: 2")).toBeInTheDocument();
  expect(mockApi.getFinancialHistory).toHaveBeenCalledWith("company-1");
});
