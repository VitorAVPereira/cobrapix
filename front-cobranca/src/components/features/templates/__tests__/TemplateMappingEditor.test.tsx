import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TemplateMappingEditor } from "../TemplateMappingEditor";
import type { AdminWhatsappTemplate } from "../types";

const mockApi = {
  getAdminWhatsappTemplate: jest.fn(),
  previewWhatsappTemplate: jest.fn(),
  saveWhatsappTemplateMapping: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

function template(overrides: Partial<AdminWhatsappTemplate> = {}): AdminWhatsappTemplate {
  return {
    id: "tpl-1",
    name: "lembrete_vencimento",
    language: "pt_BR",
    category: "UTILITY",
    status: "APPROVED",
    quality: null,
    rejectedReason: null,
    supported: true,
    supportReason: null,
    reviewRequired: true,
    archivedAt: null,
    providerRevision: 3,
    mappingRevision: 0,
    policyVersion: 1,
    readiness: { ready: false, code: "REVIEW_REQUIRED" },
    parameterFormat: "POSITIONAL",
    variables: ["1", "2"],
    content: {
      body: "Olá {{1}}, sua cobrança vence em {{2}}.",
      footer: "CifraMais",
      button: { label: "Pagar", url: "https://app.test/pagar/{{1}}" },
    },
    mapping: null,
    grantedCompanies: 0,
    lastSyncAt: null,
    ...overrides,
  };
}

function renderEditor(onSaved = jest.fn()) {
  render(
    <TemplateMappingEditor templateId="tpl-1" onClose={jest.fn()} onSaved={onSaved} />,
  );
  return onSaved;
}

async function fillMapping(): Promise<void> {
  fireEvent.change(await screen.findByLabelText("Variável {{1}}"), {
    target: { value: "DEBTOR_NAME" },
  });
  fireEvent.change(screen.getByLabelText("Variável {{2}}"), {
    target: { value: "LITERAL" },
  });
  fireEvent.change(screen.getByLabelText("Texto fixo da variável {{2}}"), {
    target: { value: "breve" },
  });
}

const expectedMapping = {
  body: {
    "1": { kind: "SOURCE", source: "DEBTOR_NAME" },
    "2": { kind: "LITERAL", value: "breve" },
  },
  paymentButton: { index: 0, source: "PAYMENT_URL_SUFFIX" },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getAdminWhatsappTemplate.mockResolvedValue(template());
  mockApi.previewWhatsappTemplate.mockResolvedValue({
    ok: true,
    body: "Olá Maria Exemplo, sua cobrança vence em breve.",
    bodyParameters: ["Maria Exemplo", "breve"],
  });
});

describe("TemplateMappingEditor", () => {
  it("keeps approved content read-only and maps every position before previewing", async () => {
    renderEditor();
    expect(
      await screen.findByText("Olá {{1}}, sua cobrança vence em {{2}}."),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/sua cobrança vence/)).toBeNull();
    expect(screen.getByRole("button", { name: "Visualizar prévia" })).toBeDisabled();
    await fillMapping();
    fireEvent.click(screen.getByRole("button", { name: "Visualizar prévia" }));
    expect(await screen.findByLabelText("Prévia fictícia")).toHaveTextContent(
      "Olá Maria Exemplo, sua cobrança vence em breve.",
    );
    expect(mockApi.previewWhatsappTemplate).toHaveBeenCalledWith("tpl-1", {
      mapping: expectedMapping,
    });
    // Editing again invalidates the preview shown.
    fireEvent.change(screen.getByLabelText("Texto fixo da variável {{2}}"), {
      target: { value: "logo" },
    });
    expect(screen.queryByLabelText("Prévia fictícia")).toBeNull();
  });

  it("saves against the loaded revisions", async () => {
    mockApi.saveWhatsappTemplateMapping.mockResolvedValue({ mappingRevision: 1 });
    const onSaved = renderEditor();
    await fillMapping();
    fireEvent.click(screen.getByRole("button", { name: "Salvar variáveis" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockApi.saveWhatsappTemplateMapping).toHaveBeenCalledWith("tpl-1", {
      expectedProviderRevision: 3,
      expectedMappingRevision: 0,
      mapping: expectedMapping,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("revisão 1");
  });

  it("reloads on a version conflict instead of overwriting", async () => {
    mockApi.saveWhatsappTemplateMapping.mockRejectedValue(
      Object.assign(new Error("Conflict"), { status: 409 }),
    );
    const onSaved = renderEditor();
    await fillMapping();
    fireEvent.click(screen.getByRole("button", { name: "Visualizar prévia" }));
    await screen.findByLabelText("Prévia fictícia");
    mockApi.getAdminWhatsappTemplate.mockResolvedValue(
      template({
        providerRevision: 4,
        mappingRevision: 2,
        mapping: {
          body: {
            "1": { kind: "SOURCE", source: "COMPANY_NAME" },
            "2": { kind: "SOURCE", source: "DUE_DATE" },
          },
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar variáveis" }));
    expect(
      await screen.findByText("A configuração mudou. Atualize a prévia."),
    ).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Prévia fictícia")).toBeNull();
    expect(screen.getByLabelText("Variável {{1}}")).toHaveValue("COMPANY_NAME");
    expect(screen.getByText(/revisão do conteúdo 4/)).toBeInTheDocument();
  });

  it("shows why a preview could not be filled", async () => {
    mockApi.previewWhatsappTemplate.mockResolvedValue({
      ok: false,
      code: "UNSUPPORTED",
      field: "body.2",
    });
    renderEditor();
    await fillMapping();
    fireEvent.click(screen.getByRole("button", { name: "Visualizar prévia" }));
    expect(await screen.findByLabelText("Prévia fictícia")).toHaveTextContent(
      "Configuração inválida em variável {{2}}.",
    );
  });

  it("maps a named template by variable name", async () => {
    mockApi.getAdminWhatsappTemplate.mockResolvedValue(
      template({
        parameterFormat: "NAMED",
        variables: ["nome_devedor", "metodo_pagamento"],
        content: {
          body: "Olá, {{nome_devedor}}. Forma de pagamento: {{metodo_pagamento}}",
          footer: null,
          button: null,
        },
      }),
    );
    mockApi.saveWhatsappTemplateMapping.mockResolvedValue({
      mappingRevision: 1,
    });
    renderEditor();
    expect(await screen.findByText(/variáveis com nome/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Variável {{nome_devedor}}"), {
      target: { value: "DEBTOR_NAME" },
    });
    fireEvent.change(screen.getByLabelText("Variável {{metodo_pagamento}}"), {
      target: { value: "LITERAL" },
    });
    fireEvent.change(
      screen.getByLabelText("Texto fixo da variável {{metodo_pagamento}}"),
      { target: { value: "Boleto" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar variáveis" }));
    await waitFor(() =>
      expect(mockApi.saveWhatsappTemplateMapping).toHaveBeenCalledWith(
        "tpl-1",
        {
          expectedProviderRevision: 3,
          expectedMappingRevision: 0,
          mapping: {
            body: {
              nome_devedor: { kind: "SOURCE", source: "DEBTOR_NAME" },
              metodo_pagamento: { kind: "LITERAL", value: "Boleto" },
            },
          },
        },
      ),
    );
  });

  it("binds the payment button at its approved position and lists quick replies", async () => {
    mockApi.getAdminWhatsappTemplate.mockResolvedValue(
      template({
        variables: [],
        content: {
          body: "Sua cobrança está disponível.",
          footer: null,
          button: {
            label: "Link do pagamento",
            url: "https://app.test/pagar/{{1}}",
            index: 1,
          },
          quickReplies: ["Preciso de ajuda"],
        },
      }),
    );
    mockApi.saveWhatsappTemplateMapping.mockResolvedValue({ mappingRevision: 1 });
    renderEditor();
    expect(
      await screen.findByText(/Respostas rápidas enviadas como aprovadas: Preciso de ajuda/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar variáveis" }));
    await waitFor(() =>
      expect(mockApi.saveWhatsappTemplateMapping).toHaveBeenCalledWith(
        "tpl-1",
        expect.objectContaining({
          mapping: {
            body: {},
            paymentButton: { index: 1, source: "PAYMENT_URL_SUFFIX" },
          },
        }),
      ),
    );
  });

  it("binds the Copy Pix code button to the invoice Pix code", async () => {
    mockApi.getAdminWhatsappTemplate.mockResolvedValue(
      template({
        parameterFormat: "NAMED",
        variables: ["nome_devedor"],
        content: {
          body: "Boa tarde, {{nome_devedor}}.",
          footer: "Caso já tenha realizado o pagamento, desconsidere!",
          button: null,
          pixButton: { label: "Copiar código Pix", index: 0 },
          quickReplies: ["Preciso de ajuda"],
        },
      }),
    );
    mockApi.saveWhatsappTemplateMapping.mockResolvedValue({ mappingRevision: 1 });
    renderEditor();
    expect(
      await screen.findByText(/Botão “Copiar código Pix”: copia o Pix copia e cola/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Variável {{nome_devedor}}"), {
      target: { value: "DEBTOR_NAME" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar variáveis" }));
    await waitFor(() =>
      expect(mockApi.saveWhatsappTemplateMapping).toHaveBeenCalledWith(
        "tpl-1",
        expect.objectContaining({
          mapping: {
            body: { nome_devedor: { kind: "SOURCE", source: "DEBTOR_NAME" } },
            pixButton: { index: 0, source: "PIX_COPY_PASTE" },
          },
        }),
      ),
    );
  });

  it("offers no mapping for an unsupported format", async () => {
    mockApi.getAdminWhatsappTemplate.mockResolvedValue(
      template({ supported: false, supportReason: "HEADER_MEDIA", variables: [] }),
    );
    renderEditor();
    expect(await screen.findByText("Formato não suportado")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Salvar variáveis" })).toBeNull();
  });
});
