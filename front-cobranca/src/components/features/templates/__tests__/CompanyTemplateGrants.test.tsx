import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CompanyTemplateGrants } from "../CompanyTemplateGrants";
import {
  TEMPLATE_PURPOSES,
  type AdminWhatsappTemplate,
  type CompanyTemplateAccess,
} from "../types";

const mockApi = {
  getAdminClientAnalytics: jest.fn(),
  getCompanyWhatsappTemplates: jest.fn(),
  getAdminWhatsappTemplates: jest.fn(),
  setCompanyWhatsappTemplateGrant: jest.fn(),
  setCompanyWhatsappTemplateDefault: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

function template(overrides: Partial<AdminWhatsappTemplate>): AdminWhatsappTemplate {
  return {
    id: "tpl-ready",
    name: "pronto",
    language: "pt_BR",
    category: "UTILITY",
    status: "APPROVED",
    quality: null,
    rejectedReason: null,
    supported: true,
    supportReason: null,
    reviewRequired: false,
    archivedAt: null,
    providerRevision: 1,
    mappingRevision: 1,
    policyVersion: 1,
    readiness: { ready: true, code: null },
    parameterFormat: "POSITIONAL",
    variables: [],
    content: { body: "Olá", footer: null, button: null },
    mapping: { body: {} },
    grantedCompanies: 0,
    lastSyncAt: null,
    ...overrides,
  };
}

function access(overrides: Partial<CompanyTemplateAccess> = {}): CompanyTemplateAccess {
  return {
    companyId: "company-a",
    grants: [
      {
        templateId: "tpl-granted",
        templateName: "liberado",
        language: "pt_BR",
        enabled: true,
        version: 2,
        available: { ready: true, code: null },
      },
    ],
    defaults: TEMPLATE_PURPOSES.map((purpose) => ({
      purpose,
      templateId: null,
      templateName: null,
      version: 0,
      available: { ready: false, code: "DEFAULT_MISSING" as const },
    })),
    ...overrides,
  };
}

async function selectCompany(): Promise<void> {
  fireEvent.change(screen.getByLabelText("Buscar empresa"), {
    target: { value: "Empresa" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Empresa A" }));
  await screen.findByText("Templates liberados");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getAdminClientAnalytics.mockResolvedValue({
    clients: [{ companyId: "company-a", corporateName: "Empresa A" }],
    pagination: { page: 1, pageSize: 10, total: 11 },
  });
  mockApi.getCompanyWhatsappTemplates.mockResolvedValue(access());
  mockApi.getAdminWhatsappTemplates.mockResolvedValue({
    items: [
      template({ id: "tpl-granted", name: "liberado" }),
      template({}),
      template({
        id: "tpl-unsupported",
        name: "sem_suporte",
        supported: false,
        readiness: { ready: false, code: "UNSUPPORTED" },
      }),
    ],
    nextCursor: null,
  });
  mockApi.setCompanyWhatsappTemplateGrant.mockResolvedValue({ version: 1 });
  mockApi.setCompanyWhatsappTemplateDefault.mockResolvedValue({ version: 1 });
});

describe("CompanyTemplateGrants", () => {
  it("searches companies page by page instead of loading every client", async () => {
    render(<CompanyTemplateGrants />);
    expect(mockApi.getAdminClientAnalytics).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Buscar empresa"), {
      target: { value: "Empresa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByRole("button", { name: "Empresa A" });
    expect(mockApi.getAdminClientAnalytics).toHaveBeenCalledWith({
      search: "Empresa",
      page: 1,
      pageSize: 10,
    });
    fireEvent.click(screen.getByRole("button", { name: "Próximas empresas" }));
    await waitFor(() =>
      expect(mockApi.getAdminClientAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
  });

  it("grants only usable templates with the version seen", async () => {
    render(<CompanyTemplateGrants />);
    await selectCompany();
    const unsupported = screen.getByRole("group", { name: "sem_suporte" });
    expect(within(unsupported).getByText("Formato não suportado")).toBeVisible();
    expect(
      within(unsupported).getByRole("button", { name: "Liberar para empresa" }),
    ).toBeDisabled();
    // Already granted templates are listed once, with revoke instead of grant.
    expect(screen.queryByRole("group", { name: "liberado" })).toBeNull();
    fireEvent.click(
      within(screen.getByRole("group", { name: "pronto" })).getByRole("button", {
        name: "Liberar para empresa",
      }),
    );
    await waitFor(() =>
      expect(mockApi.setCompanyWhatsappTemplateGrant).toHaveBeenCalledWith(
        "company-a",
        "tpl-ready",
        { enabled: true, expectedVersion: 0 },
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Revogar liberado" }));
    await waitFor(() =>
      expect(mockApi.setCompanyWhatsappTemplateGrant).toHaveBeenLastCalledWith(
        "company-a",
        "tpl-granted",
        { enabled: false, expectedVersion: 2 },
      ),
    );
    expect(screen.getByText(/não retoma envios já bloqueados/)).toBeInTheDocument();
  });

  it("reloads after a concurrent change instead of overwriting it", async () => {
    mockApi.setCompanyWhatsappTemplateGrant.mockRejectedValueOnce(
      Object.assign(new Error("Conflict"), { status: 409 }),
    );
    render(<CompanyTemplateGrants />);
    await selectCompany();
    mockApi.getCompanyWhatsappTemplates.mockResolvedValue(
      access({
        grants: [
          {
            templateId: "tpl-granted",
            templateName: "liberado",
            language: "pt_BR",
            enabled: false,
            version: 3,
            available: { ready: false, code: "NOT_GRANTED" },
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Revogar liberado" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Outro administrador alterou esta configuração",
    );
    expect(mockApi.getCompanyWhatsappTemplates).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Revogar liberado" })).toBeNull();
    expect(mockApi.setCompanyWhatsappTemplateGrant).toHaveBeenCalledTimes(1);
  });

  it("sets a purpose default among granted, ready templates only", async () => {
    render(<CompanyTemplateGrants />);
    await selectCompany();
    const select = screen.getByLabelText("Antes do vencimento");
    expect(
      within(select).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Sem padrão", "liberado"]);
    fireEvent.change(select, { target: { value: "tpl-granted" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar padrão: Antes do vencimento" }),
    );
    await waitFor(() =>
      expect(mockApi.setCompanyWhatsappTemplateDefault).toHaveBeenCalledWith(
        "company-a",
        "BEFORE_DUE",
        { templateId: "tpl-granted", expectedVersion: 0 },
      ),
    );
  });
});
