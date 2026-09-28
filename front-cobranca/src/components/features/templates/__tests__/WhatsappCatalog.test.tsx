import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WhatsappCatalog } from "../WhatsappCatalog";
import type { AdminWhatsappTemplate } from "../types";

const mockApi = {
  getAdminWhatsappTemplates: jest.fn(),
  getWhatsappTemplateSyncState: jest.fn(),
  syncWhatsappTemplates: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

function adminTemplate(
  overrides: Partial<AdminWhatsappTemplate> = {},
): AdminWhatsappTemplate {
  return {
    id: "tpl-1",
    name: "lembrete_vencimento",
    language: "pt_BR",
    category: "UTILITY",
    status: "APPROVED",
    quality: "GREEN",
    rejectedReason: null,
    supported: true,
    supportReason: null,
    reviewRequired: false,
    archivedAt: null,
    providerRevision: 1,
    mappingRevision: 1,
    policyVersion: 1,
    readiness: { ready: true, code: null },
    positions: [1],
    content: { body: "Olá {{1}}", footer: null, button: null },
    mapping: { body: { "1": { kind: "SOURCE", source: "DEBTOR_NAME" } } },
    grantedCompanies: 2,
    lastSyncAt: "2026-09-27T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getAdminWhatsappTemplates.mockResolvedValue({
    items: [
      adminTemplate(),
      adminTemplate({
        id: "tpl-2",
        name: "com_imagem",
        supported: false,
        supportReason: "HEADER_MEDIA",
        readiness: { ready: false, code: "UNSUPPORTED" },
        mapping: null,
      }),
    ],
    nextCursor: "tpl-2",
  });
  mockApi.getWhatsappTemplateSyncState.mockResolvedValue({
    providerAccountId: "waba",
    lastCompletedAt: "2026-09-27T10:00:00.000Z",
    lastStartedAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    running: false,
    pendingRequest: false,
  });
});

describe("WhatsappCatalog", () => {
  it("starts on approved templates and flags an approved but unsupported format", async () => {
    const onConfigure = jest.fn();
    render(<WhatsappCatalog onConfigure={onConfigure} />);
    const unsupported = await screen.findByRole("article", { name: "com_imagem" });
    expect(mockApi.getAdminWhatsappTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ status: "APPROVED", cursor: undefined }),
    );
    expect(within(unsupported).getByText("Formato não suportado")).toBeVisible();
    expect(
      within(unsupported).getByRole("button", {
        name: "Configurar variáveis de com_imagem",
      }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Configurar variáveis de lembrete_vencimento",
      }),
    );
    expect(onConfigure).toHaveBeenCalledWith("tpl-1");
    expect(
      within(screen.getByRole("article", { name: "lembrete_vencimento" })).getByText(
        /Liberado para 2 empresas/,
      ),
    ).toBeInTheDocument();
  });

  it("never offers authoring or submission to Meta", async () => {
    render(<WhatsappCatalog onConfigure={jest.fn()} />);
    await screen.findByRole("article", { name: "com_imagem" });
    expect(
      screen.queryByRole("button", { name: "Enviar para Meta" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Solicitar aprovação/ })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("filters unavailable templates and pages with the cursor", async () => {
    render(<WhatsappCatalog onConfigure={jest.fn()} />);
    await screen.findByRole("article", { name: "com_imagem" });
    mockApi.getAdminWhatsappTemplates.mockResolvedValueOnce({
      items: [adminTemplate({ id: "tpl-3", name: "terceiro" })],
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais templates" }));
    expect(await screen.findByRole("article", { name: "terceiro" })).toBeInTheDocument();
    expect(mockApi.getAdminWhatsappTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "tpl-2" }),
    );
    expect(screen.getAllByRole("article")).toHaveLength(3);

    mockApi.getAdminWhatsappTemplates.mockResolvedValueOnce({
      items: [
        adminTemplate({ id: "old", name: "antigo", status: "PAUSED", archivedAt: null }),
      ],
      nextCursor: null,
    });
    fireEvent.change(screen.getByLabelText("Situação"), {
      target: { value: "UNAVAILABLE" },
    });
    expect(await screen.findByRole("article", { name: "antigo" })).toHaveTextContent(
      "Pausado",
    );
    expect(mockApi.getAdminWhatsappTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "UNAVAILABLE", cursor: undefined }),
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("syncs on demand and explains a sync already running", async () => {
    render(<WhatsappCatalog onConfigure={jest.fn()} />);
    await screen.findByRole("article", { name: "com_imagem" });
    mockApi.syncWhatsappTemplates.mockResolvedValueOnce({
      imported: 1,
      updated: 2,
      unavailable: 0,
      completed: true,
      incomplete: 0,
      conflicts: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar catálogo" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 novos, 2 atualizados",
    );
    mockApi.syncWhatsappTemplates.mockRejectedValueOnce(
      Object.assign(new Error("busy"), { status: 409 }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sincronizar catálogo" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar catálogo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Uma sincronização já está em andamento",
    );
  });
});
