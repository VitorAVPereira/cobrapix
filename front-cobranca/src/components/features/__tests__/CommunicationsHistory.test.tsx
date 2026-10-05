import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommunicationsHistory } from "../CommunicationsHistory";

const mockApi = {
  listAdminConversations: jest.fn(),
  getAdminConversation: jest.fn(),
  getConversationContextOptions: jest.fn(),
  replyToAdminConversation: jest.fn(),
  updateAdminConversationStatus: jest.fn(),
  listConversations: jest.fn(),
  getCompanyTemplatePending: jest.fn(),
  getAdminTemplatePending: jest.fn(),
  getAdminClients: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApi,
}));
let mockRole = "PLATFORM_ADMIN";
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "admin-1", companyId: "platform", role: mockRole } },
  }),
}));

const future = new Date(Date.now() + 60_000).toISOString();
const detail = {
  id: "conversation-1",
  channel: "WHATSAPP",
  recipient: "5511999999999",
  status: "NEW",
  unreadCount: 1,
  lastInboundAt: null,
  serviceWindowExpiresAt: future,
  updatedAt: future,
  messages: [],
  nextCursor: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "PLATFORM_ADMIN";
  mockApi.listAdminConversations.mockResolvedValue({
    items: [
      {
        id: "conversation-1",
        channel: "WHATSAPP",
        recipient: "5511999999999",
        status: "NEW",
        unreadCount: 1,
        lastMessagePreview: "Oi",
        lastInboundAt: null,
        serviceWindowExpiresAt: future,
        updatedAt: future,
        unclassifiedCount: 1,
      },
    ],
    total: 1,
  });
  mockApi.getAdminConversation.mockResolvedValue(detail);
  mockApi.getConversationContextOptions.mockResolvedValue({ options: [] });
  mockApi.replyToAdminConversation.mockResolvedValue({ status: "pending" });
  mockApi.getAdminClients.mockResolvedValue([
    { id: "company-b", corporateName: "Empresa B" },
    { id: "company-a", corporateName: "Empresa A" },
  ]);
});

describe("CommunicationsHistory admin list", () => {
  const lastQuery = () =>
    mockApi.listAdminConversations.mock.lastCall?.[0] as Record<
      string,
      unknown
    >;

  it("filters by company and client from the first page, 10 per page", async () => {
    mockApi.listAdminConversations.mockImplementation(async () => ({
      items: [],
      total: 25,
    }));
    render(<CommunicationsHistory admin />);
    expect(
      await screen.findByText("Página 1 de 3 · 25 conversas"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 2 }));
    const company = screen.getByRole("combobox", { name: "Empresa" });
    expect(
      [...company.querySelectorAll("option")].map((option) => option.text),
    ).toEqual(["Todas", "Empresa A", "Empresa B"]);
    fireEvent.change(company, { target: { value: "company-b" } });
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ page: 1, companyId: "company-b" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar cliente ou telefone" }),
      { target: { value: " Maria " } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Buscar cliente ou telefone" }));
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        page: 1,
        pageSize: 10,
        channel: undefined,
        status: undefined,
        pendingClassification: undefined,
        companyId: "company-b",
        search: "Maria",
      }),
    );
  });

  it("says when the filters match nothing", async () => {
    mockApi.listAdminConversations.mockResolvedValue({ items: [], total: 0 });
    render(<CommunicationsHistory admin />);
    fireEvent.change(
      await screen.findByRole("searchbox", {
        name: "Buscar cliente ou telefone",
      }),
      { target: { value: "ninguem" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Buscar cliente ou telefone" }));
    expect(
      await screen.findByText("Nenhuma conversa encontrada para estes filtros."),
    ).toBeInTheDocument();
  });

  it("keeps the inbox working when the company list fails", async () => {
    mockApi.getAdminClients.mockRejectedValue(new Error("falha"));
    render(<CommunicationsHistory admin />);
    expect(
      await screen.findByRole("button", { name: /5511999999999/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("falha");
  });
});

describe("CommunicationsHistory admin replies", () => {
  it("sends only content and a frontend id when no company context is chosen", async () => {
    render(<CommunicationsHistory admin />);
    fireEvent.click(
      await screen.findByRole("button", { name: /5511999999999/i }),
    );
    fireEvent.change(
      await screen.findByLabelText("Resposta do atendimento central"),
      { target: { value: "Como podemos ajudar?" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    await waitFor(() =>
      expect(mockApi.replyToAdminConversation).toHaveBeenCalledWith(
        "conversation-1",
        {
          idempotencyId: expect.any(String) as string,
          content: "Como podemos ajudar?",
        },
      ),
    );
    expect(screen.getByText(/1 sem classificação/)).toBeInTheDocument();
  });

  it("reports a forbidden response without exposing data", async () => {
    mockApi.listAdminConversations.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    render(<CommunicationsHistory admin />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Você não tem acesso a esta informação.",
    );
  });

  it("never loads the global view for a company user", () => {
    mockRole = "COMPANY_ADMIN";
    render(<CommunicationsHistory admin />);
    expect(screen.getByText("Acesso restrito.")).toBeInTheDocument();
    expect(mockApi.listAdminConversations).not.toHaveBeenCalled();
  });
});

describe("CommunicationsHistory company view", () => {
  it("shows the company's held sends without resume controls", async () => {
    mockRole = "COMPANY_ADMIN";
    mockApi.listConversations.mockResolvedValue({ items: [], nextCursor: null });
    mockApi.getCompanyTemplatePending.mockResolvedValue({
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
        },
      ],
      nextCursor: null,
    });
    render(<CommunicationsHistory />);
    fireEvent.click(screen.getByRole("tab", { name: "Pendências" }));
    expect(await screen.findByText("Não liberado para a empresa")).toBeInTheDocument();
    expect(mockApi.getAdminTemplatePending).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Autorizar retomada" }),
    ).not.toBeInTheDocument();
  });
});
