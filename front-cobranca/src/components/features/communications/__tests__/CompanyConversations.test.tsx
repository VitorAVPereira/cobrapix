import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommunicationsHistory } from "../../CommunicationsHistory";

const mockApi = {
  listCompanyConversations: jest.fn(),
  listCompanyConversationMessages: jest.fn(),
  financialAdmin: jest.fn(),
  attributeMessage: jest.fn(),
  replyToAdminConversation: jest.fn(),
  replyWithTemplate: jest.fn(),
  updateAdminConversationStatus: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));
let mockSession = { id: "user-a", companyId: "company-a" };
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { ...mockSession, role: "COMPANY_ADMIN" } },
  }),
}));

const conversation = (id: string, name: string) => ({
  id,
  channel: "WHATSAPP",
  contact: { name, address: "5511999999999" },
  lastMessageAt: "2026-09-24T12:00:00.000Z",
  messageCount: 2,
  lastMessage: {
    direction: "INBOUND",
    preview: `Resposta de ${name}`,
    status: "received",
    messageType: "text",
  },
});
const thread = {
  conversation: {
    id: "conversation-a",
    channel: "WHATSAPP",
    contact: { name: "Pagador A", address: "5511999999999" },
  },
  // Newest first, as the API returns.
  items: [
    {
      id: "m2",
      direction: "INBOUND",
      content: "Paguei hoje",
      messageType: "text",
      status: "received",
      createdAt: "2026-09-24T12:05:00.000Z",
      invoice: null,
      debtor: null,
      attachments: [],
      replyTo: { id: "m1", direction: "OUTBOUND", excerpt: "Cobrança de março" },
    },
    {
      id: "m1",
      direction: "OUTBOUND",
      content: "Cobrança de março",
      messageType: "template",
      status: "delivered",
      createdAt: "2026-09-24T12:00:00.000Z",
      invoice: {
        id: "invoice-a",
        dueDate: "2026-09-30T00:00:00.000Z",
        originalAmount: "150.5",
        status: "PENDING",
      },
      debtor: { id: "debtor-a", name: "Pagador A" },
      attachments: [],
    },
  ],
  nextCursor: null,
};
const notFound = Object.assign(new Error("Not Found"), { status: 404 });

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { id: "user-a", companyId: "company-a" };
  setVisibility("visible");
  mockApi.listCompanyConversations.mockResolvedValue({
    items: [conversation("conversation-a", "Pagador A")],
    nextCursor: null,
    total: 1,
  });
  mockApi.listCompanyConversationMessages.mockResolvedValue(thread);
  mockApi.financialAdmin.mockResolvedValue({ items: [], total: 0 });
});

describe("Company conversations (read-only)", () => {
  it("shows its messages with context and quotes, without any send control", async () => {
    render(<CommunicationsHistory />);
    fireEvent.click(await screen.findByRole("button", { name: /Pagador A/ }));
    expect(await screen.findByText("Paguei hoje")).toBeInTheDocument();
    expect(screen.getAllByText("Cobrança de março")).toHaveLength(2);
    expect(screen.getByText(/R\$\s?150,50/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enviar|responder|classificar/i }),
    ).not.toBeInTheDocument();
    for (const mutation of [
      mockApi.attributeMessage,
      mockApi.replyToAdminConversation,
      mockApi.replyWithTemplate,
      mockApi.updateAdminConversationStatus,
    ])
      expect(mutation).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/wamid/);
  });

  it("closes a conversation the company lost access to and keeps the list", async () => {
    render(<CommunicationsHistory />);
    mockApi.listCompanyConversationMessages.mockRejectedValue(notFound);
    fireEvent.click(await screen.findByRole("button", { name: /Pagador A/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Conversa não encontrada.",
    );
    expect(
      screen.queryByRole("region", { name: "Mensagens da conversa" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pagador A/ })).toBeInTheDocument();
  });

  it("pages with the server cursor and shows the total", async () => {
    mockApi.listCompanyConversations.mockImplementation(
      async (params: { cursor?: string }) =>
        params.cursor === "cursor-1"
          ? {
              items: [conversation("conversation-b", "Pagador C")],
              nextCursor: null,
              total: 11,
            }
          : {
              items: [conversation("conversation-a", "Pagador A")],
              nextCursor: "cursor-1",
              total: 11,
            },
    );
    render(<CommunicationsHistory />);
    expect(
      await screen.findByText("Página 1 de 2 · 11 conversas"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(
      await screen.findByRole("button", { name: /Pagador C/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Página 2 de 2 · 11 conversas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();
    expect(mockApi.listCompanyConversations.mock.lastCall?.[0]).toEqual({
      limit: 10,
      channel: undefined,
      search: undefined,
      cursor: "cursor-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(
      await screen.findByRole("button", { name: /Pagador A/ }),
    ).toBeInTheDocument();
    expect(mockApi.listCompanyConversations.mock.lastCall?.[0]).toMatchObject({
      cursor: undefined,
    });
  });

  it("searches clients from the first page and says when nothing matches", async () => {
    mockApi.listCompanyConversations.mockImplementation(
      async (params: { search?: string }) =>
        params.search
          ? { items: [], nextCursor: null, total: 0 }
          : {
              items: [conversation("conversation-a", "Pagador A")],
              nextCursor: "cursor-1",
              total: 11,
            },
    );
    render(<CommunicationsHistory />);
    fireEvent.click(await screen.findByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(mockApi.listCompanyConversations.mock.lastCall?.[0]).toMatchObject(
        { cursor: "cursor-1" },
      ),
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar cliente" }),
      { target: { value: "  Maria  " } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Buscar cliente" }));
    expect(
      await screen.findByText("Nenhuma conversa encontrada para esta busca."),
    ).toBeInTheDocument();
    expect(mockApi.listCompanyConversations.mock.lastCall?.[0]).toEqual({
      limit: 10,
      channel: undefined,
      search: "Maria",
      cursor: undefined,
    });
    expect(
      screen.queryByRole("navigation", { name: "Paginação" }),
    ).not.toBeInTheDocument();
  });

  it("polls the page being viewed with its own cursor", async () => {
    jest.useFakeTimers();
    try {
      mockApi.listCompanyConversations.mockResolvedValue({
        items: [conversation("conversation-a", "Pagador A")],
        nextCursor: "cursor-1",
        total: 11,
      });
      render(<CommunicationsHistory />);
      await act(async () => undefined);
      fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
      await act(async () => undefined);
      const calls = mockApi.listCompanyConversations.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(mockApi.listCompanyConversations).toHaveBeenCalledTimes(calls + 1);
      expect(mockApi.listCompanyConversations.mock.lastCall?.[0]).toMatchObject({
        cursor: "cursor-1",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("polls every 15 seconds only while the page is visible", async () => {
    jest.useFakeTimers();
    try {
      render(<CommunicationsHistory />);
      await act(async () => undefined);
      expect(mockApi.listCompanyConversations).toHaveBeenCalledTimes(1);
      const firstSignal = mockApi.listCompanyConversations.mock
        .calls[0]?.[1] as AbortSignal;
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(mockApi.listCompanyConversations).toHaveBeenCalledTimes(2);
      expect(firstSignal.aborted).toBe(true);
      act(() => setVisibility("hidden"));
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(mockApi.listCompanyConversations).toHaveBeenCalledTimes(2);
      act(() => setVisibility("visible"));
      await act(async () => undefined);
      expect(mockApi.listCompanyConversations).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it("drops the previous company's cache when the session changes", async () => {
    const { rerender } = render(<CommunicationsHistory />);
    fireEvent.click(await screen.findByRole("button", { name: /Pagador A/ }));
    expect(await screen.findByText("Paguei hoje")).toBeInTheDocument();
    let resolveNext: (value: unknown) => void = () => undefined;
    mockApi.listCompanyConversations.mockReturnValue(
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
    );
    mockSession = { id: "user-b", companyId: "company-b" };
    rerender(<CommunicationsHistory />);
    expect(screen.queryByText("Paguei hoje")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Pagador A/ }),
    ).not.toBeInTheDocument();
    await act(async () => {
      resolveNext({ items: [], nextCursor: null, total: 0 });
    });
    expect(
      await screen.findByText("Nenhuma conversa com mensagens da sua empresa."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mockApi.listCompanyConversationMessages).toHaveBeenCalledTimes(1),
    );
  });
});
