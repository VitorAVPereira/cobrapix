"use client";
import type { ReactNode } from "react";

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
      className="flex flex-wrap items-center justify-between gap-2 text-sm"
    >
      <button
        type="button"
        disabled={page <= 1}
        className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
        onClick={onPrevious}
      >
        Anterior
      </button>
      <span className="text-slate-600">
        Página {page} de {pages} · {total} {total === 1 ? label[0] : label[1]}
      </span>
      <button
        type="button"
        disabled={!hasNext}
        className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
        onClick={onNext}
      >
        Próxima
      </button>
    </nav>
  );
}
