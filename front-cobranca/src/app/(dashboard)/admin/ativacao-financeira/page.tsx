"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useApiClient } from "@/lib/use-api-client";
import type { AdminClient } from "@/lib/api-client";

export default function AdminFinancialActivationIndexPage(): ReactNode {
  const api = useApiClient();
  const [clients, setClients] = useState<AdminClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getAdminClients()
      .then(setClients)
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível carregar os clientes.",
        ),
      );
  }, [api]);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5 sm:p-8">
      <h1 className="text-2xl font-bold text-slate-900">Ativação financeira</h1>
      <p className="text-sm text-slate-600">
        Escolha o cliente para cadastrar a conta Efí, validar a integração e
        ativar as emissões.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {!clients && !error && <p role="status">Carregando clientes…</p>}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {clients?.map((client) => (
          <li key={client.id} className="flex items-center justify-between p-4">
            <span>
              <span className="font-medium text-slate-900">
                {client.corporateName}
              </span>
              <span className="block text-xs text-slate-500">
                {client.document}
              </span>
            </span>
            <Link
              href={`/admin/ativacao-financeira/${client.id}`}
              className="text-sm font-semibold text-emerald-700 underline"
            >
              Abrir
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
