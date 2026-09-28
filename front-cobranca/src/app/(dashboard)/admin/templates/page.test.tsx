import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Page from "./page";

const mockApi = {
  getEmailTemplates: jest.fn(),
  financialAdmin: jest.fn(),
  getAdminWhatsappTemplates: jest.fn(),
  getAdminWhatsappTemplate: jest.fn(),
  getWhatsappTemplateSyncState: jest.fn(),
  syncWhatsappTemplates: jest.fn(),
  previewWhatsappTemplate: jest.fn(),
  saveWhatsappTemplateMapping: jest.fn(),
  getAdminClientAnalytics: jest.fn(),
  getCompanyWhatsappTemplates: jest.fn(),
  setCompanyWhatsappTemplateGrant: jest.fn(),
  setCompanyWhatsappTemplateDefault: jest.fn(),
  getAdminTemplatePending: jest.fn(),
  getCompanyTemplatePending: jest.fn(),
  previewTemplateResume: jest.fn(),
  confirmTemplateResume: jest.fn(),
};
let mockRole = "PLATFORM_ADMIN";
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: mockRole } } }),
}));

const imported = {
  id: "wa-1",
  name: "aviso_cobranca",
  language: "pt_BR",
  category: "UTILITY",
  status: "APPROVED",
  quality: null,
  rejectedReason: null,
  supported: true,
  supportReason: null,
  reviewRequired: true,
  archivedAt: null,
  providerRevision: 2,
  mappingRevision: 0,
  policyVersion: 1,
  readiness: { ready: false, code: "REVIEW_REQUIRED" },
  positions: [1],
  content: { body: "Olá {{1}}", footer: null, button: null },
  mapping: null,
  grantedCompanies: 0,
  lastSyncAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "PLATFORM_ADMIN";
  mockApi.getAdminWhatsappTemplates.mockResolvedValue({
    items: [imported],
    nextCursor: null,
  });
  mockApi.getAdminWhatsappTemplate.mockResolvedValue(imported);
  mockApi.getWhatsappTemplateSyncState.mockResolvedValue({
    providerAccountId: "waba",
    lastCompletedAt: null,
    lastStartedAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    running: false,
    pendingRequest: false,
  });
  mockApi.getAdminTemplatePending.mockResolvedValue({
    items: [
      {
        id: "p-1",
        origin: "COLLECTION",
        invoiceId: "invoice-a",
        code: "NOT_GRANTED",
        state: "BLOCKED",
        version: 1,
        occurrences: 1,
        blockedAt: "2026-09-27T10:00:00.000Z",
        resolvedAt: null,
        closedReason: null,
        companyId: "company-a",
        companyName: "Empresa A",
        templateId: "wa-1",
        templateName: "aviso_cobranca",
        ruleStepId: null,
      },
    ],
    nextCursor: null,
  });
  mockApi.getAdminClientAnalytics.mockResolvedValue({
    clients: [{ companyId: "company-a", corporateName: "Empresa A" }],
    pagination: { page: 1, pageSize: 10, total: 1 },
  });
  mockApi.getCompanyWhatsappTemplates.mockResolvedValue({
    companyId: "company-a",
    grants: [],
    defaults: [],
  });
  mockApi.setCompanyWhatsappTemplateGrant.mockResolvedValue({ version: 1 });
  mockApi.getEmailTemplates.mockResolvedValue([
    { id: "email-1", name: "Lembrete", subject: "Vencimento", content: "Sua cobrança" },
  ]);
});

it("administers the imported catalog without any authoring towards Meta", async () => {
  render(<Page />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Configurar variáveis de aviso_cobranca" }),
  );
  expect(await screen.findByText("Variáveis de aviso_cobranca")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Enviar para Meta" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Solicitar aprovação/ })).toBeNull();
  expect(screen.getByRole("heading", { name: "Disponibilidade por empresa" })).toBeVisible();
});

it("refreshes the catalog after a mapping is saved and explains a conflict", async () => {
  mockApi.saveWhatsappTemplateMapping
    .mockRejectedValueOnce(Object.assign(new Error("Conflict"), { status: 409 }))
    .mockResolvedValueOnce({ mappingRevision: 1 });
  render(<Page />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Configurar variáveis de aviso_cobranca" }),
  );
  fireEvent.change(await screen.findByLabelText("Variável {{1}}"), {
    target: { value: "DEBTOR_NAME" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar variáveis" }));
  expect(await screen.findByText("A configuração mudou. Atualize a prévia.")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Variável {{1}}"), {
    target: { value: "DEBTOR_NAME" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar variáveis" }));
  await waitFor(() => expect(mockApi.getAdminWhatsappTemplates).toHaveBeenCalledTimes(2));
});

it("fixing a grant never confirms a resume of held sends", async () => {
  mockApi.getAdminWhatsappTemplates.mockResolvedValue({
    items: [{ ...imported, readiness: { ready: true, code: null } }],
    nextCursor: null,
  });
  render(<Page />);
  expect(await screen.findByText("Não liberado para a empresa")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  const grants = screen.getByRole("region", { name: "Disponibilidade por empresa" });
  fireEvent.click(await within(grants).findByRole("button", { name: "Empresa A" }));
  fireEvent.click(await screen.findByRole("button", { name: "Liberar para empresa" }));
  await waitFor(() =>
    expect(mockApi.setCompanyWhatsappTemplateGrant).toHaveBeenCalledWith(
      "company-a",
      "wa-1",
      { enabled: true, expectedVersion: 0 },
    ),
  );
  expect(mockApi.previewTemplateResume).not.toHaveBeenCalled();
  expect(mockApi.confirmTemplateResume).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("keeps publishing email templates", async () => {
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "Publicar Lembrete" }));
  await waitFor(() =>
    expect(mockApi.financialAdmin).toHaveBeenCalledWith("/email/templates/email-1/publish", "POST"),
  );
});

it("does not load or expose global controls to a company admin", () => {
  mockRole = "COMPANY_ADMIN";
  render(<Page />);
  expect(mockApi.getAdminWhatsappTemplates).not.toHaveBeenCalled();
  expect(mockApi.getEmailTemplates).not.toHaveBeenCalled();
  expect(screen.getByText(/Acesso restrito/)).toBeInTheDocument();
});
