import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import CollaboratorPaymentsPage from "../page";

const mockApi = {
  getDisbursementStatus: jest.fn(),
  listDisbursementBatches: jest.fn(),
  listDisbursementRecipients: jest.fn(),
};
// The client changes once the session token arrives, as useApiClient does.
let mockClient: typeof mockApi = mockApi;
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockClient }));

beforeEach(() => {
  jest.clearAllMocks();
  mockClient = mockApi;
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

  it("shows payments and collaborators of a released company with its approver", async () => {
    mockApi.getDisbursementStatus.mockResolvedValue({
      enabled: true,
      approverName: "Maria",
      approverPhoneMasked: "(11) •••••-7777",
    });
    render(<CollaboratorPaymentsPage />);
    expect(await screen.findByText(/confirmação no WhatsApp de Maria/)).toBeVisible();
    expect(await screen.findByText(/Nenhum pagamento ainda/)).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Colaboradores" }));
    expect(await screen.findByText("Nenhum colaborador cadastrado ainda.")).toBeVisible();
  });

  it("an attempt before the session loads does not leave an error once it loads", async () => {
    const released = {
      enabled: true,
      approverName: "Maria",
      approverPhoneMasked: "(11) •••••-7777",
    };
    mockClient = {
      ...mockApi,
      getDisbursementStatus: jest
        .fn()
        .mockRejectedValue(new Error("Sessao autenticada ainda nao carregada.")),
    };
    const { rerender } = render(<CollaboratorPaymentsPage />);
    expect(await screen.findByRole("alert")).toBeVisible();
    mockApi.getDisbursementStatus.mockResolvedValue(released);
    mockClient = mockApi;
    rerender(<CollaboratorPaymentsPage />);
    expect(await screen.findByRole("tab", { name: "Pagamentos" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
