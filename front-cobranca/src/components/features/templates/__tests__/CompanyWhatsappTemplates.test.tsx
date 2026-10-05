import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CompanyWhatsappTemplates } from "../CompanyWhatsappTemplates";
import type { CompanyWhatsappTemplate } from "../types";

const mockApi = {
  getTemplates: jest.fn(),
  getTemplatePreview: jest.fn(),
};
let mockClient: typeof mockApi = mockApi;
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockClient }));

function template(
  overrides: Partial<CompanyWhatsappTemplate> = {},
): CompanyWhatsappTemplate {
  return {
    id: "tpl-1",
    name: "lembrete_vencimento",
    language: "pt_BR",
    category: "UTILITY",
    content: {
      body: "Olá {{1}}, sua cobrança vence hoje.",
      footer: null,
      button: { label: "Pagar", url: "https://app.test/pagar/{{1}}" },
    },
    defaultFor: ["DUE_TODAY"],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = mockApi;
  mockApi.getTemplates.mockResolvedValue({
    items: [template(), template({ id: "tpl-2", name: "atraso", defaultFor: [] })],
    nextCursor: null,
  });
  mockApi.getTemplatePreview.mockImplementation((id: string) =>
    Promise.resolve({
      ok: true,
      body: id === "tpl-1" ? "Olá Maria Exemplo, sua cobrança vence hoje." : "Atraso",
      bodyParameters: [],
    }),
  );
});

describe("CompanyWhatsappTemplates", () => {
  it("shows approved content and a fictitious preview without any personalization", async () => {
    render(<CompanyWhatsappTemplates />);
    expect(
      await screen.findByText("Olá {{1}}, sua cobrança vence hoje."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Padrão para: No dia do vencimento/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Prévia com dados fictícios")).toHaveTextContent(
      "Olá Maria Exemplo",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText("Saudação WhatsApp")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salvar/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /atraso/ }));
    await waitFor(() =>
      expect(mockApi.getTemplatePreview).toHaveBeenLastCalledWith("tpl-2"),
    );
    expect(await screen.findByLabelText("Prévia com dados fictícios")).toHaveTextContent(
      "Atraso",
    );
  });

  it("pages the granted templates with the server cursor and shows the total", async () => {
    mockApi.getTemplates.mockImplementation(
      (query: { cursor?: string }) =>
        Promise.resolve(
          query.cursor === "tpl-1"
            ? { items: [template({ id: "tpl-2", name: "atraso" })], nextCursor: null, total: 11 }
            : { items: [template()], nextCursor: "tpl-1", total: 11 },
        ),
    );
    render(<CompanyWhatsappTemplates />);
    expect(
      await screen.findByText("Página 1 de 2 · 11 templates"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(
      await screen.findByRole("button", { name: /atraso/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(mockApi.getTemplates).toHaveBeenLastCalledWith({
      limit: 10,
      search: undefined,
      cursor: "tpl-1",
    });
    await waitFor(() =>
      expect(mockApi.getTemplatePreview).toHaveBeenLastCalledWith("tpl-2"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(
      await screen.findByRole("button", { name: /lembrete_vencimento/ }),
    ).toBeInTheDocument();
  });

  it("searches by name from the first page and keeps the search when nothing matches", async () => {
    mockApi.getTemplates.mockImplementation(
      (query: { search?: string }) =>
        Promise.resolve(
          query.search
            ? { items: [], nextCursor: null, total: 0 }
            : { items: [template()], nextCursor: "tpl-1", total: 11 },
        ),
    );
    render(<CompanyWhatsappTemplates />);
    fireEvent.click(await screen.findByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(mockApi.getTemplates).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "tpl-1" }),
      ),
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar template" }), {
      target: { value: " cobranca " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar template" }));
    expect(
      await screen.findByText("Nenhum template encontrado com esse nome."),
    ).toBeVisible();
    expect(mockApi.getTemplates).toHaveBeenLastCalledWith({
      limit: 10,
      search: "cobranca",
      cursor: undefined,
    });
    expect(screen.getByRole("searchbox", { name: "Buscar template" })).toBeVisible();
    expect(screen.queryByText("Nenhum template liberado para sua empresa.")).toBeNull();
  });

  it("says when nothing is granted", async () => {
    mockApi.getTemplates.mockResolvedValue({ items: [], nextCursor: null });
    render(<CompanyWhatsappTemplates />);
    expect(
      await screen.findByText("Nenhum template liberado para sua empresa."),
    ).toBeVisible();
  });

  it("does not present a failed load as an empty catalog", async () => {
    mockApi.getTemplates.mockRejectedValue(new Error("Falha de rede"));
    render(<CompanyWhatsappTemplates />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    expect(screen.queryByText("Nenhum template liberado para sua empresa.")).toBeNull();
  });

  it("drops the previous company's catalog when the session changes", async () => {
    const { rerender } = render(<CompanyWhatsappTemplates />);
    await screen.findByText("Olá {{1}}, sua cobrança vence hoje.");
    let resolve: (value: unknown) => void = () => undefined;
    mockClient = {
      getTemplates: jest.fn(() => new Promise((done) => (resolve = done))),
      getTemplatePreview: jest.fn(),
    };
    rerender(<CompanyWhatsappTemplates />);
    expect(screen.queryByText("Olá {{1}}, sua cobrança vence hoje.")).toBeNull();
    resolve({ items: [], nextCursor: null });
    expect(
      await screen.findByText("Nenhum template liberado para sua empresa."),
    ).toBeVisible();
  });
});
