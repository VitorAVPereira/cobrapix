import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TemplateResumeReview } from "../TemplateResumeReview";
import type { ResumeReview } from "../types";

const mockApi = { confirmTemplateResume: jest.fn() };
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const review: ResumeReview = {
  id: "review-1",
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  items: [
    {
      pendingId: "p-resume",
      companyId: "company-a",
      invoiceId: "invoice-a",
      templateId: "tpl-1",
      templateName: "lembrete",
      action: "RESUME",
      reason: null,
      previewBody: "Olá Ana, sua cobrança vence hoje.",
    },
    {
      pendingId: "p-paid",
      companyId: "company-a",
      invoiceId: "invoice-b",
      templateId: "tpl-1",
      templateName: "lembrete",
      action: "CLOSE",
      reason: "INVOICE_NOT_PENDING",
      previewBody: null,
    },
    {
      pendingId: "p-keep",
      companyId: "company-a",
      invoiceId: "invoice-c",
      templateId: null,
      templateName: null,
      action: "KEEP_BLOCKED",
      reason: "OPT_IN_MISSING",
      previewBody: null,
    },
  ],
};

function renderReview() {
  const handlers = {
    onConfirmed: jest.fn(),
    onInvalidated: jest.fn(),
    onCancel: jest.fn(),
  };
  render(<TemplateResumeReview review={review} {...handlers} />);
  return handlers;
}

beforeEach(() => jest.clearAllMocks());

describe("TemplateResumeReview", () => {
  it("separates resumable, closable and still blocked holds before any confirmation", () => {
    renderReview();
    expect(screen.getByText("Serão retomados (1)")).toBeInTheDocument();
    expect(screen.getByText("Serão encerrados sem mensagem (1)")).toBeInTheDocument();
    expect(screen.getByText("Continuam bloqueados (1)")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem que será enviada")).toHaveTextContent(
      "Olá Ana",
    );
    expect(screen.getByText(/não está mais pendente/)).toBeInTheDocument();
    expect(mockApi.confirmTemplateResume).not.toHaveBeenCalled();
  });

  it("uses one idempotency key for double clicks and retries after a timeout", async () => {
    mockApi.confirmTemplateResume
      .mockRejectedValueOnce(new Error("Tempo esgotado"))
      .mockResolvedValueOnce({
        reviewId: "review-1",
        intentIds: ["intent-1"],
        closedPendingIds: ["p-paid"],
      });
    const { onConfirmed } = renderReview();
    const confirm = screen.getByRole("button", { name: "Autorizar retomada" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent("Tempo esgotado");
    fireEvent.click(screen.getByRole("button", { name: "Autorizar retomada" }));
    expect(await screen.findByText("Retomada autorizada")).toBeInTheDocument();
    const confirmCalls = mockApi.confirmTemplateResume.mock.calls as Array<
      [string, string]
    >;
    expect(confirmCalls).toHaveLength(2);
    expect(new Set(confirmCalls.map((call) => call[1])).size).toBe(1);
    expect(confirmCalls[0]![0]).toBe("review-1");
    expect(screen.getByText(/1 envio\(s\) aguardando envio/)).toBeInTheDocument();
    expect(screen.queryByText(/entregue/i)).toBeNull();
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("invalidates the preview on a conflict", async () => {
    mockApi.confirmTemplateResume.mockRejectedValue(
      Object.assign(new Error("Conflict"), {
        status: 409,
        data: { code: "VERSION_CHANGED" },
      }),
    );
    const { onInvalidated, onCancel } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Autorizar retomada" }));
    expect(
      await screen.findByText("A pendência mudou. Revise novamente."),
    ).toBeVisible();
    expect(onInvalidated).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Autorizar retomada" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar novamente" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("explains an expired preview", async () => {
    mockApi.confirmTemplateResume.mockRejectedValue(
      Object.assign(new Error("Gone"), {
        status: 409,
        data: { code: "REVIEW_EXPIRED" },
      }),
    );
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Autorizar retomada" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("A prévia expirou"),
    );
  });
});
