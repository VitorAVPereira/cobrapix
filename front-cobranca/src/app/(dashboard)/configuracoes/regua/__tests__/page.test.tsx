import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CollectionRuleProfile,
  CollectionRuleStep,
  MessageTemplate,
} from "@/lib/api-client";
import ReguaPage from "../page";

const mockGetRules = jest.fn() as jest.MockedFunction<
  () => Promise<CollectionRuleProfile[]>
>;
const mockGetTemplates = jest.fn() as jest.MockedFunction<
  () => Promise<MessageTemplate[]>
>;
const mockSetRuleSteps = jest.fn() as jest.MockedFunction<
  (
    profileId: string,
    steps: Array<{
      stepOrder: number;
      channel: "EMAIL" | "WHATSAPP";
      templateId?: string;
      delayDays: number;
      sendTimeStart?: string;
      sendTimeEnd?: string;
    }>,
  ) => Promise<CollectionRuleStep[]>
>;

const mockApiClient = {
  getRules: mockGetRules,
  getTemplates: mockGetTemplates,
  setRuleSteps: mockSetRuleSteps,
  createRule: jest.fn(),
  deleteRule: jest.fn(),
  classifyDebtors: jest.fn(),
};

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

function createTemplateFixture(
  id: string,
  slug: string,
  name: string,
): MessageTemplate {
  return {
    id,
    name,
    slug,
    content: "Conteudo",
    footerText: null,
    paymentButtonEnabled: true,
    paymentButtonLabel: "Abrir pagamento",
    copyCodeButtonEnabled: false,
    copyCodeSource: "AUTO",
    isActive: true,
    metaTemplateName: null,
    metaLanguage: "pt_BR",
    category: "UTILITY",
    metaStatus: "LOCAL",
    metaRejectedReason: null,
    lastMetaSyncAt: null,
    companyId: "company-1",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

function createProfileFixture(): CollectionRuleProfile {
  return {
    id: "profile-1",
    companyId: "company-1",
    name: "Novo Cliente",
    profileType: "NEW",
    isDefault: true,
    isActive: true,
    daysOverdueMin: null,
    daysOverdueMax: null,
    steps: [
      {
        id: "step-emission",
        profileId: "profile-1",
        stepOrder: 0,
        channel: "WHATSAPP",
        templateId: "template-emissao",
        delayDays: -30,
        sendTimeStart: null,
        sendTimeEnd: null,
        isActive: true,
      },
      {
        id: "step-due",
        profileId: "profile-1",
        stepOrder: 1,
        channel: "WHATSAPP",
        templateId: "template-vencimento",
        delayDays: 30,
        sendTimeStart: null,
        sendTimeEnd: null,
        isActive: true,
      },
    ],
    _count: { debtors: 0 },
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

describe("ReguaPage", () => {
  beforeEach(() => {
    mockGetRules.mockReset();
    mockGetTemplates.mockReset();
    mockSetRuleSteps.mockReset();
    mockGetRules.mockResolvedValue([createProfileFixture()]);
    mockGetTemplates.mockResolvedValue([
      createTemplateFixture(
        "template-emissao",
        "cobranca-emissao",
        "Cobranca na emissao",
      ),
      createTemplateFixture(
        "template-vencimento",
        "vencimento-hoje",
        "Vencimento hoje",
      ),
      createTemplateFixture(
        "template-atraso",
        "atraso-recorrente",
        "Atraso recorrente",
      ),
    ]);
    mockSetRuleSteps.mockResolvedValue(createProfileFixture().steps);
  });

  it("carrega templates e permite escolher template por etapa", async () => {
    const user = userEvent.setup();

    render(<ReguaPage />);

    expect(
      await screen.findByRole("button", { name: /Novo Cliente/i }),
    ).toBeInTheDocument();
    expect(mockGetTemplates).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByLabelText("Template do contato inicial por WhatsApp"),
    ).toHaveValue("template-emissao");

    await user.selectOptions(
      screen.getByLabelText("Template da etapa 2"),
      "template-atraso",
    );
    await user.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(mockSetRuleSteps).toHaveBeenCalledTimes(1));
    expect(mockSetRuleSteps).toHaveBeenCalledWith(
      "profile-1",
      expect.arrayContaining([
        expect.objectContaining({
          stepOrder: 1,
          templateId: "template-atraso",
        }),
      ]),
    );
  });

  it("explica a referência dos dias e mostra uma prévia da sequência", async () => {
    render(<ReguaPage />);

    expect(
      await screen.findByRole("heading", { name: "Prévia da sequência" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/dia 0 é o vencimento/i)).toBeInTheDocument();
    expect(
      (await screen.findAllByText("No dia do vencimento")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("A partir de 30 dias antes do vencimento"),
    ).toBeInTheDocument();
  });

  it("avisa antes de descartar alterações ao trocar de perfil", async () => {
    const user = userEvent.setup();
    const secondProfile: CollectionRuleProfile = {
      ...createProfileFixture(),
      id: "profile-2",
      name: "Bom Pagador",
      profileType: "GOOD",
      isDefault: false,
      steps: [],
    };
    mockGetRules.mockResolvedValue([createProfileFixture(), secondProfile]);
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    try {
      render(<ReguaPage />);
      const emissionTemplate = await screen.findByLabelText(
        "Template do contato inicial por WhatsApp",
      );
      await user.selectOptions(emissionTemplate, "template-atraso");
      await user.click(screen.getByRole("button", { name: /Bom Pagador/i }));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(emissionTemplate).toHaveValue("template-atraso");

      confirmSpy.mockReturnValue(true);
      await user.click(screen.getByRole("button", { name: /Bom Pagador/i }));
      expect(
        await screen.findByText("Nenhuma etapa configurada."),
      ).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("permite digitar um dia negativo e atualiza a prévia antes de salvar", async () => {
    const user = userEvent.setup();
    render(<ReguaPage />);

    const dayInput = await screen.findByRole("spinbutton", {
      name: "Dia do contato 1",
    });
    await user.clear(dayInput);
    await user.type(dayInput, "-3");
    await user.tab();

    expect(dayInput).toHaveValue(-3);
    const preview = screen
      .getByRole("heading", { name: "Prévia da sequência" })
      .closest("section");
    if (!preview) throw new Error("Prévia da sequência ausente");
    expect(
      within(preview).getByText("3 dias antes do vencimento"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /salvar alterações/i }),
    );
    await waitFor(() => expect(mockSetRuleSteps).toHaveBeenCalledTimes(1));
    expect(mockSetRuleSteps).toHaveBeenCalledWith(
      "profile-1",
      expect.arrayContaining([
        expect.objectContaining({ stepOrder: 1, delayDays: 27 }),
      ]),
    );
  });

  it("explica janelas de horário incompletas antes de salvar", async () => {
    const user = userEvent.setup();
    render(<ReguaPage />);

    const startTime = await screen.findByLabelText(
      "Horário inicial do contato 1",
    );
    fireEvent.change(startTime, { target: { value: "09:00" } });
    await user.click(
      screen.getByRole("button", { name: /salvar alterações/i }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Preencha os dois horários do contato 1 ou deixe ambos vazios.",
    );
    expect(mockSetRuleSteps).not.toHaveBeenCalled();
  });

  it("protege alterações ao sair por um link ou atualizar a página", async () => {
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    try {
      render(
        <>
          <a href="/clientes">Ir para clientes</a>
          <ReguaPage />
        </>,
      );
      const template = await screen.findByLabelText(
        "Template do contato inicial por WhatsApp",
      );
      await user.selectOptions(template, "template-atraso");

      expect(
        fireEvent.click(screen.getByRole("link", { name: "Ir para clientes" })),
      ).toBe(false);
      expect(confirmSpy).toHaveBeenCalledTimes(1);

      const beforeUnload = new Event("beforeunload", { cancelable: true });
      fireEvent(window, beforeUnload);
      expect(beforeUnload.defaultPrevented).toBe(true);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("rejeita um dia fracionário em vez de convertê-lo silenciosamente", async () => {
    render(<ReguaPage />);
    const dayInput = await screen.findByRole("spinbutton", {
      name: "Dia do contato 1",
    });

    fireEvent.change(dayInput, { target: { value: "2.5" } });
    fireEvent.blur(dayInput);

    expect(dayInput).toHaveValue(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Digite um número inteiro de dias.",
    );
  });
});
