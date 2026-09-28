import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TemplatePendingSends } from "../TemplatePendingSends";
import type { TemplatePendingSend } from "../types";

const mockApi = {
  getAdminTemplatePending: jest.fn(),
  getCompanyTemplatePending: jest.fn(),
  getCompanyWhatsappTemplates: jest.fn(),
  previewTemplateResume: jest.fn(),
  confirmTemplateResume: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

function pending(overrides: Partial<TemplatePendingSend> = {}): TemplatePendingSend {
  return {
    id: "p-1",
    origin: "COLLECTION",
    invoiceId: "invoice-a",
    code: "NOT_GRANTED",
    state: "BLOCKED",
    version: 1,
    occurrences: 2,
    blockedAt: "2026-09-27T10:00:00.000Z",
    resolvedAt: null,
    closedReason: null,
    companyId: "company-a",
    companyName: "Empresa A",
    templateId: "tpl-old",
    templateName: "antigo",
    ruleStepId: "step-1",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getAdminTemplatePending.mockResolvedValue({
    items: [
      pending(),
      pending({ id: "p-2", companyId: "company-b", companyName: "Empresa B" }),
    ],
    nextCursor: null,
  });
  mockApi.getCompanyWhatsappTemplates.mockResolvedValue({
    companyId: "company-a",
    grants: [
      {
        templateId: "tpl-new",
        templateName: "novo",
        language: "pt_BR",
        enabled: true,
        version: 1,
        available: { ready: true, code: null },
      },
      {
        templateId: "tpl-revoked",
        templateName: "revogado",
        language: "pt_BR",
        enabled: false,
        version: 2,
        available: { ready: false, code: "NOT_GRANTED" },
      },
    ],
    defaults: [],
  });
  mockApi.previewTemplateResume.mockResolvedValue({
    id: "review-1",
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    items: [
      {
        pendingId: "p-1",
        companyId: "company-a",
        invoiceId: "invoice-a",
        templateId: "tpl-new",
        templateName: "novo",
        action: "RESUME",
        reason: null,
        previewBody: "Olá",
      },
    ],
  });
});

describe("TemplatePendingSends (admin)", () => {
  it("preselects nothing and previews only the chosen holds with an explicit replacement", async () => {
    render(<TemplatePendingSends scope="ADMIN" />);
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole("button", { name: /Revisar retomada/ })).toBeNull();

    fireEvent.click(boxes[0]!);
    const replacement = await screen.findByLabelText("Template na retomada");
    expect(
      within(replacement).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Manter a escolha atual", "novo"]);
    fireEvent.change(replacement, { target: { value: "tpl-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar retomada (1)" }));
    await waitFor(() =>
      expect(mockApi.previewTemplateResume).toHaveBeenCalledWith([
        { pendingId: "p-1", replacementTemplateId: "tpl-new" },
      ]),
    );
    expect(await screen.findByRole("region", { name: "Prévia da retomada" })).toBeVisible();
    expect(mockApi.confirmTemplateResume).not.toHaveBeenCalled();
  });

  it("filters by company, template and reason", async () => {
    render(<TemplatePendingSends scope="ADMIN" />);
    await screen.findAllByRole("checkbox");
    fireEvent.click(screen.getAllByRole("button", { name: "Empresa A" })[0]!);
    await waitFor(() =>
      expect(mockApi.getAdminTemplatePending).toHaveBeenLastCalledWith(
        expect.objectContaining({ companyId: "company-a", state: "BLOCKED" }),
      ),
    );
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "NOT_APPROVED" },
    });
    await waitFor(() =>
      expect(mockApi.getAdminTemplatePending).toHaveBeenLastCalledWith(
        expect.objectContaining({ companyId: "company-a", code: "NOT_APPROVED" }),
      ),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "antigo" })[0]!);
    await waitFor(() =>
      expect(mockApi.getAdminTemplatePending).toHaveBeenLastCalledWith(
        expect.objectContaining({ templateId: "tpl-old" }),
      ),
    );
  });
});

describe("TemplatePendingSends (company)", () => {
  it("shows reasons and states of its own holds without any resume control", async () => {
    mockApi.getCompanyTemplatePending.mockResolvedValue({
      items: [
        {
          id: "p-1",
          origin: "COLLECTION",
          invoiceId: "invoice-a",
          code: "DEFAULT_MISSING",
          state: "BLOCKED",
          version: 1,
          occurrences: 1,
          blockedAt: "2026-09-27T10:00:00.000Z",
          resolvedAt: null,
          closedReason: null,
        },
      ],
      nextCursor: null,
    });
    render(<TemplatePendingSends scope="COMPANY" />);
    expect(
      await screen.findByText("Sem template padrão para a finalidade"),
    ).toBeInTheDocument();
    expect(mockApi.getCompanyTemplatePending).toHaveBeenCalledWith({
      state: "BLOCKED",
      cursor: undefined,
      limit: 25,
    });
    expect(mockApi.getAdminTemplatePending).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("Motivo")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Autorizar retomada" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revisar retomada/ })).toBeNull();
  });
});
