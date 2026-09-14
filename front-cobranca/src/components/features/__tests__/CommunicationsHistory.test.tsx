import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommunicationsHistory } from "../CommunicationsHistory";

const financialAdmin = jest.fn();
const mockApi = { financialAdmin };
jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApi,
}));
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { role: "PLATFORM_ADMIN" } },
  }),
}));

describe("CommunicationsHistory admin replies", () => {
  it("sends only content and a frontend id to the selected conversation", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    financialAdmin
      .mockResolvedValueOnce({
        items: [
          {
            id: "conversation-1",
            channel: "WHATSAPP",
            recipient: "5511999999999",
            status: "NEW",
            unreadCount: 1,
            lastMessagePreview: "Oi",
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        id: "conversation-1",
        channel: "WHATSAPP",
        recipient: "5511999999999",
        status: "NEW",
        unreadCount: 1,
        serviceWindowExpiresAt: future,
        messages: [],
      })
      .mockResolvedValueOnce({ status: "sent" })
      .mockResolvedValue({
        id: "conversation-1",
        channel: "WHATSAPP",
        recipient: "5511999999999",
        status: "IN_PROGRESS",
        unreadCount: 0,
        serviceWindowExpiresAt: future,
        messages: [],
        items: [],
        total: 0,
      });

    render(<CommunicationsHistory admin />);
    fireEvent.click(
      await screen.findByRole("button", { name: /5511999999999/i }),
    );
    fireEvent.change(
      await screen.findByLabelText("Resposta do atendimento central"),
      {
        target: { value: "Como podemos ajudar?" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));

    await waitFor(() =>
      expect(financialAdmin).toHaveBeenCalledWith(
        "/communications/admin/conversations/conversation-1/replies",
        "POST",
        expect.objectContaining({
          idempotencyId: expect.any(String) as string,
          content: "Como podemos ajudar?",
        }),
      ),
    );
    const replyCall = financialAdmin.mock.calls.find((call) =>
      call[0]?.endsWith("/replies"),
    );
    expect(replyCall?.[2]).not.toHaveProperty("companyId");
    expect(replyCall?.[2]).not.toHaveProperty("recipient");
  });
});
