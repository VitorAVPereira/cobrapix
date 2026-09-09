import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
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

    expect(await screen.findByText("Novo Cliente")).toBeInTheDocument();
    expect(mockGetTemplates).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByLabelText("Template da emissao por WhatsApp"),
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
});
