"use client";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Numbered navigation for server-paged lists. `hasNext` comes from the server (next cursor
 * or offset), so a list that changed while polling never offers a page that is not there.
 */
export function ListPagination({
  page,
  pageSize,
  total,
  hasNext,
  onPrevious,
  onNext,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Item name in singular and plural, e.g. ["conversa", "conversas"]. */
  label: [string, string];
}): ReactNode {
  const pages = Math.max(1, Math.ceil(total / pageSize), page);
  return (
    <nav
      aria-label="Paginação"
      className="flex items-center justify-between gap-2 text-sm"
    >
      <button
        type="button"
        disabled={page <= 1}
        className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onPrevious}
        aria-label="Anterior"
        title="Anterior"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-xs text-slate-500">
        Página {page} de {pages} · {total} {total === 1 ? label[0] : label[1]}
      </span>
      <button
        type="button"
        disabled={!hasNext}
        className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onNext}
        aria-label="Próxima"
        title="Próxima"
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
