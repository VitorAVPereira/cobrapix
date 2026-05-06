"use client";

import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  type PaginationState,
  type OnChangeFn,
} from "@tanstack/react-table";
import type { ParsedDebtor } from "./UploadCSV";
import { formatWhatsAppNumber } from "@/lib/whatsapp-number";
import {
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
  PlusCircle,
  RefreshCcw,
  SearchCheck,
  Send,
  SlidersHorizontal,
} from "lucide-react";

export type InvoiceRowAction = "generate" | "resend" | "status";

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

  const educationColumns: ColumnDef<ParsedDebtor>[] = showEducationFields
    ? [
        {
          id: "student",
          header: "Aluno",
          cell: (info) => {
            const invoice = info.row.original;

            if (
              !invoice.studentName &&
              !invoice.studentEnrollment &&
              !invoice.studentGroup
            ) {
              return <span className="text-xs text-slate-300">-</span>;
            }

            return (
              <div className="min-w-44 whitespace-normal">
                <p className="font-medium text-slate-900">
                  {invoice.studentName ?? "Aluno nao informado"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {[invoice.studentEnrollment, invoice.studentGroup]
                    .filter((item): item is string => Boolean(item))
                    .join(" / ") || "-"}
                </p>
              </div>
            );
          },
        },
      ]
    : [];

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
      header: showEducationFields
        ? "Responsavel / Devedor"
        : "Cliente / Devedor",
      cell: (info) => (
        <span className="font-medium text-slate-900">
          {info.getValue() as string}
        </span>
      ),
    },
    ...educationColumns,
    {
      accessorKey: "phone_number",
      header: "WhatsApp",
      cell: (info) => {
        const zap = info.getValue() as string;
        return (
          <div className="flex items-center gap-2 text-slate-600">
            <MessageCircle size={15} className="text-emerald-500 shrink-0" />
            <span>{formatWhatsAppNumber(zap)}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "email",
      header: "E-mail",
      cell: (info) => {
        const email = info.getValue() as string;
        return email ? (
          <span className="text-slate-600">{email}</span>
        ) : (
          <span className="text-slate-300 text-xs">-</span>
        );
      },
    },
    {
      accessorKey: "collectionProfile",
      header: "Perfil",
      cell: (info) => {
        const profile = info.getValue() as ParsedDebtor["collectionProfile"];

        if (!profile) {
          return <span className="text-xs text-slate-300">-</span>;
        }

        return (
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
              PROFILE_COLORS[profile.profileType] ??
              "border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            {PROFILE_LABELS[profile.profileType] ?? profile.name}
          </span>
        );
      },
    },
    {
      accessorKey: "original_amount",
      header: () => <span className="block text-right">Valor</span>,
      cell: (info) => {
        const valor = info.getValue() as number;
        return (
          <span className="block text-right font-semibold text-slate-900 tabular-nums">
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            }).format(valor)}
          </span>
        );
      },
    },
    {
      accessorKey: "due_date",
      header: "Vencimento",
      cell: (info) => (
        <span className="text-slate-600 tabular-nums">
          {formatarDataBR(info.getValue() as string)}
        </span>
      ),
    },
    {
      accessorKey: "billing_type",
      header: "Pagamento",
      cell: (info) => {
        const billingType = info.getValue() as string | undefined;
        const payment = info.row.original.payment;
        const isGenerated = payment?.generated ?? false;

        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-slate-700 whitespace-nowrap">
              {getPaymentMethodLabel(payment?.method ?? billingType)}
            </span>
            <span
              className={`w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${
                isGenerated
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              {isGenerated ? "Gerado" : "Não gerado"}
            </span>
          </div>
        );
      },
    },
    {
      id: "status",
      header: () => <span className="block text-center">Status</span>,
      cell: (info) => {
        const status = checkStatus(info.row.original);
        const Icon = status.icon;
        return (
          <div className="flex justify-center">
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${status.color}`}
            >
              <Icon size={13} />
              {status.label}
            </div>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: () => <span className="block text-center">Ações</span>,
      cell: (info) => {
        const invoice = info.row.original;
        const invoiceId = getInvoiceId(invoice);
        const payment = invoice.payment;
        const pixCopyPaste =
          payment?.generated === true ? payment.pixCopyPaste : null;
        const boletoUrl =
          payment?.generated === true ? payment.boletoUrl : null;
        const boletoLine =
          payment?.generated === true ? payment.boletoLine : null;
        const isClosed =
          invoice.status === "PAID" || invoice.status === "CANCELED";
        const activeAction =
          runningInvoiceAction?.invoiceId === invoiceId
            ? runningInvoiceAction.action
            : null;
        const isBusy = activeAction !== null;

        return (
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => onGeneratePayment(invoice)}
              disabled={!invoiceId || isClosed || isBusy}
              className="inline-flex min-w-36 items-center justify-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
              title="Gerar cobrança no gateway"
            >
              {activeAction === "generate" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CreditCard size={14} />
              )}
              Gerar cobrança
            </button>
            <button
              type="button"
              onClick={() => onResendInvoice(invoice)}
              disabled={!invoiceId || isClosed || isBusy}
              className="inline-flex min-w-36 items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              title="Reenviar cobrança"
            >
              {activeAction === "resend" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCcw size={14} />
              )}
              Reenviar cobrança
            </button>
            <button
              type="button"
              onClick={() => onCheckPaymentStatus(invoice)}
              disabled={!invoiceId || isBusy}
              className="inline-flex min-w-36 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              title="Consultar status da fatura"
            >
              {activeAction === "status" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <SearchCheck size={14} />
              )}
              Consultar status
            </button>
            {pixCopyPaste && (
              <button
                type="button"
                onClick={() => {
                  void copyPaymentValue(invoice, pixCopyPaste, "pix");
                }}
                className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                title="Copiar Pix cópia e cola"
              >
                <Copy size={14} />
                {getCopiedLabel(invoice, "pix", "Pix")}
              </button>
            )}
            {boletoUrl && (
              <a
                href={boletoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                title="Abrir boleto"
              >
                <ExternalLink size={14} />
                Boleto
              </a>
            )}
            {!boletoUrl && boletoLine && (
              <button
                type="button"
                onClick={() => {
                  void copyPaymentValue(invoice, boletoLine, "boleto");
                }}
                className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                title="Copiar linha digitável"
              >
                <Copy size={14} />
                {getCopiedLabel(invoice, "boleto", "Linha")}
              </button>
            )}
            <button
              type="button"
              onClick={() => onAddInvoice(invoice)}
              disabled={!invoice.debtorId}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PlusCircle size={14} />
              Fatura
            </button>
            <button
              type="button"
              onClick={() => onViewPaymentHistory(invoice)}
              disabled={!invoice.debtorId}
              className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <History size={14} />
              Histórico
            </button>
            <button
              type="button"
              onClick={() => onConfigureDebtor(invoice)}
              disabled={!invoice.debtorId}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SlidersHorizontal size={14} />
              Editar
            </button>
          </div>
        );
      },
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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {selectedIds.length} cobrança{selectedIds.length === 1 ? "" : "s"}{" "}
            selecionada{selectedIds.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            O ciclo gera a cobrança Efí, aplica o template e envia pelo
            WhatsApp.
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
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 border-b border-slate-200">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-5 py-3.5 font-medium text-slate-500 text-xs uppercase tracking-wider whitespace-nowrap"
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
                className="hover:bg-slate-50/50 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-5 py-3.5 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-200 bg-slate-50/50">
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
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="p-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} className="text-slate-600" />
          </button>

          <span className="px-3 py-1.5 text-sm font-medium text-slate-700 tabular-nums">
            {pageIndex + 1} / {totalPages || 1}
          </span>

          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="p-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} className="text-slate-600" />
          </button>
        </div>
      </div>
    </div>
  );
}
