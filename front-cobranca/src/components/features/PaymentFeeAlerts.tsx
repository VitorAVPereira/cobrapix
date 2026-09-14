"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApiClient } from "@/lib/use-api-client";

interface AlertPage {
  items: Array<{
    id: string;
    companyId: string;
    invoiceId: string;
    createdAt: string;
    description: string;
  }>;
  total: number;
}

export function PaymentFeeAlerts(): ReactNode {
  const api = useApiClient();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AlertPage>({ items: [], total: 0 });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .financialAdmin<AlertPage>(`/admin/payment-fees/alerts?page=${page}`)
      .then((data) => {
        if (active) {
          setResult(data);
          setError(null);
        }
      })
      .catch(() => {
        if (active)
          setError("Não foi possível consultar as divergências de tarifa.");
      });
    return () => {
      active = false;
    };
  }, [api, page]);
  return (
    <section className="space-y-3 rounded-xl border bg-white p-5">
      <h2 className="font-semibold">Divergências de tarifa Efí</h2>
      <p className="text-sm text-slate-600">
        Confira no extrato da Efí as tarifas que divergiram da previsão da
        emissão.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {!error && result.total === 0 && (
        <p className="text-sm text-slate-500">
          Nenhuma divergência registrada.
        </p>
      )}
      <ol className="space-y-3">
        {result.items.map((item) => (
          <li key={item.id} className="rounded-lg bg-amber-50 p-3 text-sm">
            <p>{item.description}</p>
            <p className="mt-1 text-xs text-slate-600">
              Empresa {item.companyId} · Fatura {item.invoiceId} ·{" "}
              {new Date(item.createdAt).toLocaleString("pt-BR")}
            </p>
          </li>
        ))}
      </ol>
      {result.total > 50 && (
        <div className="flex items-center gap-4 text-sm">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            className="disabled:opacity-40"
          >
            Anterior
          </button>
          <span>Página {page}</span>
          <button
            disabled={page * 50 >= result.total}
            onClick={() => setPage(page + 1)}
            className="disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </section>
  );
}
