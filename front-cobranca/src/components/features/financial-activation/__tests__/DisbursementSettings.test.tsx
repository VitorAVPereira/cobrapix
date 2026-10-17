import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DisbursementSettings from "../DisbursementSettings";

const mockApi = {
  getDisbursementSettings: jest.fn(),
  getDisbursementsUnderVerification: jest.fn(),
  configureDisbursements: jest.fn(),
  checkDisbursementItem: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const version = {
  id: "v1",
  version: 1,
  enabled: true,
  approverName: "Maria Souza",
  approverPhone: "5511988887777",
  changedByUserId: "admin",
  createdAt: "2026-10-16T17:30:00.000Z",
};

function conflict(code: string) {
  return Object.assign(new Error("conflito"), { status: 409, data: { code } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getDisbursementSettings.mockResolvedValue({
    current: version,
    history: [version],
    readiness: { ready: true, missing: [] },
  });
  mockApi.getDisbursementsUnderVerification.mockResolvedValue([]);
  mockApi.configureDisbursements.mockResolvedValue(version);
});

describe("DisbursementSettings", () => {
  it("lists what is missing before the feature can be released", async () => {
    mockApi.getDisbursementSettings.mockResolvedValue({
      current: null,
      history: [],
      readiness: {
        ready: false,
        missing: [
          {
            code: "TEMPLATE_UNAVAILABLE",
            message: 'Template "Falhas no lote": sem template padrão definido para a empresa.',
          },
        ],
      },
    });
    render(<DisbursementSettings companyId="company" />);
    expect(await screen.findByText("Falta para liberar:")).toBeVisible();
    expect(
      screen.getByText('Template "Falhas no lote": sem template padrão definido para a empresa.'),
    ).toBeVisible();
    expect(screen.getByText("Desligado")).toBeVisible();
  });

  it("saves the approver with the version loaded and only digits in the phone", async () => {
    render(<DisbursementSettings companyId="company" />);
    fireEvent.change(await screen.findByLabelText(/Celular do aprovador/), {
      target: { value: "55 (21) 97777-6666" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar pagamentos a colaboradores" }));
    await waitFor(() =>
      expect(mockApi.configureDisbursements).toHaveBeenCalledWith("company", {
        expectedVersion: 1,
        enabled: true,
        approverName: "Maria Souza",
        approverPhone: "5521977776666",
      }),
    );
  });

  it("asks before turning it off and does nothing when the admin gives up", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    render(<DisbursementSettings companyId="company" />);
    fireEvent.click(await screen.findByLabelText(/Liberar pagamentos a colaboradores/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar pagamentos a colaboradores" }));
    expect(confirm).toHaveBeenCalled();
    expect(mockApi.configureDisbursements).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("another admin saving first reloads instead of overwriting", async () => {
    mockApi.configureDisbursements.mockRejectedValue(conflict("VERSION_CHANGED"));
    render(<DisbursementSettings companyId="company" />);
    fireEvent.click(await screen.findByRole("button", { name: "Salvar pagamentos a colaboradores" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Outro administrador alterou a configuração",
    );
    expect(mockApi.getDisbursementSettings).toHaveBeenCalledTimes(2);
  });

  it("checks a payment under verification at Efí", async () => {
    mockApi.getDisbursementsUnderVerification.mockResolvedValue([
      {
        id: "item",
        batchId: "batch",
        recipientName: "Ana Souza",
        amountCents: 150000,
        status: "UNCERTAIN",
        idEnvio: "0b0bc6de611e4415a2b63768d6d9f155",
        sendingAt: null,
        lastCheckedAt: null,
      },
    ]);
    mockApi.checkDisbursementItem.mockResolvedValue({
      id: "item",
      status: "UNCERTAIN",
      failureReason: null,
    });
    render(<DisbursementSettings companyId="company" />);
    fireEvent.click(await screen.findByRole("button", { name: "Consultar Efí" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "A Efí ainda não encontrou esse envio",
    );
    expect(mockApi.checkDisbursementItem).toHaveBeenCalledWith("company", "item");
  });

  it("a load failure is an error, not an empty configuration", async () => {
    mockApi.getDisbursementSettings.mockRejectedValue(new Error("offline"));
    render(<DisbursementSettings companyId="company" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar",
    );
    expect(screen.queryByRole("button", { name: "Salvar pagamentos a colaboradores" })).toBeNull();
  });
});
