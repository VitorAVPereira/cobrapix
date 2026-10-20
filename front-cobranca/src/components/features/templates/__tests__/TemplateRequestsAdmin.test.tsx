import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { TemplateRequestsAdmin } from "../TemplateRequestsAdmin";
import type { TemplateRequest } from "../types";

const mockApi = {
  getAdminTemplateRequests: jest.fn(),
  updateTemplateRequest: jest.fn(),
  getCompanyCollectionSteps: jest.fn(),
  getCollectionTemplateSlots: jest.fn(),
  setCompanyCollectionStepTemplate: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const request: TemplateRequest = {
  id: "request-1",
  companyId: "company-a",
  companyName: "Escola A",
  ruleStepId: "step-1",
  purpose: "BEFORE_DUE",
  billingMethod: "PIX",
  message: "Quero citar a turma do aluno.",
  status: "OPEN",
  adminNote: null,
  version: 3,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getAdminTemplateRequests.mockResolvedValue([request]);
  mockApi.updateTemplateRequest.mockResolvedValue({ ...request, version: 4 });
  mockApi.getCompanyCollectionSteps.mockResolvedValue([
    {
      ruleStepId: "step-1",
      profileId: "profile-1",
      profileName: "Novo Cliente",
      scheduleDay: -2,
      customTemplates: [],
    },
  ]);
  mockApi.getCollectionTemplateSlots.mockResolvedValue({
    slots: [],
    options: {
      PIX: [{ id: "tpl-escola", name: "lembrete_escola", language: "pt_BR" }],
      BOLIX: [],
      CREDIT_CARD: [],
    },
  });
  mockApi.setCompanyCollectionStepTemplate.mockResolvedValue({
    templateId: "tpl-escola",
  });
});

describe("TemplateRequestsAdmin", () => {
  it("lists open requests and saves a status with the version seen", async () => {
    render(<TemplateRequestsAdmin />);
    expect(
      await screen.findByText("Quero citar a turma do aluno."),
    ).toBeInTheDocument();
    expect(mockApi.getAdminTemplateRequests).toHaveBeenCalledWith("OPEN");

    fireEvent.change(screen.getByLabelText("Situação do pedido de Escola A"), {
      target: { value: "IN_PROGRESS" },
    });
    fireEvent.change(screen.getByLabelText("Resposta para a empresa"), {
      target: { value: "Enviado para aprovação na Meta." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(mockApi.updateTemplateRequest).toHaveBeenCalledWith("request-1", {
        status: "IN_PROGRESS",
        adminNote: "Enviado para aprovação na Meta.",
        expectedVersion: 3,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Solicitação atualizada.",
    );
  });

  it("reloads on a conflict instead of overwriting", async () => {
    mockApi.updateTemplateRequest.mockRejectedValue(
      Object.assign(new Error("conflito"), { status: 409 }),
    );
    render(<TemplateRequestsAdmin />);
    fireEvent.change(
      await screen.findByLabelText("Situação do pedido de Escola A"),
      {
        target: { value: "DONE" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /outro administrador/i,
    );
    await waitFor(() =>
      expect(mockApi.getAdminTemplateRequests).toHaveBeenCalledTimes(2),
    );
  });

  it("links the custom template to the step of the request", async () => {
    render(<TemplateRequestsAdmin />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Ligar template sob medida" }),
    );
    const step = await screen.findByLabelText("Etapa");
    expect(step).toHaveValue("step-1");
    expect(
      within(step).getByRole("option", {
        name: "Novo Cliente · 2 dias antes do vencimento",
      }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Template"), {
      target: { value: "tpl-escola" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ligar à etapa" }));
    await waitFor(() =>
      expect(mockApi.setCompanyCollectionStepTemplate).toHaveBeenCalledWith(
        "company-a",
        "step-1",
        "PIX",
        "tpl-escola",
      ),
    );
    expect(
      await screen.findByText("Template sob medida ligado à etapa."),
    ).toBeInTheDocument();
  });
});
