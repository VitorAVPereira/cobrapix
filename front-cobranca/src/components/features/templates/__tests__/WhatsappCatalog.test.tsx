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
    parameterFormat: "POSITIONAL",
    variables: ["1"],
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
    total: 12,
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
    expect(screen.getByText("Página 1 de 2 · 12 templates")).toBeInTheDocument();
    mockApi.getAdminWhatsappTemplates.mockResolvedValueOnce({
      items: [adminTemplate({ id: "tpl-3", name: "terceiro" })],
      nextCursor: null,
      total: 12,
    });
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByRole("article", { name: "terceiro" })).toBeInTheDocument();
    expect(mockApi.getAdminWhatsappTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "tpl-2", limit: 10 }),
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Página 2 de 2 · 12 templates")).toBeInTheDocument();

    mockApi.getAdminWhatsappTemplates.mockResolvedValueOnce({
      items: [
        adminTemplate({ id: "old", name: "antigo", status: "PAUSED", archivedAt: null }),
      ],
      nextCursor: null,
      total: 1,
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

  it("searches by name from the first page and says when nothing matches", async () => {
    render(<WhatsappCatalog onConfigure={jest.fn()} />);
    await screen.findByRole("article", { name: "com_imagem" });
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(mockApi.getAdminWhatsappTemplates).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "tpl-2" }),
      ),
    );
    mockApi.getAdminWhatsappTemplates.mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar template" }), {
      target: { value: " vencimento " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar template" }));
    expect(
      await screen.findByText("Nenhum template encontrado com esse nome neste filtro."),
    ).toBeInTheDocument();
    expect(mockApi.getAdminWhatsappTemplates).toHaveBeenLastCalledWith({
      status: "APPROVED",
      supported: undefined,
      search: "vencimento",
      cursor: undefined,
      limit: 10,
    });
  });

  it("reloads the page being viewed after a mapping is saved", async () => {
    const { rerender } = render(
      <WhatsappCatalog onConfigure={jest.fn()} refreshKey={0} />,
    );
    await screen.findByRole("article", { name: "com_imagem" });
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(mockApi.getAdminWhatsappTemplates).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "tpl-2" }),
      ),
    );
    const calls = mockApi.getAdminWhatsappTemplates.mock.calls.length;
    rerender(<WhatsappCatalog onConfigure={jest.fn()} refreshKey={1} />);
    await waitFor(() =>
      expect(mockApi.getAdminWhatsappTemplates).toHaveBeenCalledTimes(calls + 1),
    );
    expect(mockApi.getAdminWhatsappTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "tpl-2" }),
    );
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
