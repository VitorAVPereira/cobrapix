import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipientsPanel } from "../RecipientsPanel";
import { BatchEditor } from "../BatchEditor";
import { BatchDetail } from "../BatchDetail";
import type { DisbursementBatch, DisbursementRecipient } from "@/lib/api-client";

const mockApi = {
  listDisbursementRecipients: jest.fn(),
  createDisbursementRecipient: jest.fn(),
  updateDisbursementRecipient: jest.fn(),
  importDisbursementRecipients: jest.fn(),
  createDisbursementBatch: jest.fn(),
  updateDisbursementBatch: jest.fn(),
  getDisbursementBatch: jest.fn(),
  requestDisbursementApproval: jest.fn(),
  cancelDisbursementBatch: jest.fn(),
  retryDisbursementFailures: jest.fn(),
  fetchDisbursementReceipt: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const ana: DisbursementRecipient = {
  id: "ana",
  name: "Ana Souza",
  documentType: "CPF",
  document: "52998224725",
  pixKey: "ana@example.com",
  bankIspb: null,
  bankAgency: null,
  bankAccount: null,
  bankAccountType: null,
  active: true,
  version: 1,
  createdAt: "2026-10-16T10:00:00.000Z",
  updatedAt: "2026-10-16T10:00:00.000Z",
};
const status = {
  enabled: true,
  approverName: "Maria",
  approverPhoneMasked: "(11) •••••-7777",
};
function batch(overrides: Partial<DisbursementBatch> = {}): DisbursementBatch {
  return {
    id: "batch",
    reference: "Folha 10/2026",
    status: "DRAFT",
    totalCents: 150000,
    itemCount: 1,
    retryOfBatchId: null,
    version: 2,
    createdAt: "2026-10-16T10:00:00.000Z",
    updatedAt: "2026-10-16T10:00:00.000Z",
    completedAt: null,
    approval: null,
    items: [
      {
        id: "item",
        recipientId: "ana",
        recipientName: "Ana Souza",
        documentType: "CPF",
        document: "52998224725",
        pixKey: "ana@example.com",
        bankIspb: null,
        bankAgency: null,
        bankAccount: null,
        bankAccountType: null,
        amountCents: 150000,
        status: "PENDING",
        failureCode: null,
        failureReason: null,
        sentAt: null,
        settledAt: null,
      },
    ],
    ...overrides,
  };
}
function apiError(message: string, data: unknown) {
  return Object.assign(new Error(message), { status: 400, data });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.listDisbursementRecipients.mockResolvedValue({
    items: [ana],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

describe("RecipientsPanel", () => {
  it("lists the company collaborators and where each one is paid", async () => {
    render(<RecipientsPanel />);
    expect(await screen.findByText("Ana Souza")).toBeVisible();
    expect(screen.getByText(/529\.982\.247-25 · Chave Pix ana@example\.com/)).toBeVisible();
  });

  it("a load failure is an error, not an empty list", async () => {
    mockApi.listDisbursementRecipients.mockRejectedValue(new Error("offline"));
    render(<RecipientsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar os colaboradores.",
    );
    expect(screen.queryByText("Nenhum colaborador cadastrado ainda.")).toBeNull();
  });

  it("registers a collaborator paid by bank account", async () => {
    mockApi.createDisbursementRecipient.mockResolvedValue(ana);
    render(<RecipientsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo colaborador" }));
    const form = screen.getByRole("form", { name: "Novo colaborador" });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Prestador" } });
    fireEvent.change(screen.getByLabelText("CPF ou CNPJ"), {
      target: { value: "11222333000181" },
    });
    fireEvent.click(screen.getByLabelText("Dados bancários"));
    fireEvent.change(screen.getByLabelText(/ISPB/), { target: { value: "09089356" } });
    fireEvent.change(screen.getByLabelText(/Agência/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Conta \(com dígito\)/), {
      target: { value: "123453" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de conta"), { target: { value: "tran" } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mockApi.createDisbursementRecipient).toHaveBeenCalledWith({
        name: "Prestador",
        document: "11222333000181",
        pixKey: null,
        bankIspb: "09089356",
        bankAgency: "1",
        bankAccount: "123453",
        bankAccountType: "tran",
      }),
    );
  });

  it("an edit with an old version reloads instead of overwriting", async () => {
    mockApi.updateDisbursementRecipient.mockRejectedValue(
      Object.assign(new Error("conflito"), { status: 409, data: { code: "VERSION_CHANGED" } }),
    );
    render(<RecipientsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.submit(screen.getByRole("form", { name: "Editar colaborador" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O cadastro foi alterado por outra pessoa",
    );
    expect(mockApi.updateDisbursementRecipient).toHaveBeenCalledWith(
      "ana",
      expect.objectContaining({ expectedVersion: 1, active: true }),
    );
    expect(mockApi.listDisbursementRecipients).toHaveBeenCalledTimes(2);
  });

  it("shows every refused spreadsheet line and says nothing was imported", async () => {
    mockApi.importDisbursementRecipients.mockRejectedValue(
      apiError("A planilha tem linhas inválidas. Nada foi importado.", {
        code: "IMPORT_INVALID",
        errors: [{ row: 2, message: "CPF ou CNPJ inválido." }],
      }),
    );
    render(<RecipientsPanel />);
    await screen.findByText("Ana Souza");
    const file = new File(
      ["Nome,CPF/CNPJ,Chave Pix\nAna,52998224725,ana@x.com\nBruno,111,b@x.com\n"],
      "colaboradores.csv",
      { type: "text/csv" },
    );
    fireEvent.change(screen.getByLabelText("Planilha de colaboradores"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("Linha 3: CPF ou CNPJ inválido.")).toBeVisible();
    expect(screen.getByText("Nada foi importado. Corrija estas linhas:")).toBeVisible();
    expect(mockApi.importDisbursementRecipients).toHaveBeenCalledWith([
      { name: "Ana", document: "52998224725", pixKey: "ana@x.com" },
      { name: "Bruno", document: "111", pixKey: "b@x.com" },
    ]);
  });
});

describe("BatchEditor", () => {
  it("saves a draft with the net amount of each collaborator in cents", async () => {
    mockApi.createDisbursementBatch.mockResolvedValue(batch());
    const onSaved = jest.fn();
    render(<BatchEditor onSaved={onSaved} onCancel={jest.fn()} />);
    fireEvent.change(await screen.findByLabelText("Valor de Ana Souza"), {
      target: { value: "1.500,00" },
    });
    fireEvent.change(screen.getByLabelText("Referência do lote"), {
      target: { value: "Folha 10/2026" },
    });
    expect(screen.getByText(/1 pagamento\(s\) · total R\$ 1\.500,00/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() =>
      expect(mockApi.createDisbursementBatch).toHaveBeenCalledWith({
        reference: "Folha 10/2026",
        items: [{ recipientId: "ana", amountCents: 150000 }],
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("an invalid amount blocks saving", async () => {
    render(<BatchEditor onSaved={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(await screen.findByLabelText("Valor de Ana Souza"), {
      target: { value: "mil" },
    });
    expect(screen.getByText(/Há valores inválidos/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });
});

describe("BatchDetail", () => {
  const renderDetail = (onOpen = jest.fn()) =>
    render(
      <BatchDetail batchId="batch" status={status} onClose={jest.fn()} onOpen={onOpen} />,
    );

  it("asks for approval on the approver WhatsApp with the version shown", async () => {
    mockApi.getDisbursementBatch.mockResolvedValue(batch());
    mockApi.requestDisbursementApproval.mockResolvedValue(
      batch({
        status: "AWAITING_APPROVAL",
        version: 3,
        approval: {
          requestNumber: 1,
          state: "AWAITING",
          expiresAt: "2026-10-17T17:30:00.000Z",
          decidedAt: null,
        },
      }),
    );
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Pedir aprovação" }));
    expect(confirm.mock.calls[0]?.[0]).toContain("Maria (11) •••••-7777");
    await waitFor(() =>
      expect(mockApi.requestDisbursementApproval).toHaveBeenCalledWith("batch", 2),
    );
    expect(
      await screen.findByText(
        /Aguardando aprovação no WhatsApp de Maria até 17\/10\/2026 às 14:30/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Pedir aprovação" })).toBeNull();
    confirm.mockRestore();
  });

  it("an expired batch tells the company to pay manually", async () => {
    mockApi.getDisbursementBatch.mockResolvedValue(batch({ status: "EXPIRED" }));
    renderDetail();
    expect(await screen.findByText(/faça o pagamento manualmente/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Cancelar lote/ })).toBeNull();
  });

  it("shows each failure reason and opens the new batch with the failed payments", async () => {
    const failed = batch({ status: "COMPLETED_WITH_FAILURES" });
    failed.items = [
      {
        ...failed.items[0]!,
        status: "FAILED",
        failureReason: "Chave Pix do colaborador não encontrada",
      },
    ];
    mockApi.getDisbursementBatch.mockResolvedValue(failed);
    mockApi.retryDisbursementFailures.mockResolvedValue(batch({ id: "retry" }));
    const onOpen = jest.fn();
    renderDetail(onOpen);
    expect(await screen.findByText(/Chave Pix do colaborador não encontrada/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Novo lote com os pagamentos que falharam" }),
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("retry"));
  });

  it("an item under verification warns not to pay manually; a paid one offers the receipt", async () => {
    const mixed = batch({ status: "PROCESSING" });
    mixed.items = [
      { ...mixed.items[0]!, id: "a", status: "UNCERTAIN" },
      { ...mixed.items[0]!, id: "b", status: "PAID", recipientName: "Bruno" },
    ];
    mockApi.getDisbursementBatch.mockResolvedValue(mixed);
    renderDetail();
    expect(await screen.findByText("Em verificação: não pague manualmente")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Comprovante" })).toHaveLength(1);
  });

  it("a load failure is an error with a way back", async () => {
    mockApi.getDisbursementBatch.mockRejectedValue(new Error("offline"));
    renderDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar o lote.",
    );
    expect(screen.getByRole("button", { name: "Voltar" })).toBeVisible();
  });
});
