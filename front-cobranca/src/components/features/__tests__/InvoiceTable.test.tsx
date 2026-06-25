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
}): void {
  const data = options?.data ?? [buildInvoice("PENDING")];
  const pagination: PaginationState = { pageIndex: 0, pageSize: 20 };

  render(
    <InvoiceTable
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

function getEnabledCancelButton(): HTMLButtonElement {
  const buttons = screen.getAllByRole("button", {
    name: /cancelar cobrança/i,
  });
  const enabledButton = buttons.find((button) => !button.hasAttribute("disabled"));

  if (!(enabledButton instanceof HTMLButtonElement)) {
    throw new Error("Expected an enabled cancel button.");
  }

  return enabledButton;
}

describe("InvoiceTable cancel action", () => {
  it("calls cancel handler for a pending invoice", async () => {
    const user = userEvent.setup();
    const onCancelInvoice = jest.fn();
    renderTable({ onCancelInvoice });

    await user.click(getEnabledCancelButton());

    expect(onCancelInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "invoice-pending" }),
    );
  });

  it("disables cancel handler for paid and canceled invoices", () => {
    renderTable({ data: [buildInvoice("PAID"), buildInvoice("CANCELED")] });

    const buttons = screen.getAllByRole("button", {
      name: /cancelar cobrança/i,
    });

    expect(buttons).toHaveLength(4);
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });
});
