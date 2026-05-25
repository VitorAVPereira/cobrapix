import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MessageTemplate,
  SaveMessageTemplateInput,
} from "@/lib/api-client";
import TemplatesPage from "../page";

const mockGetTemplates = jest.fn() as jest.MockedFunction<
  () => Promise<MessageTemplate[]>
>;
const mockUpdateTemplate = jest.fn() as jest.MockedFunction<
  (
    id: string,
    data: Partial<SaveMessageTemplateInput>,
  ) => Promise<MessageTemplate>
>;
const mockCreateTemplate = jest.fn() as jest.MockedFunction<
  (data: SaveMessageTemplateInput) => Promise<MessageTemplate>
>;
const mockSubmitTemplateToMeta = jest.fn();
const mockSyncTemplateMetaStatuses = jest.fn() as jest.MockedFunction<
  () => Promise<MessageTemplate[]>
>;

const mockApiClient = {
  getTemplates: mockGetTemplates,
  updateTemplate: mockUpdateTemplate,
  createTemplate: mockCreateTemplate,
  submitTemplateToMeta: mockSubmitTemplateToMeta,
  syncTemplateMetaStatuses: mockSyncTemplateMetaStatuses,
};

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

function createTemplateFixture(
  overrides: Partial<MessageTemplate> = {},
): MessageTemplate {
  return {
    id: "template-1",
    name: "Vencimento hoje",
    slug: "vencimento-hoje",
    content: "Ola, {{nome_devedor}}. Sua cobranca vence hoje.",
    footerText: "Mensagem automatica.",
    paymentButtonEnabled: true,
    paymentButtonLabel: "Abrir pagamento",
    copyCodeButtonEnabled: false,
    copyCodeSource: "AUTO",
    isActive: true,
    metaTemplateName: "cobrapix_vencimento_hoje",
    metaLanguage: "pt_BR",
    category: "UTILITY",
    metaStatus: "LOCAL",
    metaRejectedReason: null,
    lastMetaSyncAt: null,
    companyId: "company-1",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("TemplatesPage", () => {
  beforeEach(() => {
    mockGetTemplates.mockReset();
    mockUpdateTemplate.mockReset();
    mockCreateTemplate.mockReset();
    mockSubmitTemplateToMeta.mockReset();
    mockSyncTemplateMetaStatuses.mockReset();
    mockGetTemplates.mockResolvedValue([createTemplateFixture()]);
    mockUpdateTemplate.mockImplementation(async (_id, data) =>
      createTemplateFixture(data),
    );
    mockCreateTemplate.mockImplementation(async (data) =>
      createTemplateFixture(data),
    );
  });

  it("renderiza abas de componentes, preview de botoes e salva campos novos", async () => {
    const user = userEvent.setup();

    render(<TemplatesPage />);

    expect(
      await screen.findByRole("button", { name: "Corpo" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rodape" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Botoes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Meta" })).toBeInTheDocument();
    expect(screen.getByText("Abrir pagamento")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rodape" }));
    await user.clear(screen.getByLabelText("Texto do rodape"));
    await user.type(
      screen.getByLabelText("Texto do rodape"),
      "Atendimento automatico.",
    );

    await user.click(screen.getByRole("button", { name: "Botoes" }));
    await user.click(screen.getByLabelText("COPY_CODE direto"));
    await user.selectOptions(
      screen.getByLabelText("Origem do COPY_CODE"),
      "PIX_COPY_PASTE",
    );

    await user.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(mockUpdateTemplate).toHaveBeenCalledTimes(1));
    expect(mockUpdateTemplate).toHaveBeenCalledWith(
      "template-1",
      expect.objectContaining({
        footerText: "Atendimento automatico.",
        paymentButtonEnabled: true,
        paymentButtonLabel: "Abrir pagamento",
        copyCodeButtonEnabled: true,
        copyCodeSource: "PIX_COPY_PASTE",
      }),
    );
  });

  it("permite sincronizar um template pendente e mostra o status aprovado", async () => {
    const user = userEvent.setup();
    const pendingTemplate = createTemplateFixture({
      metaStatus: "PENDING",
      lastMetaSyncAt: "2026-05-23T12:00:00.000Z",
    });
    const approvedTemplate = createTemplateFixture({
      metaStatus: "APPROVED",
      lastMetaSyncAt: "2026-05-23T12:05:00.000Z",
    });
    mockGetTemplates.mockResolvedValue([pendingTemplate]);
    mockSyncTemplateMetaStatuses.mockResolvedValue([approvedTemplate]);

    render(<TemplatesPage />);

    expect((await screen.findAllByText("Pendente")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Aguardando analise da Meta/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /sincronizar agora/i }),
    );

    await waitFor(() =>
      expect(mockSyncTemplateMetaStatuses).toHaveBeenCalledTimes(1),
    );
    expect(screen.getAllByText("Aprovado").length).toBeGreaterThan(0);
    expect(screen.getByText(/Status atualizado pela Meta/i)).toBeInTheDocument();
  });
});
