"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { API_URL, type CheckoutApiKey } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatDateTime } from "@/lib/disbursements";
import { buttonClass, Field, inputClass, loadFailed, messageOf, NoticeText, type Notice } from "./ui";

const MAX_KEYS = 5;

/** Read-only API keys for the seller's own system; each key is shown once. */
export function ApiKeysPanel() {
  const api = useApiClient();
  const [keys, setKeys] = useState<CheckoutApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .listCheckoutApiKeys(controller.signal)
      .then(setKeys)
      .catch((caught: unknown) => {
        if (loadFailed(controller.signal, caught)) setError(messageOf(caught, "Não foi possível carregar as chaves."));
      });
    return () => controller.abort();
  }, [api, reload]);

  async function run(action: () => Promise<Notice>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (caught) {
      setNotice({ error: true, text: messageOf(caught, "Não foi possível concluir.") });
    } finally {
      setBusy(false);
      setError(null);
      setReload((value) => value + 1);
    }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await api.createCheckoutApiKey(name.trim());
      setCreated(result.key);
      setName("");
      return { error: false, text: `Chave "${result.name}" criada.` };
    });
  }

  const active = keys?.filter((key) => !key.revokedAt).length ?? 0;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <KeyRound size={18} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">API de consulta</h2>
          <p className="text-sm text-slate-500">
            Para o seu sistema buscar pedidos e produtos, por exemplo quando perdeu um aviso do webhook. A API só consulta: não
            cria nem altera nada.
          </p>
        </div>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      ) : !keys ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Carregando…</p>
      ) : (
        <>
          <form onSubmit={create} className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1">
              <Field label="Nome da chave" hint={`Até ${MAX_KEYS} chaves ativas. Ex.: área de membros, ERP.`}>
                <input className={inputClass} required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
            </div>
            <button type="submit" className={buttonClass} disabled={busy || active >= MAX_KEYS}>Criar chave</button>
          </form>

          {created && (
            <div role="status" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p>Chave da API (mostrada só agora; guarde no seu sistema, ela não aparece de novo):</p>
              <p className="flex items-center gap-2">
                <code className="break-all rounded bg-white px-2 py-1 font-semibold">{created}</code>
                <button type="button" aria-label="Copiar chave" onClick={() => void navigator.clipboard?.writeText(created)}>
                  <Copy size={16} />
                </button>
              </p>
            </div>
          )}
          <NoticeText notice={notice} />

          {keys.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma chave criada ainda.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm" aria-label="Chaves da API">
              {keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-slate-600">
                  <span className="font-medium text-slate-800">{key.name}</span>
                  <code>{key.prefix}…</code>
                  <span>criada em {formatDateTime(key.createdAt)}</span>
                  <span>{key.lastUsedAt ? `último uso em ${formatDateTime(key.lastUsedAt)}` : "nunca usada"}</span>
                  {key.revokedAt ? (
                    <span className="ml-auto text-slate-500">Revogada em {formatDateTime(key.revokedAt)}</span>
                  ) : confirming === key.id ? (
                    <span className="ml-auto flex items-center gap-2">
                      O seu sistema deixa de consultar com ela na hora.
                      <button
                        type="button"
                        className="font-semibold text-red-600 hover:underline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api.revokeCheckoutApiKey(key.id);
                            setConfirming(null);
                            return { error: false, text: `Chave "${key.name}" revogada.` };
                          })
                        }
                      >
                        Confirmar revogação
                      </button>
                      <button type="button" className="font-semibold text-slate-600 hover:underline" onClick={() => setConfirming(null)}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="ml-auto font-semibold text-red-600 hover:underline"
                      disabled={busy}
                      onClick={() => setConfirming(key.id)}
                    >
                      Revogar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <details className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            <summary className="cursor-pointer font-semibold">Como o seu sistema usa a API</summary>
            <div className="mt-2 space-y-2">
              <p>
                Envie a chave no cabeçalho <code>Authorization: Bearer &lt;chave&gt;</code>. Endereço base:{" "}
                <code className="break-all">{API_URL}/checkout/api/v1</code>. Limite de 60 consultas por minuto por chave.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <code>GET /orders</code>: pedidos, do mais antigo alterado ao mais novo. Filtros: <code>status</code>,{" "}
                  <code>productId</code> (principal ou order bump), <code>updatedFrom</code>, <code>updatedTo</code>, <code>page</code> e{" "}
                  <code>pageSize</code> (até 100).
                </li>
                <li><code>GET /orders/&lt;id&gt;</code>: um pedido, com o mesmo corpo do aviso do webhook.</li>
                <li><code>GET /products</code> e <code>GET /products/&lt;id&gt;</code>: os seus produtos.</li>
              </ul>
              <p>Os pedidos trazem os dados do comprador: guarde a chave só no servidor, nunca no navegador ou no aplicativo.</p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
