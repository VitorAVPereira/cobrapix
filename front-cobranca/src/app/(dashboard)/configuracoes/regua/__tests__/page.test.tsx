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
  EmailTemplate,
  RuleStepInput,
} from "@/lib/api-client";
import type { CompanyWhatsappTemplate } from "@/components/features/templates/types";
import ReguaPage from "../page";

const mockGetRules = jest.fn() as jest.MockedFunction<
  () => Promise<CollectionRuleProfile[]>
>;
const mockGetTemplates = jest.fn() as jest.MockedFunction<
  () => Promise<CompanyWhatsappTemplate[]>
>;
const mockGetEmailTemplates = jest.fn() as jest.MockedFunction<
  () => Promise<EmailTemplate[]>
>;
const mockSetRuleSteps = jest.fn() as jest.MockedFunction<
  (profileId: string, steps: RuleStepInput[]) => Promise<CollectionRuleStep[]>
>;

const mockApiClient = {
  getRules: mockGetRules,
  getAllTemplates: mockGetTemplates,
  getEmailTemplates: mockGetEmailTemplates,
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
  name: string,
): CompanyWhatsappTemplate {
  return {
    id,
    name,
    language: "pt_BR",
    category: "UTILITY",
    content: { body: "Conteudo", footer: null, button: null },
    defaultFor: [],
  };
}

function createEmailFixture(id: string, name: string): EmailTemplate {
  return {
    id,
    name,
    slug: id,
    subject: name,
    content: "Conteudo",
    isActive: true,
    resendTemplateId: null,
    resendAlias: null,
    resendStatus: "published",
    resendPublishedAt: null,
    lastResendSyncAt: null,
    resendError: null,
    greeting: "",
    instructions: "",
    signature: "",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

function whatsappStep(
  overrides: Partial<CollectionRuleStep>,
): CollectionRuleStep {
  return {
    id: "step",
    profileId: "profile-1",
    stepOrder: 0,
    channel: "WHATSAPP",
    emailTemplateId: null,
    whatsappSelection: { mode: "DEFAULT", purpose: "EMISSION" },
    whatsappStatus: { ready: true, code: null },
    delayDays: 0,
    sendTimeStart: null,
    sendTimeEnd: null,
    isActive: true,
    ...overrides,
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
      whatsappStep({
        id: "step-emission",
        stepOrder: 0,
        delayDays: -30,
      }),
      whatsappStep({
        id: "step-due",
        stepOrder: 1,
        delayDays: 30,
        whatsappSelection: {
          mode: "EXPLICIT",
          templateId: "template-vencimento",
        },
      }),
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
    mockGetEmailTemplates.mockReset();
    mockSetRuleSteps.mockReset();
    mockGetRules.mockResolvedValue([createProfileFixture()]);
    mockGetTemplates.mockResolvedValue([
      createTemplateFixture("template-emissao", "Cobranca na emissao"),
      createTemplateFixture("template-vencimento", "Vencimento hoje"),
      createTemplateFixture("template-atraso", "Atraso recorrente"),
    ]);
    mockGetEmailTemplates.mockResolvedValue([
      createEmailFixture("email-lembrete", "Lembrete por e-mail"),
    ]);
    mockSetRuleSteps.mockResolvedValue(createProfileFixture().steps);
  });

  it("oferece o padrão da finalidade ou um template liberado por etapa", async () => {
    const user = userEvent.setup();

    render(<ReguaPage />);

    expect(
      await screen.findByRole("button", { name: /Novo Cliente/i }),
    ).toBeInTheDocument();
    expect(mockGetTemplates).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByLabelText("Template do contato inicial por WhatsApp"),
    ).toHaveValue("default");
    const stepSelect = screen.getByLabelText("Template da etapa 2");
    expect(stepSelect).toHaveValue("t:template-vencimento");
    expect(
      within(stepSelect)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Padrão da empresa: No dia do vencimento",
      "Atraso recorrente",
      "Cobranca na emissao",
      "Vencimento hoje",
    ]);

    await user.selectOptions(stepSelect, "t:template-atraso");
    await user.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(mockSetRuleSteps).toHaveBeenCalledTimes(1));
    const saved = mockSetRuleSteps.mock.calls[0]![1];
    expect(saved[0]).toMatchObject({
      id: "step-emission",
      channel: "WHATSAPP",
      whatsappSelection: { mode: "DEFAULT", purpose: "EMISSION" },
    });
    expect(saved[1]).toMatchObject({
      id: "step-due",
      stepOrder: 1,
      channel: "WHATSAPP",
      whatsappSelection: { mode: "EXPLICIT", templateId: "template-atraso" },
    });
    expect(saved[1]).not.toHaveProperty("emailTemplateId");
  });

  it("usa o catálogo de e-mail em etapas de e-mail", async () => {
    const user = userEvent.setup();
    render(<ReguaPage />);

    await screen.findByLabelText("Template da etapa 2");
    await user.click(screen.getAllByRole("button", { name: /E-mail/ }).at(-1)!);
    const stepSelect = screen.getByLabelText("Template da etapa 2");
    expect(
      within(stepSelect)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Modelo padrão", "Lembrete por e-mail"]);
    await user.selectOptions(stepSelect, "email-lembrete");
    await user.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(mockSetRuleSteps).toHaveBeenCalledTimes(1));
    const savedEmailStep = mockSetRuleSteps.mock.calls[0]![1][1];
    expect(savedEmailStep).toMatchObject({
      channel: "EMAIL",
      emailTemplateId: "email-lembrete",
    });
    expect(savedEmailStep).not.toHaveProperty("whatsappSelection");
  });

  it("acompanha a finalidade do padrão quando o dia muda", async () => {
    const user = userEvent.setup();
    mockGetRules.mockResolvedValue([
      {
        ...createProfileFixture(),
        steps: [
          whatsappStep({
            id: "step-due",
            whatsappSelection: { mode: "DEFAULT", purpose: "DUE_TODAY" },
          }),
        ],
      },
    ]);
    render(<ReguaPage />);

    const dayInput = await screen.findByRole("spinbutton", {
      name: "Dia do contato 1",
    });
    await user.clear(dayInput);
    await user.type(dayInput, "-3");
    await user.tab();
    await user.click(
      screen.getByRole("button", { name: /salvar alterações/i }),
    );

    await waitFor(() => expect(mockSetRuleSteps).toHaveBeenCalledTimes(1));
    const savedWhatsappStep = mockSetRuleSteps.mock.calls[0]![1][0];
    expect(savedWhatsappStep).toMatchObject({
      channel: "WHATSAPP",
      whatsappSelection: { mode: "DEFAULT", purpose: "BEFORE_DUE" },
    });
  });

  it("mostra a etapa com template revogado como pendência, sem oferecê-lo", async () => {
    mockGetRules.mockResolvedValue([
      {
        ...createProfileFixture(),
        steps: [
          whatsappStep({
            id: "step-revoked",
            whatsappSelection: {
              mode: "EXPLICIT",
              templateId: "template-revogado",
            },
            whatsappStatus: { ready: false, code: "NOT_GRANTED" },
          }),
          whatsappStep({
            id: "step-missing",
            stepOrder: 1,
            delayDays: 3,
            whatsappSelection: {
              mode: "DEFAULT",
              purpose: "RECURRING_OVERDUE",
            },
            whatsappStatus: { ready: false, code: "DEFAULT_MISSING" },
          }),
        ],
      },
    ]);
    render(<ReguaPage />);

    const revoked = await screen.findByLabelText("Template da etapa 1");
    expect(revoked).toHaveValue("unavailable");
    expect(
      within(revoked).getByRole("option", { name: "Template indisponível" }),
    ).toBeDisabled();
    expect(
      within(revoked).queryByRole("option", { name: /revogado/ }),
    ).toBeNull();
    const notes = screen.getAllByRole("note").map((note) => note.textContent);
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/não está mais liberado/),
        "Envios pendentes: Sem template padrão para a finalidade.",
      ]),
    );
  });

  it("não confunde falha ao carregar templates com nenhum template liberado", async () => {
    mockGetTemplates.mockRejectedValue(new Error("Falha de rede"));
    render(<ReguaPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar os templates disponíveis",
    );
    expect(screen.queryByText(/Nenhum template liberado/)).toBeNull();
    expect(await screen.findByLabelText("Template da etapa 2")).toHaveValue(
      "unavailable",
    );
    expect(
      screen.queryByText(/não está mais liberado para sua empresa/),
    ).toBeNull();
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
      await user.selectOptions(emissionTemplate, "t:template-atraso");
      await user.click(screen.getByRole("button", { name: /Bom Pagador/i }));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(emissionTemplate).toHaveValue("t:template-atraso");

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
      await user.selectOptions(template, "t:template-atraso");

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
