import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import type {
  AdminConversationDetail,
  AdminConversationMessage,
  MessageTemplate,
} from "@/lib/api-client";
import {
  AdminConversationContext,
  AdminMessageDetails,
} from "../AdminConversationContext";

const mockApi = {
  getConversationContextOptions: jest.fn(),
  attributeMessage: jest.fn(),
  replyToAdminConversation: jest.fn(),
  replyWithTemplate: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const inbound: AdminConversationMessage = {
  id: "message-in",
  direction: "INBOUND",
  content: "Ja paguei a cobrança",
  messageType: "text",
  status: "received",
  createdAt: "2026-09-24T12:00:00.000Z",
  invoice: null,
  debtor: null,
  attachments: [],
  companyId: null,
  invoiceId: null,
  debtorId: null,
  company: null,
  externalMessageId: "wamid.in",
  replyToMessageId: null,
  source: "LIVE",
  attributionMethod: "UNASSIGNED",
  attributionRevision: 3,
  outboundIntent: null,
  readAt: null,
};
const uncertain: AdminConversationMessage = {
  ...inbound,
  id: "message-out",
  direction: "OUTBOUND",
  content: "Cobrança A",
  status: "delivery_uncertain",
  companyId: "company-a",
  company: { id: "company-a", corporateName: "Empresa A", tradeName: null },
  attributionMethod: "OUTBOUND_CONTEXT",
  externalMessageId: null,
  outboundIntent: { state: "UNCERTAIN", lastErrorCode: "DELIVERY_UNCERTAIN" },
};
const conversation = (open: boolean): AdminConversationDetail => ({
  id: "conversation-1",
  channel: "WHATSAPP",
  recipient: "5511999999999",
  status: "NEW",
  unreadCount: 1,
  lastInboundAt: null,
  serviceWindowExpiresAt: open
    ? new Date(Date.now() + 3_600_000).toISOString()
    : new Date(Date.now() - 1000).toISOString(),
  updatedAt: "2026-09-24T12:00:00.000Z",
  messages: [inbound, uncertain],
  nextCursor: null,
});
const template = (overrides: Partial<MessageTemplate> = {}): MessageTemplate =>
  ({
    id: "template-1",
    name: "Lembrete",
    content: "Olá {{nome_devedor}}, valor {{valor}}.",
    isActive: true,
    metaStatus: "APPROVED",
    metaReviewRequired: false,
    metaTemplateName: "ciframais_lembrete",
    paymentButtonEnabled: true,
    ...overrides,
  }) as MessageTemplate;

function Harness({
  open = true,
  templates = [template()],
  onChanged = jest.fn().mockResolvedValue(undefined),
}: {
  open?: boolean;
  templates?: MessageTemplate[];
  onChanged?: () => Promise<void>;
}): ReactNode {
  const [classifying, setClassifying] =
    useState<AdminConversationMessage | null>(null);
  const [quoting, setQuoting] = useState<AdminConversationMessage | null>(null);
  const detail = conversation(open);
  return (
    <>
      {detail.messages.map((message) => (
        <div key={message.id}>
          <p>{message.content}</p>
          <AdminMessageDetails
            message={message}
            canQuote
            onClassify={setClassifying}
            onQuote={setQuoting}
          />
        </div>
      ))}
      <AdminConversationContext
        conversation={detail}
        templates={templates}
        classifying={classifying}
        quoting={quoting}
        onCancelClassify={() => setClassifying(null)}
        onCancelQuote={() => setQuoting(null)}
        onChanged={onChanged}
      />
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getConversationContextOptions.mockResolvedValue({
    options: [
      {
        company: { id: "company-a", name: "Empresa A" },
        debtor: { id: "debtor-a", name: "Pagador" },
        invoices: [
          {
            id: "invoice-a",
            dueDate: "2026-09-30T00:00:00.000Z",
            originalAmount: "100",
            status: "PENDING",
          },
        ],
      },
    ],
  });
  mockApi.attributeMessage.mockResolvedValue({ messageId: "message-in", revision: 4 });
  mockApi.replyToAdminConversation.mockResolvedValue({ id: "r", status: "pending" });
  mockApi.replyWithTemplate.mockResolvedValue({ id: "t", status: "pending" });
});

describe("Admin conversation actions", () => {
  it("classifies a message with the context, reason and revision it saw", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Classificar" }));
    const form = await screen.findByRole("form", { name: "Classificar mensagem" });
    await screen.findAllByRole("option", { name: /Empresa A · Pagador$/ });
    fireEvent.change(form.querySelector("select")!, {
      target: { value: "debtor:company-a:debtor-a" },
    });
    fireEvent.change(screen.getByLabelText("Motivo da classificação"), {
      target: { value: "Cliente citou a cobrança" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar classificação" }));
    await waitFor(() =>
      expect(mockApi.attributeMessage).toHaveBeenCalledWith("message-in", {
        expectedRevision: 3,
        context: { companyId: "company-a", debtorId: "debtor-a" },
        reason: "Cliente citou a cobrança",
      }),
    );
  });

  it("explains a concurrent correction and refreshes the conversation", async () => {
    const onChanged = jest.fn().mockResolvedValue(undefined);
    mockApi.attributeMessage.mockRejectedValue(
      Object.assign(new Error("Conflict"), { status: 409 }),
    );
    render(<Harness onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Classificar" }));
    fireEvent.change(await screen.findByLabelText("Motivo da classificação"), {
      target: { value: "motivo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar classificação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /alterada por outra pessoa/,
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("replies with a selected context and quote, reusing the id on retry", async () => {
    mockApi.replyToAdminConversation.mockRejectedValueOnce(new Error("Network"));
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Responder citando" }));
    const form = await screen.findByRole("form", { name: "Responder" });
    await screen.findAllByRole("option", { name: /Empresa A · Pagador · Cobrança/ });
    fireEvent.change(form.querySelector("select")!, {
      target: { value: "invoice:invoice-a" },
    });
    fireEvent.change(screen.getByLabelText("Resposta do atendimento central"), {
      target: { value: "Recebemos seu comprovante" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    await waitFor(() =>
      expect(mockApi.replyToAdminConversation).toHaveBeenCalledTimes(2),
    );
    const [first, second] = mockApi.replyToAdminConversation.mock.calls as Array<
      [string, { idempotencyId: string }]
    >;
    expect(second[1]).toEqual({
      idempotencyId: first[1].idempotencyId,
      content: "Recebemos seu comprovante",
      context: {
        companyId: "company-a",
        debtorId: "debtor-a",
        invoiceId: "invoice-a",
      },
      replyToMessageId: "message-in",
    });
  });

  it("offers only approved templates when the window is closed, requiring an invoice for payment buttons", async () => {
    render(
      <Harness
        open={false}
        templates={[
          template(),
          template({ id: "t-review", name: "Em revisão", metaReviewRequired: true }),
          template({ id: "t-paused", name: "Pausado", metaStatus: "PAUSED" }),
        ]}
      />,
    );
    expect(screen.queryByLabelText("Resposta do atendimento central")).toBeNull();
    const form = screen.getByRole("form", { name: "Responder com template" });
    expect(screen.queryByRole("option", { name: "Em revisão" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Pausado" })).toBeNull();
    fireEvent.change(form.querySelector("select")!, {
      target: { value: "template-1" },
    });
    fireEvent.change(screen.getByLabelText("Parâmetro nome_devedor"), {
      target: { value: "Ana" },
    });
    fireEvent.change(screen.getByLabelText("Parâmetro valor"), {
      target: { value: "R$ 100,00" },
    });
    const send = screen.getByRole("button", { name: "Enviar template" });
    expect(send).toBeDisabled();
    expect(screen.getByText(/selecione uma cobrança/)).toBeInTheDocument();
    await screen.findAllByRole("option", { name: /Empresa A · Pagador · Cobrança/ });
    fireEvent.change(screen.getByLabelText("Contexto do template"), {
      target: { value: "invoice:invoice-a" },
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(mockApi.replyWithTemplate).toHaveBeenCalledWith("conversation-1", {
        idempotencyId: expect.any(String) as string,
        templateId: "template-1",
        parameters: ["Ana", "R$ 100,00"],
        context: {
          companyId: "company-a",
          debtorId: "debtor-a",
          invoiceId: "invoice-a",
        },
      }),
    );
  });

  it("shows an uncertain send as a warning without any resend action", () => {
    render(<Harness />);
    expect(screen.getByRole("note")).toHaveTextContent(
      /Não reenvie esta cobrança sem confirmar com o provedor/,
    );
    expect(screen.getAllByRole("button", { name: "Classificar" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /reenviar/i })).toBeNull();
  });
});
