"use client";
import { useState } from "react";
import type { ReactNode } from "react";

/**
 * Search applied on submit, not on every keystroke: polled lists would otherwise query
 * the API for each letter. Clearing the field removes the filter right away.
 */
export function SearchForm({
  label,
  placeholder,
  onSearch,
}: {
  label: string;
  placeholder: string;
  onSearch: (term: string) => void;
}): ReactNode {
  const [draft, setDraft] = useState("");
  return (
    <form
      role="search"
      className="flex min-w-0 flex-1 gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        maxLength={100}
        value={draft}
        className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        onChange={(event) => {
          setDraft(event.target.value);
          if (!event.target.value) onSearch("");
        }}
      />
      {/* Named after the field: a page may have more than one search. */}
      <button
        type="submit"
        aria-label={label}
        className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
      >
        Buscar
      </button>
    </form>
  );
}
