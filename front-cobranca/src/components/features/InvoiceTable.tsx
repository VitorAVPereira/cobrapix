"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type PaginationState,
  type OnChangeFn,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ParsedDebtor } from "./UploadCSV";
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
  PlusCircle,
  RefreshCcw,
  SearchCheck,
  Send,
  SlidersHorizontal,
} from "lucide-react";

export type InvoiceRowAction = "generate" | "resend" | "status" | "cancel";

interface InvoiceTableProps {
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

const TABLE_ICON_BUTTON_BASE =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-45";

const MOBILE_ACTION_BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45";

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
}: InvoiceTableProps) {
  const [copiedPaymentAction, setCopiedPaymentAction] = useState<string | null>(
    null,
  );
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(
    () => new Set(),
  );

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
    if (selectedIds.length === 0) {
      return;
    }

    onRunSelectedInvoices(selectedIds);
  }

  const checkStatus = (row: ParsedDebtor) => {
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

  function renderRowActions(
    invoice: ParsedDebtor,
    variant: "table" | "mobile",
  ): ReactNode {
    const invoiceId = getInvoiceId(invoice);
    const isClosed = invoice.status === "PAID" || invoice.status === "CANCELED";
    const canCancel = invoice.status === "PENDING";
    const activeAction =
      runningInvoiceAction?.invoiceId === invoiceId
        ? runningInvoiceAction.action
        : null;
    const isBusy = activeAction !== null;
    const buttonBase =
      variant === "table" ? TABLE_ICON_BUTTON_BASE : MOBILE_ACTION_BUTTON_BASE;
    const hideTextClass = variant === "table" ? "sr-only" : "";

    return (
      <div
        className={
          variant === "table"
            ? "flex min-w-[15.75rem] items-center justify-end gap-1"
            : "grid grid-cols-2 gap-2 sm:grid-cols-3"
        }
      >
        <button
          type="button"
          onClick={() => onGeneratePayment(invoice)}
          disabled={!invoiceId || isClosed || isBusy}
          className={`${buttonBase} border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100`}
          title="Gerar cobrança no gateway"
          aria-label="Gerar cobrança"
        >
          {activeAction === "generate" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CreditCard size={14} />
          )}
          <span className={hideTextClass}>Gerar</span>
        </button>
        <button
          type="button"
          onClick={() => onResendInvoice(invoice)}
          disabled={!invoiceId || isClosed || isBusy}
          className={`${buttonBase} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}
          title="Reenviar cobrança"
          aria-label="Reenviar cobrança"
        >
          {activeAction === "resend" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCcw size={14} />
          )}
          <span className={hideTextClass}>Reenviar</span>
        </button>
        <button
          type="button"
          onClick={() => onCheckPaymentStatus(invoice)}
          disabled={!invoiceId || isBusy}
          className={`${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-100`}
          title="Consultar status da fatura"
          aria-label="Consultar status"
        >
          {activeAction === "status" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <SearchCheck size={14} />
          )}
          <span className={hideTextClass}>Status</span>
        </button>
        <button
          type="button"
          onClick={() => onCancelInvoice(invoice)}
          disabled={!invoiceId || !canCancel || isBusy}
          className={`${buttonBase} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
          title="Cancelar cobrança"
          aria-label="Cancelar cobrança"
        >
          {activeAction === "cancel" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Ban size={14} />
          )}
          <span className={hideTextClass}>Cancelar</span>
        </button>
        <button
          type="button"
          onClick={() => onAddInvoice(invoice)}
          disabled={!invoice.debtorId}
          className={`${buttonBase} border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50`}
          title="Adicionar fatura"
          aria-label="Adicionar fatura"
        >
          <PlusCircle size={14} />
          <span className={hideTextClass}>Fatura</span>
        </button>
        <button
          type="button"
          onClick={() => onViewPaymentHistory(invoice)}
          disabled={!invoice.debtorId}
          className={`${buttonBase} border-sky-200 bg-white text-sky-700 hover:bg-sky-50`}
          title="Ver histórico"
          aria-label="Ver histórico"
        >
          <History size={14} />
          <span className={hideTextClass}>Histórico</span>
        </button>
        <button
          type="button"
          onClick={() => onConfigureDebtor(invoice)}
          disabled={!invoice.debtorId}
          className={`${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-100`}
          title="Editar devedor"
          aria-label="Editar devedor"
        >
          <SlidersHorizontal size={14} />
          <span className={hideTextClass}>Editar</span>
        </button>
      </div>
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
      header: () => <span className="block text-center">Ações</span>,
      cell: (info) => renderRowActions(info.row.original, "table"),
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
          disabled={selectedIds.length === 0 || isRunningSelected}
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
            <col className="w-[21%]" />
            <col className="w-[20%]" />
            <col className="w-[12%]" />
            <col className="w-[13%]" />
            <col className="w-[10%]" />
            <col className="w-[20%]" />
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
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-4">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
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

                  <div className="mt-4">
                    {renderRowActions(invoice, "mobile")}
                  </div>
                </div>
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
    </div>
  );
}
