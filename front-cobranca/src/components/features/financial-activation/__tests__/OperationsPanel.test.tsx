import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OperationsPanel } from "../OperationsPanel";

const mockAdmin = jest.fn();
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => ({ financialAdmin: mockAdmin }) }));

const gateway = { status: "ACTIVE", environment: "production", healthStatus: "UNAVAILABLE", certificateExpiresAt: "2027-01-01T00:00:00Z", lastValidatedAt: "2026-09-25T10:00:00Z", consecutiveFailures: 2, lastError: "EFI_UNAVAILABLE" };

// The two Bolix reported in production: no provider reference, no recorded cause.
const missingReference = { id: "06c5f13e-charge", invoiceId: "06c5f13e-invoice", billingMethod: "BOLIX", status: "PENDING", gatewayStatusRaw: null, grossAmountCents: 300, createdAt: "2026-09-29T18:10:38Z", classification: "MISSING_REFERENCE", hasProviderReference: false, diagnosis: null, lastReconciliation: null, actions: ["RECONCILE"] };
const rejected = { id: "a1b2c3d4-charge", invoiceId: "dfcfed91-invoice", billingMethod: "BOLIX", status: "FAILED", gatewayStatusRaw: null, grossAmountCents: 500, createdAt: "2026-09-29T18:12:27Z", classification: "REJECTED", hasProviderReference: false, diagnosis: { at: "2026-09-29T18:12:28Z", kind: "REJECTED", code: "EFI_VALIDATION_REJECTED", stage: "PROVIDER_REQUEST", field: "/payment/banking_billet/customer/phone_number", message: "A Efí recusou os dados da cobrança: telefone do pagador. Corrija o cadastro e emita novamente." }, lastReconciliation: null, actions: [] };

function serve(attention: unknown[], reconcile: () => Promise<unknown> = async () => ({ status: "PAID", recommendedAction: "NONE" })) {
  mockAdmin.mockImplementation(async (path: string) => {
    if (path === "/admin/efi-onboarding/company-1") return { gateway, onboarding: null, timeline: [] };
    if (path === "/admin/payment-charges/company-1/attention") return attention;
    if (path.endsWith("/reconcile")) return reconcile();
    return {};
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  serve([{ id: "charge-1", invoiceId: "invoice-12345678", billingMethod: "PIX", status: "PENDING", gatewayStatusRaw: "SUBMITTING", grossAmountCents: 3000, createdAt: "2026-09-25T09:00:00Z" }]);
});

it("shows health, forces a check and reconciles an uncertain issuance without resubmitting", async () => {
  const user = userEvent.setup();
  render(<OperationsPanel companyId="company-1" />);
  expect(await screen.findByText("Indisponível — emissões bloqueadas")).toBeInTheDocument();
  expect(screen.getAllByText(/SUBMITTING/).length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Validar integração agora" }));
  await waitFor(() => expect(mockAdmin).toHaveBeenCalledWith("/admin/efi-onboarding/company-1/validate", "POST"));
  await user.click(screen.getByRole("button", { name: "Conciliar com a Efí" }));
  await waitFor(() => expect(mockAdmin).toHaveBeenCalledWith("/admin/payment-charges/company-1/charge-1/reconcile", "POST"));
  expect(await screen.findByRole("status")).toHaveTextContent("PAID");
  expect(mockAdmin.mock.calls.some(([path]) => String(path).includes("/payments/create"))).toBe(false);
});

it("labels each issuance and admits when the original cause was not recorded", async () => {
  serve([missingReference, rejected]);
  render(<OperationsPanel companyId="company-1" />);
  const pending = (await screen.findByText("Referência da Efí necessária")).closest("li") as HTMLElement;
  expect(within(pending).getByText(/Motivo original não registrado/)).toBeInTheDocument();
  expect(within(pending).getByText(/identificador desta tentativa na conta/)).toBeInTheDocument();
  // Brasília time with its zone, for comparison with UTC logs.
  expect(within(pending).getByText(/29\/09\/2026.*15:10:38/)).toBeInTheDocument();
  expect(screen.getByText("Rejeições recentes (30 dias)")).toBeInTheDocument();
  const refused = screen.getByText("Emissão rejeitada").closest("li") as HTMLElement;
  expect(within(refused).getByText(/telefone do pagador/)).toBeInTheDocument();
  expect(within(refused).getByText(/EFI_VALIDATION_REJECTED, no envio à Efí/)).toBeInTheDocument();
  // A refusal is issued again from the invoice, not reconciled here.
  expect(within(refused).queryByRole("button")).toBeNull();
  expect(within(refused).queryByText(/phone_number/)).toBeNull();
});

it("never shows a review outcome as a success", async () => {
  const user = userEvent.setup();
  serve([missingReference], async () => ({ status: "REVIEW_REQUIRED", reasonCode: "PROVIDER_REFERENCE_MISMATCH", recommendedAction: "CONTACT_EFI" }));
  render(<OperationsPanel companyId="company-1" />);
  await user.click(await screen.findByRole("button", { name: "Conciliar com a Efí" }));
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("Revisão necessária");
  expect(status).toHaveTextContent("não corresponde a esta tentativa");
  expect(status.className).not.toContain("emerald");
});

it("explains a released reservation that Efí does not have", async () => {
  const user = userEvent.setup();
  serve([missingReference], async () => ({ status: "FAILED", reasonCode: "PROVIDER_NOT_FOUND", recommendedAction: "REISSUE" }));
  render(<OperationsPanel companyId="company-1" />);
  await user.click(await screen.findByRole("button", { name: "Conciliar com a Efí" }));
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("A Efí não possui essa emissão");
  expect(status).toHaveTextContent("emita a fatura novamente");
  expect(status.className).not.toContain("emerald");
});

it("reports a failed consultation without a success message", async () => {
  const user = userEvent.setup();
  serve([missingReference], async () => {
    throw new Error("Falha ao processar cobranca na Efi.");
  });
  render(<OperationsPanel companyId="company-1" />);
  await user.click(await screen.findByRole("button", { name: "Conciliar com a Efí" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao processar cobranca na Efi.");
  expect(screen.queryByRole("status")).toBeNull();
});

it("sends a single consultation on a double click", async () => {
  const user = userEvent.setup();
  let release: (value: unknown) => void = () => undefined;
  serve([missingReference], () => new Promise((resolve) => { release = resolve; }));
  render(<OperationsPanel companyId="company-1" />);
  await user.dblClick(await screen.findByRole("button", { name: "Conciliar com a Efí" }));
  release({ status: "ACTIVE", reasonCode: "ISSUANCE_RECOVERED", recommendedAction: "NONE" });
  expect(await screen.findByRole("status")).toHaveTextContent("Emissão localizada na Efí e confirmada");
  expect(mockAdmin.mock.calls.filter(([path]) => String(path).endsWith("/reconcile"))).toHaveLength(1);
});
