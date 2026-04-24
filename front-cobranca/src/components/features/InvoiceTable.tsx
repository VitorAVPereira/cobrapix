"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
} from "@tanstack/react-table";
import type { ParsedDebtor } from "./UploadCSV";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  AlertCircle,
  Clock,
  CheckCircle2,
  Ban,
} from "lucide-react";

interface InvoiceTableProps {
  data: ParsedDebtor[];
}

export function InvoiceTable({ data }: InvoiceTableProps) {
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

  const formatarDataBR = (dataString: string) => {
    if (!dataString) return "";
    if (dataString.includes("/")) return dataString;
    if (dataString.includes("-")) {
      const [ano, mes, dia] = dataString.split("-");
      return `${dia}/${mes}/${ano}`;
    }
    return dataString;
  };

  const columns: ColumnDef<ParsedDebtor>[] = [
    {
      accessorKey: "name",
      header: "Cliente / Devedor",
      cell: (info) => (
        <span className="font-medium text-slate-900">
          {info.getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "phone_number",
      header: "WhatsApp",
      cell: (info) => {
        const zap = info.getValue() as string;
        const mascara = zap.replace(
          /^(\d{2})(\d{5})(\d{4}).*/,
          "($1) $2-$3"
        );
        return (
          <div className="flex items-center gap-2 text-slate-600">
            <MessageCircle size={15} className="text-emerald-500 shrink-0" />
            <span>{mascara}</span>
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
        const label =
          billingType === "BOTH"
            ? "PIX e Boleto"
            : billingType === "BOLETO"
              ? "Boleto"
              : "PIX";

        return (
          <span className="text-slate-600 whitespace-nowrap">{label}</span>
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
  ];

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    state: { pagination },
  });

  const { pageIndex, pageSize } = pagination;
  const totalRows = data.length;
  const rangeStart = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min((pageIndex + 1) * pageSize, totalRows);
  const totalPages = table.getPageCount();

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
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
                      header.getContext()
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
                  <td
                    key={cell.id}
                    className="px-5 py-3.5 whitespace-nowrap"
                  >
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext()
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-200 bg-slate-50/50">
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">
            {rangeStart}-{rangeEnd}
          </span>{" "}
          de{" "}
          <span className="font-medium text-slate-700">{totalRows}</span>{" "}
          registros
        </p>

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
