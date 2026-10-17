import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import CollaboratorPaymentsPage from "../page";

const mockApi = {
  getDisbursementStatus: jest.fn(),
  listDisbursementBatches: jest.fn(),
  listDisbursementRecipients: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.listDisbursementBatches.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  mockApi.listDisbursementRecipients.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
});

describe("Pagamentos a colaboradores", () => {
  it("explains when the feature is not released for the company", async () => {
    mockApi.getDisbursementStatus.mockResolvedValue({
      enabled: false,
      approverName: null,
      approverPhoneMasked: null,
    });
    render(<CollaboratorPaymentsPage />);
    expect(await screen.findByText(/não estão liberados para a sua empresa/)).toBeVisible();
    expect(mockApi.listDisbursementBatches).not.toHaveBeenCalled();
  });

  it("a load failure is an error, not a missing feature", async () => {
    mockApi.getDisbursementStatus.mockRejectedValue(new Error("offline"));
    render(<CollaboratorPaymentsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar");
    expect(screen.queryByText(/não estão liberados/)).toBeNull();
  });

  it("shows batches and collaborators of a released company with its approver", async () => {
    mockApi.getDisbursementStatus.mockResolvedValue({
      enabled: true,
      approverName: "Maria",
      approverPhoneMasked: "(11) •••••-7777",
    });
    render(<CollaboratorPaymentsPage />);
    expect(await screen.findByText(/aprovação no WhatsApp de Maria/)).toBeVisible();
    expect(await screen.findByText(/Nenhum lote ainda/)).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Colaboradores" }));
    expect(await screen.findByText("Nenhum colaborador cadastrado ainda.")).toBeVisible();
  });
});
