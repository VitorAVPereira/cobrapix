"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type PaginationState,
  type OnChangeFn,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ParsedDebtor } from "./UploadCSV";
import {
  DebtorActionsMenu,
  type DebtorAction,
} from "./debtors/DebtorActionsMenu";
import { formatWhatsAppNumber } from "@/lib/whatsapp-number";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  AlertCircle,
  Clock,
  CheckCircle2,
  CreditCard,
  Copy,
  Ban,
  ExternalLink,
  History,
  Loader2,
  Mail,
  MoreVertical,
  PlusCircle,
  RefreshCcw,
  SearchCheck,
  Send,
  SlidersHorizontal,
} from "lucide-react";

export type InvoiceRowAction = "generate" | "resend" | "status" | "cancel";

interface InvoiceTableProps {
  canIssue?: boolean;
  data: ParsedDebtor[];
  pageCount: number;
  total: number;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  onConfigureDebtor: (debtor: ParsedDebtor) => void;
  onAddInvoice: (debtor: ParsedDebtor) => void;
  onRunSelectedInvoices: (invoiceIds: string[]) => void;
  isRunningSelected: boolean;
  onGeneratePayment: (invoice: ParsedDebtor) => void;
  onResendInvoice: (invoice: ParsedDebtor) => void;
  onCheckPaymentStatus: (invoice: ParsedDebtor) => void;
  onCancelInvoice: (invoice: ParsedDebtor) => void;
  onViewPaymentHistory: (invoice: ParsedDebtor) => void;
  runningInvoiceAction: {
    invoiceId: string;
    action: InvoiceRowAction;
  } | null;
  showEducationFields?: boolean;
}

const PROFILE_LABELS: Record<string, string> = {
  NEW: "Novo",
  GOOD: "Bom",
  DOUBTFUL: "Duvidoso",
  BAD: "Ruim",
};

const PROFILE_COLORS: Record<string, string> = {
  NEW: "border-blue-200 bg-blue-50 text-blue-700",
  GOOD: "border-emerald-200 bg-emerald-50 text-emerald-700",
  DOUBTFUL: "border-amber-200 bg-amber-50 text-amber-700",
  BAD: "border-red-200 bg-red-50 text-red-700",
};

function getInvoiceId(invoice: ParsedDebtor): string | null {
  return invoice.invoiceId ?? invoice.id ?? null;
}

function isInvoiceSelectable(invoice: ParsedDebtor): boolean {
  return Boolean(
    getInvoiceId(invoice) &&
    invoice.status !== "PAID" &&
    invoice.status !== "CANCELED",
  );
}

function getStudentSummary(invoice: ParsedDebtor): string {
  return (
    [invoice.studentEnrollment, invoice.studentGroup]
      .filter((item): item is string => Boolean(item))
      .join(" / ") || "-"
  );
}

export function InvoiceTable({
  data,
  pageCount,
  total,
  pagination,
  onPaginationChange,
  onConfigureDebtor,
  onAddInvoice,
  onRunSelectedInvoices,
  isRunningSelected,
  onGeneratePayment,
  onResendInvoice,
  onCheckPaymentStatus,
  onCancelInvoice,
  onViewPaymentHistory,
  runningInvoiceAction,
  showEducationFields = false,
  canIssue = false,
}: InvoiceTableProps) {
  const [copiedPaymentAction, setCopiedPaymentAction] = useState<string | null>(
    null,
  );
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Row whose actions menu is open, with the button it is anchored to.
  const [openAction, setOpenAction] = useState<{
    invoice: ParsedDebtor;
    anchor: HTMLButtonElement;
  } | null>(null);
  const closeActions = useCallback(() => setOpenAction(null), []);
  // A reloaded list brings new rows: the menu of an old row closes instead of
  // acting on stale data.
  const actionInvoice =
    openAction && data.includes(openAction.invoice) ? openAction.invoice : null;

  const selectableInvoiceIds = useMemo(
    () =>
      data
        .filter((invoice) => isInvoiceSelectable(invoice))
        .map((invoice) => getInvoiceId(invoice))
        .filter((invoiceId): invoiceId is string => Boolean(invoiceId)),
    [data],
  );
  const selectedIds = useMemo(
    () =>
      selectableInvoiceIds.filter((invoiceId) =>
        selectedInvoiceIds.has(invoiceId),
      ),
    [selectableInvoiceIds, selectedInvoiceIds],
  );
  const allSelectableSelected =
    selectableInvoiceIds.length > 0 &&
    selectedIds.length === selectableInvoiceIds.length;

  function toggleInvoiceSelection(invoice: ParsedDebtor): void {
    const invoiceId = getInvoiceId(invoice);

    if (!invoiceId || !isInvoiceSelectable(invoice)) {
      return;
    }

    setSelectedInvoiceIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(invoiceId)) {
        nextIds.delete(invoiceId);
      } else {
        nextIds.add(invoiceId);
      }

      return nextIds;
    });
  }

  function toggleAllSelectable(): void {
    setSelectedInvoiceIds((currentIds) => {
      if (allSelectableSelected) {
        const nextIds = new Set(currentIds);
        selectableInvoiceIds.forEach((invoiceId) => nextIds.delete(invoiceId));
        return nextIds;
      }

      return new Set([...currentIds, ...selectableInvoiceIds]);
    });
  }

  function runSelectedInvoices(): void {
    if (!canIssue || selectedIds.length === 0) {
      return;
    }

    onRunSelectedInvoices(selectedIds);
  }

  const checkStatus = (row: ParsedDebtor) => {
    if (row.status === "DRAFT") {
      return { label: "Rascunho", color: "bg-slate-100 text-slate-600 border-slate-200", icon: Clock };
    }
    if (row.status === "PAID") {
      return {
        label: "Pago",
        color: "bg-emerald-100 text-emerald-700 border-emerald-200",
        icon: CheckCircle2,
      };
    }
    if (row.status === "CANCELED") {
      return {
        label: "Cancelado",
        color: "bg-slate-100 text-slate-500 border-slate-200",
        icon: Ban,
      };
    }

    let faturaDate: Date;
    const dateString = row.due_date;
    if (dateString.includes("/")) {
      const [dia, mes, ano] = dateString.split("/");
      faturaDate = new Date(`${ano}-${mes}-${dia}T12:00:00Z`);
    } else {
      faturaDate = new Date(`${dateString}T12:00:00Z`);
    }

    if (isNaN(faturaDate.getTime())) {
      return {
        label: "Pendente",
        color: "bg-amber-100 text-amber-700 border-amber-200",
        icon: Clock,
      };
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    if (faturaDate < hoje) {
      return {
        label: "Vencido",
        color: "bg-red-100 text-red-700 border-red-200",
        icon: AlertCircle,
      };
    }
    return {
      label: "Pendente",
      color: "bg-amber-100 text-amber-700 border-amber-200",
      icon: Clock,
    };
  };

  const formatarDataBR = (dataString: string): string => {
    if (!dataString) return "";
    if (dataString.includes("/")) return dataString;
    if (dataString.includes("-")) {
      const [ano, mes, dia] = dataString.split("-");
      return `${dia}/${mes}/${ano}`;
    }
    return dataString;
  };

  const getPaymentMethodLabel = (billingType?: string): string => {
    if (billingType === "CREDIT_CARD") return "Cartão de crédito";
    if (billingType === "BOLIX") {
      return "Bolix";
    }

    if (billingType === "BOLETO") {
      return "Boleto";
    }

    return "PIX";
  };

  const copyPaymentValue = async (
    invoice: ParsedDebtor,
    value: string,
    action: string,
  ): Promise<void> => {
    await navigator.clipboard.writeText(value);

    const invoiceKey = invoice.invoiceId ?? invoice.id ?? invoice.phone_number;
    const copiedKey = `${invoiceKey}:${action}`;
    setCopiedPaymentAction(copiedKey);
    window.setTimeout(() => {
      setCopiedPaymentAction((current) =>
        current === copiedKey ? null : current,
      );
    }, 1800);
  };

  const getCopiedLabel = (
    invoice: ParsedDebtor,
    action: string,
    defaultLabel: string,
  ): string => {
    const invoiceKey = invoice.invoiceId ?? invoice.id ?? invoice.phone_number;
    return copiedPaymentAction === `${invoiceKey}:${action}`
      ? "Copiado"
      : defaultLabel;
  };

  function renderProfileBadge(invoice: ParsedDebtor): ReactNode {
    const profile = invoice.collectionProfile;

    if (!profile) {
      return null;
    }

    return (
      <span
        className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${
          PROFILE_COLORS[profile.profileType] ??
          "border-slate-200 bg-slate-50 text-slate-500"
        }`}
      >
        {PROFILE_LABELS[profile.profileType] ?? profile.name}
      </span>
    );
  }

  function renderDebtorSummary(invoice: ParsedDebtor): ReactNode {
    const hasStudentData =
      Boolean(invoice.studentName) ||
      Boolean(invoice.studentEnrollment) ||
      Boolean(invoice.studentGroup);

    return (
      <div className="min-w-0 space-y-1.5">
        <p className="truncate font-semibold text-slate-900">{invoice.name}</p>
        {showEducationFields && hasStudentData && (
          <div className="min-w-0 text-xs leading-5 text-slate-500">
            <p className="truncate font-medium text-slate-700">
              {invoice.studentName ?? "Aluno nao informado"}
            </p>
            <p className="truncate">{getStudentSummary(invoice)}</p>
          </div>
        )}
        {renderProfileBadge(invoice)}
      </div>
    );
  }

  function renderContact(invoice: ParsedDebtor): ReactNode {
    return (
      <div className="min-w-0 space-y-1.5 text-sm text-slate-600">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle size={15} className="shrink-0 text-emerald-500" />
          <span className="truncate">
            {formatWhatsAppNumber(invoice.phone_number)}
          </span>
        </div>
        {invoice.email ? (
          <div className="flex min-w-0 items-center gap-2">
            <Mail size={15} className="shrink-0 text-slate-400" />
            <span className="truncate">{invoice.email}</span>
          </div>
        ) : (
          <span className="text-xs text-slate-300">Sem e-mail</span>
        )}
      </div>
    );
  }

  function renderCharge(invoice: ParsedDebtor): ReactNode {
    return (
      <div className="space-y-1">
        <p className="font-semibold text-slate-900 tabular-nums">
          {new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(invoice.original_amount)}
        </p>
        {invoice.payment?.financialSummary && (
          <div className="text-xs text-slate-500">
            <p>
              Taxa:{" "}
              {(
                invoice.payment.financialSummary.totalFeeCents / 100
              ).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <p>
              Líquido
              {invoice.payment.financialSummary.estimated
                ? " estimado"
                : ""}:{" "}
              {(
                invoice.payment.financialSummary.netAmountCents / 100
              ).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            {invoice.payment.financialSummary.status === "REFUNDED" && (
              <p className="text-amber-700">Estornada na Efí</p>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarDays size={14} className="shrink-0" />
          <span className="tabular-nums">
            {formatarDataBR(invoice.due_date)}
          </span>
        </div>
      </div>
    );
  }

  function renderPayment(invoice: ParsedDebtor): ReactNode {
    const payment = invoice.payment;
    const isGenerated = payment?.generated ?? false;
    const pixCopyPaste = isGenerated ? payment?.pixCopyPaste : null;
    const boletoUrl = isGenerated ? payment?.boletoUrl : null;
    const boletoLine = isGenerated ? payment?.boletoLine : null;

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
            {getPaymentMethodLabel(payment?.method ?? invoice.billing_type)}
          </span>
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
              isGenerated
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            {isGenerated ? "Gerado" : "Não gerado"}
          </span>
        </div>

        {isGenerated && payment?.method === "CREDIT_CARD" && payment.paymentLink && <a href={payment.paymentLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold"><ExternalLink size={13} />Abrir pagamento</a>}
        {(pixCopyPaste || boletoUrl || boletoLine) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {pixCopyPaste && (
              <button
                type="button"
                onClick={() => {
                  void copyPaymentValue(invoice, pixCopyPaste, "pix");
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                title="Copiar Pix cópia e cola"
              >
                <Copy size={13} />
                {getCopiedLabel(invoice, "pix", "Pix")}
              </button>
            )}
            {boletoUrl && (
              <a
                href={boletoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                title="Abrir boleto"
              >
                <ExternalLink size={13} />
                Boleto
              </a>
            )}
            {!boletoUrl && boletoLine && (
              <button
                type="button"
                onClick={() => {
                  void copyPaymentValue(invoice, boletoLine, "boleto");
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                title="Copiar linha digitável"
              >
                <Copy size={13} />
                {getCopiedLabel(invoice, "boleto", "Linha")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderStatusBadge(invoice: ParsedDebtor): ReactNode {
    const status = checkStatus(invoice);
    const Icon = status.icon;

    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.color}`}
      >
        <Icon size={13} />
        {status.label}
      </div>
    );
  }

  function isRowBusy(invoice: ParsedDebtor): boolean {
    return (
      runningInvoiceAction !== null &&
      runningInvoiceAction.invoiceId === getInvoiceId(invoice)
    );
  }

  function getRowActions(invoice: ParsedDebtor): DebtorAction[] {
    const invoiceId = getInvoiceId(invoice);
    const isClosed = invoice.status === "PAID" || invoice.status === "CANCELED";
    const chargeStatus = invoice.payment?.financialSummary?.status;
    const replacing = Boolean(
      invoice.payment?.generated &&
      invoice.payment.expiresAt &&
      new Date(invoice.payment.expiresAt) < new Date() &&
      (chargeStatus === "EXPIRED" || (chargeStatus === "ACTIVE" && !isClosed)),
    );
    const canCancel = invoice.status === "PENDING";
    const isBusy = isRowBusy(invoice);

    return [
      {
        id: "generate",
        label: replacing ? "Substituir cobrança vencida" : "Gerar cobrança",
        icon: <CreditCard size={15} />,
        disabled:
          !canIssue || !invoiceId || (isClosed && !replacing) || isBusy,
        onSelect: () => onGeneratePayment(invoice),
      },
      {
        id: "resend",
        label: "Reenviar cobrança",
        icon: <RefreshCcw size={15} />,
        disabled: !canIssue || !invoiceId || isClosed || isBusy,
        onSelect: () => onResendInvoice(invoice),
      },
      {
        id: "status",
        label: "Consultar status",
        icon: <SearchCheck size={15} />,
        disabled: !invoiceId || isBusy,
        onSelect: () => onCheckPaymentStatus(invoice),
      },
      {
        id: "add-invoice",
        label: "Adicionar fatura",
        icon: <PlusCircle size={15} />,
        disabled: !invoice.debtorId,
        onSelect: () => onAddInvoice(invoice),
      },
      {
        id: "history",
        label: "Histórico de pagamentos",
        icon: <History size={15} />,
        disabled: !invoice.debtorId,
        onSelect: () => onViewPaymentHistory(invoice),
      },
      {
        id: "configure",
        label: "Editar devedor",
        icon: <SlidersHorizontal size={15} />,
        disabled: !invoice.debtorId,
        onSelect: () => onConfigureDebtor(invoice),
      },
      {
        id: "cancel",
        label: "Cancelar cobrança",
        icon: <Ban size={15} />,
        disabled: !invoiceId || !canCancel || isBusy,
        onSelect: () => onCancelInvoice(invoice),
      },
    ];
  }

  function renderActionsButton(invoice: ParsedDebtor): ReactNode {
    return (
      <button
        type="button"
        aria-label={`Abrir ações da cobrança de ${invoice.name}`}
        aria-haspopup="menu"
        aria-expanded={openAction?.invoice === invoice}
        onClick={(event) => {
          const anchor = event.currentTarget;
          setOpenAction((current) =>
            current?.invoice === invoice ? null : { invoice, anchor },
          );
        }}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
      >
        {isRowBusy(invoice) ? (
          <Loader2 size={17} className="animate-spin" />
        ) : (
          <MoreVertical size={17} />
        )}
      </button>
    );
  }

  const columns: ColumnDef<ParsedDebtor>[] = [
    {
      id: "select",
      header: () => (
        <input
          type="checkbox"
          checked={allSelectableSelected}
          disabled={selectableInvoiceIds.length === 0}
          onChange={toggleAllSelectable}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Selecionar cobranças pendentes"
        />
      ),
      cell: (info) => {
        const invoice = info.row.original;
        const invoiceId = getInvoiceId(invoice);
        const isSelectable = isInvoiceSelectable(invoice);

        return (
          <input
            type="checkbox"
            checked={invoiceId ? selectedInvoiceIds.has(invoiceId) : false}
            disabled={!isSelectable}
            onChange={() => toggleInvoiceSelection(invoice)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Selecionar cobrança"
          />
        );
      },
    },
    {
      accessorKey: "name",
      header: showEducationFields ? "Responsável / aluno" : "Cliente",
      cell: (info) => renderDebtorSummary(info.row.original),
    },
    {
      id: "contact",
      header: "Contato",
      cell: (info) => renderContact(info.row.original),
    },
    {
      id: "charge",
      header: "Cobrança",
      cell: (info) => renderCharge(info.row.original),
    },
    {
      accessorKey: "billing_type",
      header: "Pagamento",
      cell: (info) => renderPayment(info.row.original),
    },
    {
      id: "status",
      header: "Status",
      cell: (info) => renderStatusBadge(info.row.original),
    },
    {
      id: "actions",
      header: () => <span className="block text-right">Ações</span>,
      cell: (info) => (
        <div className="flex justify-end">
          {renderActionsButton(info.row.original)}
        </div>
      ),
    },
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: pageCount || 1,
    onPaginationChange,
    state: { pagination },
  });

  const { pageIndex, pageSize } = pagination;
  const rangeStart = total === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min((pageIndex + 1) * pageSize, total);
  const totalPages = table.getPageCount();

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {selectedIds.length > 0
              ? `${selectedIds.length} cobrança${
                  selectedIds.length === 1 ? "" : "s"
                } selecionada${selectedIds.length === 1 ? "" : "s"}`
              : "Cobranças da página"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {rangeStart}-{rangeEnd} de {total} registros. O ciclo gera a
            cobrança Efí, aplica o template e envia pelo WhatsApp.
          </p>
        </div>

        <button
          type="button"
          onClick={runSelectedInvoices}
          disabled={!canIssue || selectedIds.length === 0 || isRunningSelected}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRunningSelected ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
          Enviar selecionadas
        </button>
      </div>
      <div className="hidden overflow-x-auto 2xl:block">
        <table className="w-full min-w-[1200px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[4%]" />
            <col className="w-[25%]" />
            <col className="w-[24%]" />
            <col className="w-[15%]" />
            <col className="w-[15%]" />
            <col className="w-[11%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead className="border-b border-slate-200 bg-slate-50/80">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="align-middle transition-colors hover:bg-slate-50/70"
              >
                {row.getVisibleCells().map((cell) => {
                  // Called, not mounted: flexRender mounts each inline cell
                  // function as a new component on every render, replacing the
                  // row's DOM and the button an open actions menu is anchored to.
                  const content = cell.column.columnDef.cell;
                  return (
                    <td key={cell.id} className="px-4 py-4">
                      {typeof content === "function"
                        ? content(cell.getContext())
                        : content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-slate-100 2xl:hidden">
        {table.getRowModel().rows.map((row) => {
          const invoice = row.original;
          const invoiceId = getInvoiceId(invoice);
          const isSelectable = isInvoiceSelectable(invoice);

          return (
            <article key={row.id} className="p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={
                    invoiceId ? selectedInvoiceIds.has(invoiceId) : false
                  }
                  disabled={!isSelectable}
                  onChange={() => toggleInvoiceSelection(invoice)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Selecionar cobrança"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    {renderDebtorSummary(invoice)}
                    <div className="shrink-0">{renderStatusBadge(invoice)}</div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Contato
                      </p>
                      {renderContact(invoice)}
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Cobrança
                      </p>
                      {renderCharge(invoice)}
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Pagamento
                      </p>
                      {renderPayment(invoice)}
                    </div>
                  </div>
                </div>
                {renderActionsButton(invoice)}
              </div>
            </article>
          );
        })}
      </div>

      {/* Pagination */}
      <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-5 py-3.5 sm:flex-row">
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-500">
            <span className="font-medium text-slate-700">
              {rangeStart}-{rangeEnd}
            </span>{" "}
            de <span className="font-medium text-slate-700">{total}</span>{" "}
            registros
          </p>
          <select
            value={pageSize}
            onChange={(e) =>
              onPaginationChange({
                pageIndex: 0,
                pageSize: Number(e.target.value),
              })
            }
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600"
          >
            {[10, 20, 50].map((size) => (
              <option key={size} value={size}>
                {size} / pagina
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="rounded-md border border-slate-200 bg-white p-2 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={16} className="text-slate-600" />
          </button>

          <span className="px-3 py-1.5 text-sm font-medium text-slate-700 tabular-nums">
            {pageIndex + 1} / {totalPages || 1}
          </span>

          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="rounded-md border border-slate-200 bg-white p-2 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={16} className="text-slate-600" />
          </button>
        </div>
      </div>

      <DebtorActionsMenu
        open={Boolean(actionInvoice)}
        anchor={openAction?.anchor ?? null}
        onClose={closeActions}
        label={
          actionInvoice
            ? `Ações da cobrança de ${actionInvoice.name}`
            : "Ações da cobrança"
        }
        actions={actionInvoice ? getRowActions(actionInvoice) : []}
      />
    </div>
  );
}
