import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommunicationsHistory } from "../CommunicationsHistory";

const mockApi = {
  listAdminConversations: jest.fn(),
  getAdminConversation: jest.fn(),
  getTemplates: jest.fn(),
  getConversationContextOptions: jest.fn(),
  replyToAdminConversation: jest.fn(),
  updateAdminConversationStatus: jest.fn(),
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
  mockApi.getTemplates.mockResolvedValue([]);
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
