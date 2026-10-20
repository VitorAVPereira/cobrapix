import "@testing-library/jest-dom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  CollectionRuleProfile,
  CollectionRuleStep,
} from "@/lib/api-client";
import {
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
  type CompanyCollectionTemplates,
} from "@/components/features/templates/types";
import ReguaPage from "../page";

const mockApiClient = {
  getRules: jest.fn(),
  getCollectionTemplates: jest.fn(),
  setRuleSteps: jest.fn(),
  createRule: jest.fn(),
  deleteRule: jest.fn(),
  classifyDebtors: jest.fn(),
  createTemplateRequest: jest.fn(),
};
// A new client object stands for the session token arriving after the first render.
let mockCurrentClient = mockApiClient;
jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockCurrentClient,
}));

function step(overrides: Partial<CollectionRuleStep>): CollectionRuleStep {
  return {
    id: "step",
    profileId: "profile-new",
    stepOrder: 0,
    channel: "WHATSAPP",
    delayDays: 0,
    sendTimeStart: null,
    sendTimeEnd: null,
    isActive: true,
    scheduleDay: 0,
    attempted: false,
    customTemplates: [],
    ...overrides,
  };
}

function profile(
  id: string,
  profileType: CollectionRuleProfile["profileType"],
  steps: CollectionRuleStep[],
): CollectionRuleProfile {
  return {
    id,
    companyId: "company-1",
    name: profileType === "NEW" ? "Novo Cliente" : "Bom Pagador",
    profileType,
    isDefault: profileType === "NEW",
    isActive: true,
    daysOverdueMin: null,
    daysOverdueMax: null,
    steps,
    _count: { debtors: 3 },
  } as CollectionRuleProfile;
}

const steps = [
  step({
    id: "inicial",
    stepOrder: 0,
    channel: "EMAIL",
    delayDays: -30,
    scheduleDay: -30,
  }),
  step({
    id: "d-2-email",
    stepOrder: 1,
    channel: "EMAIL",
    delayDays: 28,
    scheduleDay: -2,
  }),
  step({
    id: "d-2-wa",
    stepOrder: 2,
    delayDays: 0,
    scheduleDay: -2,
    attempted: true,
  }),
  step({
    id: "d4-wa",
    stepOrder: 3,
    delayDays: 6,
    scheduleDay: 4,
    customTemplates: [
      { billingMethod: "PIX", templateId: "tpl-x", templateName: "x" },
    ],
  }),
];

function collection(): CompanyCollectionTemplates {
  return {
    moments: COLLECTION_PURPOSES.flatMap((purpose) =>
      COLLECTION_SLOT_METHODS.map((billingMethod) => ({
        purpose,
        billingMethod,
        template: {
          name: `${purpose}-${billingMethod}`,
          content: {
            body: "x",
            footer: null,
            button: null,
            pixButton: null,
            boletoButton: null,
            quickReplies: [],
          },
          previewBody: `Mensagem ${purpose} ${billingMethod}`,
        },
      })),
    ),
    custom: [
      {
        ruleStepId: "d4-wa",
        profileName: "Novo Cliente",
        scheduleDay: 4,
        billingMethod: "PIX",
        template: {
          name: "x",
          content: {
            body: "x",
            footer: null,
            button: null,
            pixButton: null,
            boletoButton: null,
            quickReplies: [],
          },
          previewBody: "Mensagem sob medida",
        },
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApiClient.getRules.mockResolvedValue([
    profile("profile-new", "NEW", steps),
    profile("profile-good", "GOOD", []),
  ]);
  mockApiClient.getCollectionTemplates.mockResolvedValue(collection());
  mockApiClient.setRuleSteps.mockImplementation(
    (_id: string, input: unknown[]) =>
      Promise.resolve(
        input.map((item, index) =>
          step({ ...(item as object), id: `saved-${index}` }),
        ),
      ),
  );
  jest.spyOn(window, "confirm").mockReturnValue(true);
});

describe("ReguaPage", () => {
  it("shows one card per day with its channels and message; old Inicial steps stay out", async () => {
    render(<ReguaPage />);
    const reminder = await screen.findByRole("article", {
      name: "Contato: 2 dias antes",
    });
    expect(within(reminder).getByText("Lembrete")).toBeInTheDocument();
    expect(
      within(reminder).getByRole("checkbox", { name: /WhatsApp/ }),
    ).toBeChecked();
    expect(
      within(reminder).getByRole("checkbox", { name: /E-mail/ }),
    ).toBeChecked();
    // Already sent: the day can no longer change.
    expect(within(reminder).getByText(/Já enviada/)).toBeInTheDocument();
    expect(
      within(reminder).getByLabelText("Dia em relação ao vencimento"),
    ).toBeDisabled();

    const overdue = screen.getByRole("article", {
      name: "Contato: 4 dias após",
    });
    expect(within(overdue).getByText("Atraso")).toBeInTheDocument();
    expect(
      within(overdue).getByText("Personalizado pelo suporte"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /30 dias antes/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    // Nothing to choose about templates anymore.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("adds a contact with a shortcut and saves days and channels only", async () => {
    render(<ReguaPage />);
    fireEvent.click(await screen.findByRole("button", { name: "+3 dias" }));
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() =>
      expect(mockApiClient.setRuleSteps).toHaveBeenCalledWith("profile-new", [
        { id: "d-2-wa", stepOrder: 0, channel: "WHATSAPP", delayDays: -2 },
        { id: "d-2-email", stepOrder: 1, channel: "EMAIL", delayDays: 0 },
        { stepOrder: 2, channel: "WHATSAPP", delayDays: 5 },
        { id: "d4-wa", stepOrder: 3, channel: "WHATSAPP", delayDays: 1 },
      ]),
    );
    expect(await screen.findByText("Régua salva.")).toBeInTheDocument();
  });

  it("refuses a contact without channel and confirms before turning off a channel already sent", async () => {
    render(<ReguaPage />);
    const reminder = await screen.findByRole("article", {
      name: "Contato: 2 dias antes",
    });
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(
      within(reminder).getByRole("checkbox", { name: /WhatsApp/ }),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/já foi enviado/),
    );
    expect(
      within(reminder).getByRole("checkbox", { name: /WhatsApp/ }),
    ).toBeChecked();

    const overdue = screen.getByRole("article", {
      name: "Contato: 4 dias após",
    });
    fireEvent.click(
      within(overdue).getByRole("checkbox", { name: /WhatsApp/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escolha WhatsApp, e-mail ou os dois no contato “4 dias após”.",
    );
    expect(mockApiClient.setRuleSteps).not.toHaveBeenCalled();
  });

  it("shows the message of a day for each payment method", async () => {
    render(<ReguaPage />);
    const overdue = await screen.findByRole("article", {
      name: "Contato: 4 dias após",
    });
    fireEvent.click(
      within(overdue).getByRole("button", { name: "Ver mensagem" }),
    );
    const dialog = screen.getByRole("dialog");
    // The custom template of this step replaces the global one for Pix.
    expect(within(dialog).getByRole("img")).toHaveTextContent(
      "Mensagem sob medida",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Bolix" }));
    expect(within(dialog).getByRole("img")).toHaveTextContent(
      "Mensagem FIRST_OVERDUE BOLIX",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Atraso recorrente" }),
    );
    expect(within(dialog).getByRole("img")).toHaveTextContent(
      "Mensagem RECURRING_OVERDUE BOLIX",
    );
  });

  it("asks for a custom message for a saved step", async () => {
    mockApiClient.createTemplateRequest.mockResolvedValue({ id: "request-1" });
    render(<ReguaPage />);
    const overdue = await screen.findByRole("article", {
      name: "Contato: 4 dias após",
    });
    fireEvent.click(
      within(overdue).getByRole("button", {
        name: "Pedir mensagem personalizada",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Solicitar template personalizado",
    });
    expect(dialog).toHaveTextContent("Etapa: Novo Cliente · 4 dias após");
    fireEvent.change(
      within(dialog).getByLabelText("O que a mensagem deve dizer"),
      {
        target: { value: "Quero citar o número do contrato." },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Enviar pedido" }),
    );
    await waitFor(() =>
      expect(mockApiClient.createTemplateRequest).toHaveBeenCalledWith({
        message: "Quero citar o número do contrato.",
        purpose: "FIRST_OVERDUE",
        ruleStepId: "d4-wa",
      }),
    );
  });

  it("asks before discarding unsaved changes when switching profile", async () => {
    render(<ReguaPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "No vencimento" }),
    );
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: /Bom Pagador/ }));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/alterações não salvas/),
    );
    expect(
      screen.getByRole("article", { name: "Contato: Dia do vencimento" }),
    ).toBeInTheDocument();
  });

  it("tells a load failure apart from an empty rule", async () => {
    mockApiClient.getRules.mockRejectedValueOnce(new Error("Falha de rede"));
    render(<ReguaPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
  });

  it("drops the error of a load made before the session was ready", async () => {
    mockApiClient.getRules.mockRejectedValueOnce(
      new Error("Sessao autenticada ainda nao carregada."),
    );
    const { rerender } = render(<ReguaPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sessao");

    mockCurrentClient = { ...mockApiClient };
    rerender(<ReguaPage />);
    expect(
      await screen.findByRole("article", { name: "Contato: 2 dias antes" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    mockCurrentClient = mockApiClient;
  });
});
