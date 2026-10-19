"use client";

import { Search } from "lucide-react";
import type {
  InvoiceListBillingType,
  InvoiceListSort,
  InvoiceListStatus,
} from "@/lib/api-client";

export interface InvoiceFilterValues {
  search: string;
  status: InvoiceListStatus | "";
  billingType: InvoiceListBillingType | "";
  sort: InvoiceListSort;
}

export const INVOICE_STATUS_OPTIONS: { value: InvoiceListStatus | ""; label: string }[] = [
  { value: "", label: "Todas as situações" },
  { value: "PENDING", label: "Em aberto" },
  { value: "OVERDUE", label: "Vencidas" },
  { value: "PAID", label: "Pagas" },
  { value: "CANCELED", label: "Canceladas" },
];

export const INVOICE_BILLING_OPTIONS: {
  value: InvoiceListBillingType | "";
  label: string;
}[] = [
  { value: "", label: "Todas as formas" },
  { value: "PIX", label: "Pix" },
  { value: "BOLETO", label: "Boleto" },
  { value: "CREDIT_CARD", label: "Cartão" },
];

export const INVOICE_SORT_OPTIONS: { value: InvoiceListSort; label: string }[] = [
  { value: "createdAt_desc", label: "Mais recentes" },
  { value: "dueDate_asc", label: "Vencimento mais próximo" },
  { value: "dueDate_desc", label: "Vencimento mais distante" },
  { value: "amount_desc", label: "Maior valor" },
  { value: "amount_asc", label: "Menor valor" },
];

const selectClass =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function InvoiceFilters({
  values,
  searchPlaceholder,
  onSearchChange,
  onChange,
}: {
  values: InvoiceFilterValues;
  searchPlaceholder: string;
  onSearchChange: (search: string) => void;
  onChange: (values: Partial<Omit<InvoiceFilterValues, "search">>) => void;
}) {
  return (
    <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_12rem_12rem_14rem]">
      <label className="relative block md:col-span-2 xl:col-span-1">
        <span className="sr-only">Buscar cobranças</span>
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          size={17}
          aria-hidden="true"
        />
        <input
          type="search"
          value={values.search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-10 w-full rounded-md border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      <label>
        <span className="sr-only">Filtrar por situação</span>
        <select
          value={values.status}
          onChange={(event) =>
            onChange({ status: event.target.value as InvoiceFilterValues["status"] })
          }
          className={selectClass}
        >
          {INVOICE_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="sr-only">Filtrar por forma de pagamento</span>
        <select
          value={values.billingType}
          onChange={(event) =>
            onChange({
              billingType: event.target.value as InvoiceFilterValues["billingType"],
            })
          }
          className={selectClass}
        >
          {INVOICE_BILLING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="md:col-span-2 xl:col-span-1">
        <span className="sr-only">Ordenar por</span>
        <select
          value={values.sort}
          onChange={(event) =>
            onChange({ sort: event.target.value as InvoiceListSort })
          }
          className={selectClass}
        >
          {INVOICE_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
