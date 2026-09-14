import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TemplatesPage from "../page";
import {
  apiClient,
  type EmailTemplate,
  type MessageTemplate,
} from "@/lib/api-client";

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getTemplates: jest.fn(),
    getEmailTemplates: jest.fn(),
    updateTemplate: jest.fn(),
    updateEmailTemplate: jest.fn(),
  },
}));
const message = {
  id: "m1",
  name: "Vencimento hoje",
  slug: "vencimento-hoje",
  content: "{{saudacao}}, cobrança de {{nome_empresa}} via CifraMais.",
  footerText: "Central",
  paymentButtonEnabled: true,
  paymentButtonLabel: "Abrir",
  copyCodeButtonEnabled: false,
  copyCodeSource: "AUTO",
  isActive: true,
  metaTemplateName: "central",
  metaLanguage: "pt_BR",
  category: "UTILITY",
  metaStatus: "APPROVED",
  metaRejectedReason: null,
  lastMetaSyncAt: null,
  greeting: "Olá",
  instructions: "Pague com segurança.",
  signature: "Equipe",
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
} as MessageTemplate;
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
    jest.mocked(apiClient.getTemplates).mockResolvedValue([message]);
    jest.mocked(apiClient.getEmailTemplates).mockResolvedValue([email]);
    jest.mocked(apiClient.updateTemplate).mockResolvedValue(message);
  });
  it("shows immutable approved content and saves only bounded personalization", async () => {
    render(<TemplatesPage />);
    expect(
      await screen.findByText(/cobrança de .* via CifraMais/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/corpo/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Saudação"), {
      target: { value: "Bom dia" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar preferências" }),
    );
    await waitFor(() =>
      expect(apiClient.updateTemplate).toHaveBeenCalledWith("m1", {
        isActive: true,
        greeting: "Bom dia",
        instructions: "Pague com segurança.",
        signature: "Equipe",
      }),
    );
  });
});
