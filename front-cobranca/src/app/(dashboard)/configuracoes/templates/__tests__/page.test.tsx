import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TemplatesPage from "../page";
import type { EmailTemplate } from "@/lib/api-client";

const mockApi = {
  getCollectionTemplates: jest.fn(),
  getTemplateRequests: jest.fn(),
  getEmailTemplates: jest.fn(),
  updateEmailTemplate: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const email = {
  id: "e1",
  name: "Vencimento hoje",
  slug: "vencimento-hoje",
  subject: "Cobrança",
  content: "Conteúdo central",
  isActive: true,
  resendTemplateId: "r1",
  resendAlias: "central",
  resendStatus: "published",
  resendPublishedAt: null,
  lastResendSyncAt: null,
  resendError: null,
  greeting: "Olá",
  instructions: "Pague com segurança.",
  signature: "Equipe",
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
} as EmailTemplate;

describe("TemplatesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCollectionTemplates.mockResolvedValue({ moments: [], custom: [] });
    mockApi.getTemplateRequests.mockResolvedValue([]);
    mockApi.getEmailTemplates.mockResolvedValue([email]);
    mockApi.updateEmailTemplate.mockResolvedValue(email);
  });

  it("shows the collection messages of WhatsApp, read-only", async () => {
    render(<TemplatesPage />);
    expect(
      await screen.findByRole("button", { name: "Lembrete · Pix" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Saudação WhatsApp")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Saudação")).not.toBeInTheDocument();
    expect(mockApi.getCollectionTemplates).toHaveBeenCalled();
  });

  it("keeps bounded email personalization", async () => {
    render(<TemplatesPage />);
    fireEvent.click(screen.getByRole("button", { name: "E-mail" }));
    expect(await screen.findByText("Conteúdo central")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Saudação"), {
      target: { value: "Bom dia" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() =>
      expect(mockApi.updateEmailTemplate).toHaveBeenCalledWith("e1", {
        isActive: true,
        greeting: "Bom dia",
        instructions: "Pague com segurança.",
        signature: "Equipe",
      }),
    );
  });
});
