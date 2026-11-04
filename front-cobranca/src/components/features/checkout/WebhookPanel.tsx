"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, Copy, Loader2, Webhook } from "lucide-react";
import type { CheckoutWebhookDelivery, CheckoutWebhookView } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { errorCode, formatDateTime } from "@/lib/disbursements";
import { buttonClass, Field, inputClass, messageOf, NoticeText, secondaryButtonClass, type Notice, loadFailed } from "./ui";

const EVENT_LABELS: Record<string, string> = {
  "order.created": "Pix gerado",
  "order.paid": "Pago",
  "order.pix_expired": "Pix expirado",
  "order.refunded": "Reembolsado",
  "order.chargeback": "Contestado",
  "refund.requested": "Reembolso pedido",
  "webhook.test": "Teste",
};
const STATUS_LABELS: Record<CheckoutWebhookDelivery["status"], string> = {
  PENDING: "Na fila",
  DELIVERED: "Entregue",
  FAILED: "Falhou",
  SKIPPED: "Pulado",
};
const ERROR_LABELS: Record<string, string> = {
  URL_INVALID: "URL inválida",
  URL_NOT_PUBLIC: "endereço não público",
  DNS_FAILED: "domínio não encontrado",
  TIMEOUT: "sem resposta em 10 s",
  NETWORK: "falha de conexão",
};

function result(delivery: CheckoutWebhookDelivery): string {
  if (delivery.lastStatusCode) return `HTTP ${delivery.lastStatusCode}`;
  return delivery.lastError ? (ERROR_LABELS[delivery.lastError] ?? delivery.lastError) : "—";
}

/** The seller system notified of each order event, with the history of notices. */
export function WebhookPanel() {
  const api = useApiClient();
  const [view, setView] = useState<CheckoutWebhookView | null>(null);
  const [deliveries, setDeliveries] = useState<CheckoutWebhookDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.getCheckoutWebhook(controller.signal),
      api.listCheckoutWebhookDeliveries({ page: 1, pageSize: 20 }, controller.signal),
    ])
      .then(([loaded, history]) => {
        setView(loaded);
        setUrl(loaded.url ?? "");
        setDeliveries(history.items);
      })
      .catch((caught: unknown) => {
        if (loadFailed(controller.signal, caught)) setError(messageOf(caught, "Não foi possível carregar o webhook."));
      });
    return () => controller.abort();
  }, [api, reload]);

  const refresh = () => {
    setError(null);
    setReload((value) => value + 1);
  };

  async function run(action: () => Promise<Notice>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
      refresh();
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED") {
        setNotice({ error: true, text: "As configurações foram alteradas em outra tela. Os dados foram recarregados." });
        refresh();
      } else setNotice({ error: true, text: messageOf(caught, "Não foi possível concluir.") });
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!view) return;
    void run(async () => {
      const saved = await api.setCheckoutWebhookUrl({ url: url.trim() || null });
      if (saved.secret) setSecret(saved.secret);
      return { error: false, text: url.trim() ? "URL do webhook salva." : "Webhook desligado." };
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <Webhook size={18} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Webhook</h2>
          <p className="text-sm text-slate-500">
            Avisamos o seu sistema a cada evento das vendas (Pix gerado, pago, expirado, reembolso pedido, reembolsado e
            contestado), para liberar ou tirar o acesso sozinho.
          </p>
        </div>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      ) : !view ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Carregando…</p>
      ) : (
        <>
          {view.disabledAt && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle size={16} />
              Desligado em {formatDateTime(view.disabledAt)}: o seu endereço ficou 3 dias sem responder com sucesso.
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={busy}
                onClick={() => void run(async () => { await api.enableCheckoutWebhook(); return { error: false, text: "Webhook religado." }; })}
              >
                Religar
              </button>
            </div>
          )}
          {!view.disabledAt && view.failingSince && (
            <p className="text-sm text-amber-700">Falhando desde {formatDateTime(view.failingSince)}. Depois de 3 dias, o webhook é desligado.</p>
          )}

          <form onSubmit={save} className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1">
              <Field label="URL do seu sistema" hint="Só https. Deixe em branco para desligar.">
                <input className={inputClass} placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
              </Field>
            </div>
            <button type="submit" className={buttonClass} disabled={busy}>Salvar URL</button>
            {view.url && (
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const sent = await api.testCheckoutWebhook();
                    return sent.status === "DELIVERED"
                      ? { error: false, text: `Teste entregue (${result(sent)}).` }
                      : { error: true, text: `O teste não foi aceito (${result(sent)}).` };
                  })
                }
              >
                Enviar teste
              </button>
            )}
          </form>

          {secret && (
            <div role="status" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p>Segredo para conferir a assinatura (mostrado só agora; guarde no seu sistema):</p>
              <p className="flex items-center gap-2">
                <code className="break-all rounded bg-white px-2 py-1 font-semibold">{secret}</code>
                <button type="button" aria-label="Copiar segredo" onClick={() => void navigator.clipboard?.writeText(secret)}>
                  <Copy size={16} />
                </button>
              </p>
            </div>
          )}
          {view.hasSecret && !secret && (
            <button
              type="button"
              className="text-sm font-semibold text-slate-600 hover:underline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const created = await api.rotateCheckoutWebhookSecret();
                  setSecret(created.secret);
                  return { error: false, text: "Novo segredo gerado. O anterior deixou de valer." };
                })
              }
            >
              Gerar novo segredo
            </button>
          )}
          <NoticeText notice={notice} />

          <details className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            <summary className="cursor-pointer font-semibold">Como o seu sistema confere cada aviso</summary>
            <p className="mt-2">
              Cada aviso é um POST em JSON com o cabeçalho <code>X-Cifra-Signature: t=&lt;horário&gt;,v1=&lt;assinatura&gt;</code>. Calcule o
              HMAC-SHA256 do segredo sobre <code>&lt;horário&gt;.&lt;corpo recebido&gt;</code> e compare com <code>v1</code>; recuse avisos com
              mais de 5 minutos. O cabeçalho <code>X-Cifra-Event-Id</code> é o mesmo nas repetições: use-o para não processar duas
              vezes. Responda com 2xx; outra resposta é repetida por até 24 horas.
            </p>
          </details>

          <div>
            <h3 className="text-sm font-semibold text-slate-800">Últimos avisos</h3>
            {deliveries && deliveries.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nenhum aviso enviado ainda.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {deliveries?.map((delivery) => (
                  <li key={delivery.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-slate-600">
                    <span>{formatDateTime(delivery.createdAt)}</span>
                    <span className="font-medium text-slate-800">{EVENT_LABELS[delivery.eventType] ?? delivery.eventType}</span>
                    <span>{STATUS_LABELS[delivery.status]}</span>
                    <span>{result(delivery)}</span>
                    <span>{delivery.attempts} tentativa(s)</span>
                    {delivery.status !== "PENDING" && delivery.status !== "DELIVERED" && !view.disabledAt && (
                      <button
                        type="button"
                        className="ml-auto font-semibold text-emerald-700 hover:underline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api.resendCheckoutWebhook(delivery.id);
                            return { error: false, text: "Aviso colocado na fila de novo." };
                          })
                        }
                      >
                        Reenviar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
