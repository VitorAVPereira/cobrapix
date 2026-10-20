import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import type { ConversationMessage } from "@/lib/api-client";
import { ConversationMessages } from "../ConversationMessages";
import { dayLabel, shortTime } from "../InboxParts";

jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => ({}) }));

describe("inbox times", () => {
  // 19/10/2026 15:00 in São Paulo.
  const now = new Date("2026-10-19T18:00:00Z");

  it("shows the hour today, 'Ontem', then the date in São Paulo", () => {
    expect(shortTime("2026-10-19T17:32:00Z", now)).toBe("14:32");
    // 01:30 UTC of the 19th is still the 18th in São Paulo.
    expect(shortTime("2026-10-19T01:30:00Z", now)).toBe("Ontem");
    expect(shortTime("2026-10-10T12:00:00Z", now)).toBe("10/10");
    expect(shortTime("2025-12-31T12:00:00Z", now)).toBe("31/12/2025");
  });

  it("names the day separators", () => {
    expect(dayLabel("2026-10-19T12:00:00Z", now)).toBe("Hoje");
    expect(dayLabel("2026-10-18T12:00:00Z", now)).toBe("Ontem");
    expect(dayLabel("2026-10-10T12:00:00Z", now)).toBe("10 de outubro de 2026");
  });
});

describe("ConversationMessages", () => {
  function message(overrides: Partial<ConversationMessage>): ConversationMessage {
    return {
      id: "m",
      direction: "INBOUND",
      content: "Oi",
      status: "received",
      createdAt: "2026-10-10T12:00:00Z",
      messageType: "text",
      replyTo: null,
      attachments: [],
      invoice: null,
      debtor: null,
      ...overrides,
    } as ConversationMessage;
  }

  it("separates days and tells received from sent messages", () => {
    render(
      <ConversationMessages
        hasOlder={false}
        messages={[
          message({ id: "1", content: "Recebi a cobrança", createdAt: "2026-10-10T12:00:00Z" }),
          message({ id: "2", content: "Segue o Pix", direction: "OUTBOUND", status: "delivered", createdAt: "2026-10-10T12:05:00Z" }),
          message({ id: "3", content: "Paguei", createdAt: "2026-10-12T12:00:00Z" }),
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Mensagens" });
    expect(within(list).getByText("10 de outubro de 2026")).toBeInTheDocument();
    expect(within(list).getByText("12 de outubro de 2026")).toBeInTheDocument();
    expect(within(list).getAllByText("Recebida")).toHaveLength(2);
    expect(within(list).getByText("Enviada")).toBeInTheDocument();
    expect(within(list).getByText(/09:05 · Entregue/)).toBeInTheDocument();
  });
});
