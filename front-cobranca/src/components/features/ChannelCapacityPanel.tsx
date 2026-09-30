"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { CentralChannelCapacity, ChannelCapacitySource } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const SOURCE_LABELS: Record<ChannelCapacitySource, string> = {
  PROVIDER: "Confirmado agora pelo Datafy",
  VERIFIED_CACHE: "Confirmado pelo Datafy",
  FALLBACK: "Proteção local conservadora (tier não confirmado)",
  UNAVAILABLE: "Controle indisponível",
};

function when(value: string | null): string {
  return value
    ? `${new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })} (Brasília)`
    : "—";
}

function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("pt-BR");
}

// Central channel operation, platform administrators only. Values the
// provider did not confirm are labeled as such; unknown is never unlimited.
export function ChannelCapacityPanel(): ReactNode {
  const api = useApiClient();
  const [capacity, setCapacity] = useState<CentralChannelCapacity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const load = useCallback(async () => {
    try {
      setCapacity(await api.getChannelCapacity());
      setError(null);
    } catch {
      setCapacity(null);
      setError("Não foi possível consultar a capacidade do canal.");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync(): Promise<void> {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.syncChannelTier();
      setCapacity(result.capacity);
      setError(null);
      setMessage(`Tier confirmado: ${result.tier}.`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Não foi possível confirmar o tier.");
      await load();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const unknown = !capacity || capacity.source === "UNAVAILABLE";
  const unlimited = capacity !== null && !unknown && capacity.limit === null;

  return (
    <section aria-label="Canal central" className="rounded-md border border-slate-200 bg-white p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Canal WhatsApp central</h2>
          <p className="mt-1 text-slate-500">
            Destinatários únicos alcançados fora da janela de atendimento nas últimas 24 horas (janela móvel),
            somando todas as empresas.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void sync()}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={15} />
          Confirmar tier no Datafy
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-rose-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-emerald-700">
          {message}
        </p>
      )}

      {unknown ? (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-amber-800">
          Estado do controle desconhecido. Os envios que consomem capacidade ficam pendentes até o controle voltar;
          nenhum envio é liberado sem ele.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-slate-400">Em uso</p>
            <p className="text-xl font-bold text-slate-900">{count(capacity.used)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Limite aplicado</p>
            <p className="text-xl font-bold text-slate-900">{unlimited ? "Sem limite" : count(capacity.limit)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Disponível</p>
            <p className="text-xl font-bold text-slate-900">{unlimited ? "—" : count(capacity.remaining)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Tier</p>
            <p className="text-xl font-bold text-slate-900">{capacity.tier ?? "Não confirmado"}</p>
          </div>
        </div>
      )}

      {capacity && (
        <p className="mt-3 text-xs text-slate-500">
          Origem: {SOURCE_LABELS[capacity.source]} · verificado em {when(capacity.checkedAt)} · escopo{" "}
          {capacity.scopeId}
          {capacity.nextAvailableAt ? ` · próxima vaga em ${when(capacity.nextAvailableAt)}` : ""}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        E-mail (Resend): capacidade e reputação da conta não são informadas pelo provedor e não são exibidas.
      </p>
    </section>
  );
}
