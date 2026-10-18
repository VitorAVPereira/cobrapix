"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const PAGE_SIZES = [20, 50, 100];
const pageButton =
  "rounded-md border border-slate-200 bg-white p-2 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40";

/** Footer of a server-paged table: range, page size and first/previous/next/last. */
export function TablePagination({
  page,
  pageSize,
  total,
  pageSizeLabel,
  onChange,
}: {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  /** Accessible name of the page size select, e.g. "Clientes por página". */
  pageSizeLabel: string;
  onChange: (next: { page: number; pageSize: number }) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const count = (value: number) => value.toLocaleString("pt-BR");
  const go = (target: number) => onChange({ page: target, pageSize });

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-4 py-3 sm:flex-row">
      <div className="flex items-center gap-3">
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700 tabular-nums">
            {count(rangeStart)}–{count(rangeEnd)}
          </span>{" "}
          de <span className="font-medium text-slate-700 tabular-nums">{count(total)}</span>
        </p>
        <label>
          <span className="sr-only">{pageSizeLabel}</span>
          <select
            value={pageSize}
            onChange={(event) => onChange({ page: 1, pageSize: Number(event.target.value) })}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} por página
              </option>
            ))}
          </select>
        </label>
      </div>

      <nav aria-label="Paginação" className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Primeira página"
          onClick={() => go(1)}
          disabled={page <= 1}
          className={pageButton}
        >
          <ChevronsLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Página anterior"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className={pageButton}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="px-3 py-1.5 text-sm font-medium text-slate-700 tabular-nums">
          Página {count(page)} de {count(totalPages)}
        </span>
        <button
          type="button"
          aria-label="Próxima página"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          className={pageButton}
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          aria-label="Última página"
          onClick={() => go(totalPages)}
          disabled={page >= totalPages}
          className={pageButton}
        >
          <ChevronsRight size={16} />
        </button>
      </nav>
    </div>
  );
}
