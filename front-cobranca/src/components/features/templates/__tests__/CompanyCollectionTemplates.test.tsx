import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CompanyCollectionTemplates } from "../CompanyCollectionTemplates";
import { previewButtons } from "../WhatsappMessagePreview";
import {
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
  type CompanyCollectionTemplates as View,
} from "../types";

const mockApi = {
  getCollectionTemplates: jest.fn(),
  getTemplateRequests: jest.fn(),
  createTemplateRequest: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const pixReminder = {
  name: "lembrete_pix",
  content: {
    body: "Olá, {{1}}! Sua cobrança vence em breve.",
    footer: "Caso já tenha realizado o pagamento, desconsidere!",
    button: { label: "Pagar agora", url: "https://app/pagar/{{1}}", index: 1 },
    pixButton: { label: "Copiar código Pix", index: 0 },
    boletoButton: null,
    quickReplies: ["Preciso de ajuda"],
  },
  previewBody: "Olá, Maria Exemplo! Sua cobrança vence em breve.",
};

function view(): View {
  return {
    moments: COLLECTION_PURPOSES.flatMap((purpose) =>
      COLLECTION_SLOT_METHODS.map((billingMethod) => ({
        purpose,
        billingMethod,
        template:
          purpose === "BEFORE_DUE" && billingMethod === "PIX"
            ? pixReminder
            : null,
      })),
    ),
    custom: [
      {
        ruleStepId: "step-1",
        profileName: "Novo Cliente",
        scheduleDay: 5,
        billingMethod: "PIX",
        template: {
          ...pixReminder,
          previewBody: "Mensagem sob medida da escola.",
        },
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCollectionTemplates.mockResolvedValue(view());
  mockApi.getTemplateRequests.mockResolvedValue([]);
});

describe("CompanyCollectionTemplates", () => {
  it("shows the 18 messages and the preview of the selected one, as the payer reads it", async () => {
    render(<CompanyCollectionTemplates />);
    const card = await screen.findByRole("button", { name: "Lembrete · Pix" });
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByRole("button", { pressed: false }).length,
    ).toBeGreaterThanOrEqual(17);

    const preview = screen.getByRole("img", {
      name: /Prévia da mensagem Lembrete · Pix/,
    });
    expect(preview).toHaveTextContent(
      "Olá, Maria Exemplo! Sua cobrança vence em breve.",
    );
    expect(preview).toHaveTextContent(
      "Caso já tenha realizado o pagamento, desconsidere!",
    );
    // Buttons in the approved order, then quick replies.
    expect(preview.textContent).toMatch(
      /Copiar código Pix.*Pagar agora.*Preciso de ajuda/,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Vence hoje · Cartão" }),
    );
    expect(
      screen.queryByRole("img", { name: /Prévia/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/ainda está em preparação pela CifraMais/),
    ).toBeInTheDocument();
  });

  it("lists the custom templates of the company with their step", async () => {
    render(<CompanyCollectionTemplates />);
    const custom = await screen.findByRole("button", { name: /Novo Cliente/ });
    expect(custom).toHaveTextContent("5 dias após o vencimento · Pix");
    fireEvent.click(custom);
    expect(
      screen.getByRole("img", { name: /Personalizado · Pix/ }),
    ).toHaveTextContent("Mensagem sob medida da escola.");
  });

  it("asks the support for a custom template, prefilled with the selected message", async () => {
    mockApi.createTemplateRequest.mockResolvedValue({
      id: "request-1",
      ruleStepId: null,
      purpose: "BEFORE_DUE",
      billingMethod: "PIX",
      message: "Quero citar a turma do aluno.",
      status: "OPEN",
      adminNote: null,
      version: 1,
      createdAt: "2026-10-20T12:00:00.000Z",
      updatedAt: "2026-10-20T12:00:00.000Z",
    });
    render(<CompanyCollectionTemplates />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Solicitar template personalizado",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Solicitar template personalizado",
    });
    expect(within(dialog).getByLabelText("Momento")).toHaveValue("BEFORE_DUE");
    expect(within(dialog).getByLabelText("Forma de pagamento")).toHaveValue(
      "PIX",
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Enviar pedido" }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "mínimo de 10 caracteres",
    );
    expect(mockApi.createTemplateRequest).not.toHaveBeenCalled();

    fireEvent.change(
      within(dialog).getByLabelText("O que a mensagem deve dizer"),
      {
        target: { value: "Quero citar a turma do aluno." },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Enviar pedido" }),
    );
    await waitFor(() =>
      expect(mockApi.createTemplateRequest).toHaveBeenCalledWith({
        message: "Quero citar a turma do aluno.",
        purpose: "BEFORE_DUE",
        billingMethod: "PIX",
      }),
    );
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Pedido enviado",
    );
    const requests = screen.getByRole("region", { name: "Meus pedidos" });
    expect(requests).toHaveTextContent("Quero citar a turma do aluno.");
    expect(requests).toHaveTextContent("Recebido");
  });

  it("tells a load failure apart from an empty list and retries", async () => {
    mockApi.getCollectionTemplates.mockRejectedValueOnce(
      new Error("Falha de rede"),
    );
    render(<CompanyCollectionTemplates />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    fireEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(
      await screen.findByRole("button", { name: "Lembrete · Pix" }),
    ).toBeInTheDocument();
  });
});

describe("previewButtons", () => {
  it("orders the template buttons by position, then the quick replies", () => {
    expect(previewButtons(pixReminder.content)).toEqual([
      { label: "Copiar código Pix", kind: "copy" },
      { label: "Pagar agora", kind: "link" },
      { label: "Preciso de ajuda", kind: "reply" },
    ]);
  });
});
