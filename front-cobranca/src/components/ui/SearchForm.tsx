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
        className="min-w-0 flex-1 rounded-lg border p-2 text-sm"
        onChange={(event) => {
          setDraft(event.target.value);
          if (!event.target.value) onSearch("");
        }}
      />
      <button type="submit" className="rounded-lg border px-3 py-2 text-sm">
        Buscar
      </button>
    </form>
  );
}
