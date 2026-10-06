import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PaginationState } from "@tanstack/react-table";
import { InvoiceTable } from "../InvoiceTable";
import type { ParsedDebtor } from "../UploadCSV";

function buildInvoice(status: string): ParsedDebtor {
  return {
    id: `invoice-${status.toLowerCase()}`,
    invoiceId: `invoice-${status.toLowerCase()}`,
    name: `Cliente ${status}`,
    phone_number: "+5511999999999",
    email: "cliente@example.com",
    original_amount: 150,
    due_date: "2026-07-10",
    billing_type: "PIX",
    status,
    debtorId: `debtor-${status.toLowerCase()}`,
    whatsapp_opt_in: true,
  };
}

function renderTable(options?: {
  data?: ParsedDebtor[];
  onCancelInvoice?: jest.Mock;
  canIssue?: boolean;
}): void {
  const data = options?.data ?? [buildInvoice("PENDING")];
  const pagination: PaginationState = { pageIndex: 0, pageSize: 20 };

  render(
    <InvoiceTable
      canIssue={options?.canIssue}
      data={data}
      pageCount={1}
      total={data.length}
      pagination={pagination}
      onPaginationChange={jest.fn()}
      onConfigureDebtor={jest.fn()}
      onAddInvoice={jest.fn()}
      onRunSelectedInvoices={jest.fn()}
      isRunningSelected={false}
      onGeneratePayment={jest.fn()}
      onResendInvoice={jest.fn()}
      onCheckPaymentStatus={jest.fn()}
      onCancelInvoice={options?.onCancelInvoice ?? jest.fn()}
      onViewPaymentHistory={jest.fn()}
      runningInvoiceAction={null}
    />,
  );
}

// Each row renders twice (table and mobile card); either button opens the same menu.
async function openActions(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  await user.click(
    screen.getAllByRole("button", {
      name: `Abrir ações da cobrança de ${name}`,
    })[0],
  );
}

describe("InvoiceTable row actions", () => {
  it("keeps actions inside the row menu until it is opened", async () => {
    const user = userEvent.setup();
    renderTable();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancelar cobrança" }),
    ).not.toBeInTheDocument();

    await openActions(user, "Cliente PENDING");

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "Gerar cobrança",
      "Reenviar cobrança",
      "Consultar status",
      "Adicionar fatura",
      "Histórico de pagamentos",
      "Editar devedor",
      "Cancelar cobrança",
    ]);
  });

  it("allows manual replacement when Efí expired the current charge", async () => {
    const user = userEvent.setup();
    const invoice = buildInvoice("CANCELED");
    invoice.payment = {
      generated: true,
      method: "PIX",
      pixCopyPaste: "pix",
      boletoLine: null,
      boletoUrl: null,
      boletoPdf: null,
      paymentLink: null,
      expiresAt: "2020-01-01T00:00:00.000Z",
      financialSummary: {
        grossAmountCents: 15000,
        totalFeeCents: 250,
        netAmountCents: 14750,
        estimated: true,
        status: "EXPIRED",
      },
    };
    renderTable({ data: [invoice], canIssue: true });
    expect(screen.getAllByText(/Taxa:/)).toHaveLength(2);

    await openActions(user, "Cliente CANCELED");

    expect(
      screen.getByRole("menuitem", { name: "Substituir cobrança vencida" }),
    ).toBeEnabled();
  });

  it("calls cancel handler for a pending invoice", async () => {
    const user = userEvent.setup();
    const onCancelInvoice = jest.fn();
    renderTable({ onCancelInvoice });

    await openActions(user, "Cliente PENDING");
    await user.click(screen.getByRole("menuitem", { name: "Cancelar cobrança" }));

    expect(onCancelInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "invoice-pending" }),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("disables cancel for paid and canceled invoices", async () => {
    const user = userEvent.setup();
    renderTable({ data: [buildInvoice("PAID"), buildInvoice("CANCELED")] });

    for (const name of ["Cliente PAID", "Cliente CANCELED"]) {
      await openActions(user, name);
      expect(
        screen.getByRole("menuitem", { name: "Cancelar cobrança" }),
      ).toBeDisabled();
    }
  });
});
