"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, UserPlus, UserRound } from "lucide-react";
import type { DebtorOption } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatWhatsAppNumber } from "@/lib/whatsapp-number";
import { formatDebtorDocument as formatDocument } from "@/lib/debtor-document";

/**
 * Chooses a client already registered in Clientes. The search runs on the
 * server, so it works the same with ten or ten thousand clients.
 */
export function ClientPicker({
  value,
  onChange,
}: {
  value: DebtorOption | null;
  onChange: (client: DebtorOption | null) => void;
}) {
  const apiClient = useApiClient();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<DebtorOption[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (value) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiClient
        .searchDebtors(search.trim(), controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setState("ready");
        })
        .catch(() => {
          if (!controller.signal.aborted) setState("error");
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiClient, search, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{value.name}</p>
          <p className="truncate text-xs text-slate-600">
            {formatDocument(value.document)} · {formatWhatsAppNumber(value.phone_number)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setState("loading");
            onChange(null);
          }}
          className="shrink-0 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          Trocar cliente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">Buscar cliente</span>
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          size={17}
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          autoFocus
          onChange={(event) => {
            setSearch(event.target.value);
            setState("loading");
          }}
          placeholder="Nome, CPF/CNPJ, WhatsApp ou e-mail"
          className="h-11 w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      <div
        role="listbox"
        aria-label="Clientes encontrados"
        className="max-h-56 overflow-y-auto rounded-md border border-slate-200"
      >
        {state === "loading" ? (
          <p className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Buscando clientes
          </p>
        ) : state === "error" ? (
          <p role="alert" className="px-3 py-4 text-sm text-rose-700">
            Não foi possível buscar os clientes.
          </p>
        ) : results.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">
            {search.trim() ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado."}
          </p>
        ) : (
          results.map((client) => (
            <button
              key={client.debtorId}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onChange(client)}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50"
            >
              <UserRound size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {client.name}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {formatDocument(client.document)} ·{" "}
                  {formatWhatsAppNumber(client.phone_number)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      <Link
        href="/clientes?novo=1"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
      >
        <UserPlus size={16} aria-hidden="true" />
        Cadastrar novo cliente
      </Link>
    </div>
  );
}
