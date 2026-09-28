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
