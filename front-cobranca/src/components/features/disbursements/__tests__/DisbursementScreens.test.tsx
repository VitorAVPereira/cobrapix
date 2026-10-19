import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipientsPanel } from "../RecipientsPanel";
import { BatchEditor } from "../BatchEditor";
import { BatchDetail } from "../BatchDetail";
import type { DisbursementBatch, DisbursementRecipient } from "@/lib/api-client";
import { saoPauloToday } from "@/lib/disbursements";

const today = saoPauloToday();
const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
  .toISOString()
  .slice(0, 10);
const br = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

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
  endDisbursementSchedule: jest.fn(),
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
    scheduledFor: null,
    scheduleProblem: null,
    scheduleOccurrence: null,
    schedule: null,
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
  const renderEditor = (props: Partial<Parameters<typeof BatchEditor>[0]> = {}) =>
    render(<BatchEditor status={status} onSaved={jest.fn()} onCancel={jest.fn()} {...props} />);

  it("schedules a payment for a later date with the net amount of each collaborator", async () => {
    mockApi.createDisbursementBatch.mockResolvedValue(batch({ status: "SCHEDULED" }));
    const onSaved = jest.fn();
    renderEditor({ onSaved });
    fireEvent.change(await screen.findByLabelText("Valor de Ana Souza"), {
      target: { value: "1.500,00" },
    });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Folha de novembro" } });
    fireEvent.change(screen.getByLabelText("Data do pagamento"), { target: { value: tomorrow } });
    expect(screen.getByText("1 colaborador · total R$ 1.500,00")).toBeVisible();
    expect(
      screen.getByText(`Em ${br(tomorrow)}, às 08:00, Maria recebe o pedido de confirmação no WhatsApp, válido até 23:59. Ao confirmar, os Pix saem na hora.`),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Agendar pagamento" }));
    await waitFor(() =>
      expect(mockApi.createDisbursementBatch).toHaveBeenCalledWith({
        reference: "Folha de novembro",
        items: [{ recipientId: "ana", amountCents: 150000 }],
        scheduledFor: tomorrow,
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("today sends the confirmation request right away", async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText("Valor de Ana Souza"), { target: { value: "100" } });
    expect(screen.getByLabelText("Data do pagamento")).toHaveValue(today);
    expect(screen.getByRole("button", { name: "Enviar para confirmação agora" })).toBeEnabled();
    expect(screen.getByText(/Maria recebe agora o pedido de confirmação no WhatsApp, válido até 23:59 de hoje/)).toBeVisible();
  });

  it("repeats every N weeks until a number of times", async () => {
    mockApi.createDisbursementBatch.mockResolvedValue(batch({ status: "SCHEDULED" }));
    renderEditor();
    fireEvent.change(await screen.findByLabelText("Valor de Ana Souza"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Quinzena" } });
    fireEvent.change(screen.getByLabelText("Data do pagamento"), { target: { value: tomorrow } });
    fireEvent.click(screen.getByLabelText("Repetir este pagamento"));
    fireEvent.change(screen.getByLabelText("Intervalo da repetição"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Unidade da repetição"), { target: { value: "WEEK" } });
    fireEvent.click(screen.getByLabelText(/Depois de/));
    fireEvent.change(screen.getByLabelText("Quantidade de pagamentos"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Agendar pagamento" }));
    await waitFor(() =>
      expect(mockApi.createDisbursementBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledFor: tomorrow,
          repeat: { unit: "WEEK", every: 2, occurrences: 6 },
        }),
      ),
    );
  });

  it("a repetition ending before its first date blocks saving", async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText("Valor de Ana Souza"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("Data do pagamento"), { target: { value: tomorrow } });
    fireEvent.click(screen.getByLabelText("Repetir este pagamento"));
    fireEvent.click(screen.getByLabelText(/^Em/));
    fireEvent.change(screen.getByLabelText("Data final da repetição"), { target: { value: today } });
    expect(screen.getByRole("alert")).toHaveTextContent("A data final deve ser depois do primeiro pagamento.");
    expect(screen.getByRole("button", { name: "Agendar pagamento" })).toBeDisabled();
  });

  it("editing an occurrence can apply its amounts to the next repetitions", async () => {
    mockApi.updateDisbursementBatch.mockResolvedValue(batch({ status: "SCHEDULED" }));
    renderEditor({
      batch: batch({
        status: "SCHEDULED",
        scheduledFor: tomorrow,
        schedule: {
          id: "schedule",
          unit: "MONTH",
          every: 1,
          endsOn: null,
          maxOccurrences: null,
          occurrencesCreated: 2,
          status: "ACTIVE",
          version: 1,
        },
      }),
    });
    expect(await screen.findByText(/Este pagamento se repete a cada 1 mês, sem data para terminar/)).toBeVisible();
    fireEvent.click(screen.getByLabelText(/também nas próximas repetições/));
    fireEvent.click(screen.getByRole("button", { name: "Agendar pagamento" }));
    await waitFor(() =>
      expect(mockApi.updateDisbursementBatch).toHaveBeenCalledWith(
        "batch",
        expect.objectContaining({ expectedVersion: 2, applyToSchedule: true, scheduledFor: tomorrow }),
      ),
    );
  });

  it("an invalid amount blocks saving", async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText("Valor de Ana Souza"), {
      target: { value: "mil" },
    });
    expect(screen.getByText(/Há valores inválidos/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Enviar para confirmação agora" })).toBeDisabled();
  });
});

describe("BatchDetail", () => {
  const renderDetail = (onOpen = jest.fn()) =>
    render(
      <BatchDetail batchId="batch" status={status} onClose={jest.fn()} onOpen={onOpen} />,
    );

  it("a scheduled payment says when the approver is asked and can be canceled", async () => {
    mockApi.getDisbursementBatch.mockResolvedValue(batch({ status: "SCHEDULED", scheduledFor: tomorrow }));
    mockApi.cancelDisbursementBatch.mockResolvedValue(batch({ status: "CANCELED" }));
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail();
    expect(
      await screen.findByText(`Em ${br(tomorrow)}, às 08:00, Maria recebe o pedido de confirmação no WhatsApp. Até lá, você pode editar ou cancelar.`),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pagamento" }));
    await waitFor(() => expect(mockApi.cancelDisbursementBatch).toHaveBeenCalledWith("batch"));
    confirm.mockRestore();
  });

  it("a scheduled request that could not go out shows why and offers to schedule again", async () => {
    mockApi.getDisbursementBatch.mockResolvedValue(
      batch({ status: "DRAFT", scheduledFor: today, scheduleProblem: "Ana Souza está desativado." }),
    );
    renderDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi para confirmação na data. Ana Souza está desativado.");
    expect(screen.getByRole("button", { name: "Editar e agendar" })).toBeVisible();
  });

  it("awaiting confirmation shows the deadline", async () => {
    mockApi.getDisbursementBatch.mockResolvedValue(
      batch({
        status: "AWAITING_APPROVAL",
        approval: { requestNumber: 1, state: "AWAITING", expiresAt: "2026-10-20T02:59:59.999Z", decidedAt: null },
      }),
    );
    renderDetail();
    expect(await screen.findByText(/Aguardando a confirmação de Maria no WhatsApp até 19\/10\/2026 às 23:59/)).toBeVisible();
  });

  it("ends a repetition after confirming", async () => {
    const repeating = batch({
      status: "SCHEDULED",
      scheduledFor: tomorrow,
      schedule: {
        id: "schedule",
        unit: "MONTH",
        every: 1,
        endsOn: null,
        maxOccurrences: 12,
        occurrencesCreated: 1,
        status: "ACTIVE",
        version: 3,
      },
    });
    mockApi.getDisbursementBatch.mockResolvedValue(repeating);
    mockApi.endDisbursementSchedule.mockResolvedValue({ id: "schedule", status: "ENDED" });
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail();
    expect(await screen.findByText(/repete a cada 1 mês, 12 vezes/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar repetição" }));
    await waitFor(() => expect(mockApi.endDisbursementSchedule).toHaveBeenCalledWith("schedule", 3));
    confirm.mockRestore();
  });

  it("not confirmed by the end of the day tells the company to pay manually", async () => {
    mockApi.getDisbursementBatch.mockResolvedValue(batch({ status: "EXPIRED" }));
    renderDetail();
    expect(await screen.findByText(/não confirmou até o fim do dia/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Cancelar pagamento/ })).toBeNull();
  });

  it("shows each failure reason and opens the new payment with the failed ones", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Novo pagamento com os que falharam" }));
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar o pagamento.");
    expect(screen.getByRole("button", { name: "Voltar aos pagamentos" })).toBeVisible();
  });
});
