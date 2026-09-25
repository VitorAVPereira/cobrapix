import { fireEvent, render, screen } from "@testing-library/react";
import type { MessageAttachmentSummary } from "@/lib/api-client";
import { MessageAttachment } from "../MessageAttachment";

const mockApi = { fetchAttachment: jest.fn() };
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const ready = (overrides: Partial<MessageAttachmentSummary> = {}) =>
  ({
    id: "attachment-1",
    contentType: "image/png",
    sizeBytes: 2048,
    state: "READY",
    errorCode: null,
    ...overrides,
  }) as MessageAttachmentSummary;

beforeEach(() => {
  jest.clearAllMocks();
  URL.createObjectURL = jest.fn(() => "blob:local-1");
  URL.revokeObjectURL = jest.fn();
});

describe("MessageAttachment", () => {
  it("loads an image on demand through the authenticated API and revokes it on unmount", async () => {
    mockApi.fetchAttachment.mockResolvedValue(
      new Blob(["png"], { type: "image/png" }),
    );
    const { unmount } = render(
      <MessageAttachment messageId="message-1" attachment={ready()} />,
    );
    expect(mockApi.fetchAttachment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Ver anexo image\/png · 2 KB/ }));
    expect(
      await screen.findByRole("img", { name: "Imagem anexada à mensagem" }),
    ).toHaveAttribute("src", "blob:local-1");
    expect(mockApi.fetchAttachment).toHaveBeenCalledWith(
      "message-1",
      "attachment-1",
      expect.any(AbortSignal),
    );
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-1");
  });

  it("offers PDF only as a download", async () => {
    mockApi.fetchAttachment.mockResolvedValue(
      new Blob(["%PDF"], { type: "application/pdf" }),
    );
    render(
      <MessageAttachment
        messageId="message-1"
        attachment={ready({ contentType: "application/pdf" })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ver anexo/ }));
    const link = await screen.findByRole("link", { name: "Baixar PDF" });
    expect(link).toHaveAttribute("download", "anexo-attachme.pdf");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("never renders SVG or HTML even if the server returned it", async () => {
    mockApi.fetchAttachment.mockResolvedValue(
      new Blob(["<svg onload=alert(1)>"], { type: "image/svg+xml" }),
    );
    render(<MessageAttachment messageId="message-1" attachment={ready()} />);
    fireEvent.click(screen.getByRole("button", { name: /Ver anexo/ }));
    expect(
      await screen.findByText("Tipo de arquivo não suportado para exibição."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    [404, "Anexo não encontrado."],
    [410, "Anexo expirado pelo prazo de retenção."],
    [422, "Anexo indisponível."],
  ])("explains a %i response without losing the message", async (status, text) => {
    mockApi.fetchAttachment.mockRejectedValue(
      Object.assign(new Error("x"), { status }),
    );
    render(
      <>
        <p>Comprovante enviado</p>
        <MessageAttachment messageId="message-1" attachment={ready()} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ver anexo/ }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText("Comprovante enviado")).toBeInTheDocument();
  });

  it.each([
    [{ state: "PENDING" }, /em processamento/],
    [{ state: "EXPIRED" }, /expirado pelo prazo de retenção/],
    [{ state: "UNAVAILABLE", errorCode: "FILE_TOO_LARGE" }, /passa de 16 MiB/],
    [{ state: "UNAVAILABLE", errorCode: "UNSUPPORTED_TYPE" }, /não suportado/],
  ] as const)("shows state %# without offering a download", (overrides, text) => {
    render(
      <MessageAttachment messageId="message-1" attachment={ready(overrides)} />,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(mockApi.fetchAttachment).not.toHaveBeenCalled();
  });
});
