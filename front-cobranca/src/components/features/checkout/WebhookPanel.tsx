"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, Copy, Loader2, Plus, Webhook } from "lucide-react";
import type {
  CheckoutProduct,
  CheckoutWebhookDelivery,
  CheckoutWebhookRule,
  CheckoutWebhookRuleInput,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { errorCode, formatDateTime } from "@/lib/disbursements";
import { buttonClass, Field, inputClass, messageOf, NoticeText, secondaryButtonClass, type Notice, loadFailed } from "./ui";

/** Events a rule can choose, in the order the seller reads them. */
const EVENT_LABELS: Record<string, string> = {
  "order.created": "Pix gerado",
  "order.paid": "Pago",
  "order.pix_expired": "Pix expirado",
  "order.card_declined": "Cartão recusado",
  "order.refunded": "Reembolsado",
  "order.chargeback": "Contestado",
  "refund.requested": "Reembolso pedido",
  "refund.withdrawn": "Reembolso desistido",
  "lead.abandoned": "Carrinho abandonado",
};
const HISTORY_LABELS: Record<string, string> = { ...EVENT_LABELS, "webhook.test": "Teste" };
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
const MAX_RULES = 10;

function result(delivery: CheckoutWebhookDelivery): string {
  if (delivery.lastStatusCode) return `HTTP ${delivery.lastStatusCode}`;
  return delivery.lastError ? (ERROR_LABELS[delivery.lastError] ?? delivery.lastError) : "—";
}

type Run = (action: () => Promise<Notice>) => Promise<void>;

/** The seller systems notified of order events: one rule per system, each with its own secret and history. */
export function WebhookPanel() {
  const api = useApiClient();
  const [rules, setRules] = useState<CheckoutWebhookRule[] | null>(null);
  const [products, setProducts] = useState<CheckoutProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<CheckoutWebhookRule | "new" | null>(null);
  const [secret, setSecret] = useState<{ ruleId: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api.listCheckoutWebhookRules(controller.signal), api.listCheckoutProducts(undefined, controller.signal)])
      .then(([loaded, catalog]) => {
        setRules(loaded);
        setProducts(catalog);
      })
      .catch((caught: unknown) => {
        if (loadFailed(controller.signal, caught)) setError(messageOf(caught, "Não foi possível carregar os webhooks."));
      });
    return () => controller.abort();
  }, [api, reload]);

  const refresh = () => {
    setError(null);
    setReload((value) => value + 1);
  };

  const run: Run = async (action) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
      refresh();
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED") {
        setEditing(null);
        setNotice({ error: true, text: "A regra foi alterada em outra tela. Os dados foram recarregados." });
        refresh();
      } else setNotice({ error: true, text: messageOf(caught, "Não foi possível concluir.") });
    } finally {
      setBusy(false);
    }
  };

  function save(input: CheckoutWebhookRuleInput) {
    const current = editing;
    void run(async () => {
      if (current === "new") {
        const created = await api.createCheckoutWebhookRule(input);
        setSecret({ ruleId: created.id, value: created.secret });
      } else if (current) {
        await api.updateCheckoutWebhookRule(current.id, { ...input, version: current.version });
      }
      setEditing(null);
      return { error: false, text: "Regra salva." };
    });
  }

  const productName = (id: string) => products.find((product) => product.id === id)?.name ?? "Produto removido";

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <Webhook size={18} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Webhooks</h2>
          <p className="text-sm text-slate-500">
            Avisamos os seus sistemas a cada evento das vendas, para liberar ou tirar o acesso sozinho. Cada regra tem a
            própria URL, os eventos e os produtos que quer receber, o próprio segredo e o próprio histórico.
          </p>
        </div>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      ) : !rules ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Carregando…</p>
      ) : (
        <>
          {rules.length === 0 && editing !== "new" && <p className="text-sm text-slate-500">Nenhuma regra de webhook ainda.</p>}
          <ul className="space-y-3">
            {rules.map((rule) =>
              editing !== "new" && editing?.id === rule.id ? (
                <li key={rule.id}>
                  <RuleForm rule={rule} products={products} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={rule.id}>
                  <RuleCard
                    rule={rule}
                    busy={busy}
                    run={run}
                    secret={secret?.ruleId === rule.id ? secret.value : null}
                    onSecret={(value) => setSecret({ ruleId: rule.id, value })}
                    onEdit={() => setEditing(rule)}
                    productName={productName}
                    reloadKey={reload}
                  />
                </li>
              ),
            )}
          </ul>
          {editing === "new" ? (
            <RuleForm products={products} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy || rules.length >= MAX_RULES}
              onClick={() => {
                setNotice(null);
                setEditing("new");
              }}
            >
              <Plus size={16} /> Nova regra
            </button>
          )}
          {rules.length >= MAX_RULES && <p className="text-xs text-slate-500">Você chegou ao limite de {MAX_RULES} regras.</p>}
          <NoticeText notice={notice} />

          <details className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            <summary className="cursor-pointer font-semibold">Como o seu sistema confere cada aviso</summary>
            <p className="mt-2">
              Cada aviso é um POST em JSON com o cabeçalho <code>X-Cifra-Signature: t=&lt;horário&gt;,v1=&lt;assinatura&gt;</code>. Calcule o
              HMAC-SHA256 do segredo da regra sobre <code>&lt;horário&gt;.&lt;corpo recebido&gt;</code> e compare com <code>v1</code>; recuse
              avisos com mais de 5 minutos. O cabeçalho <code>X-Cifra-Event-Id</code> é o mesmo nas repetições e em todas as regras que
              recebem o evento: use-o para não processar duas vezes. Responda com 2xx; outra resposta é repetida por até 24 horas. Uma
              regra com produtos recebe o pedido quando um deles foi vendido, como produto principal ou como order bump.
            </p>
          </details>
        </>
      )}
    </section>
  );
}

function RuleCard({
  rule,
  busy,
  run,
  secret,
  onSecret,
  onEdit,
  productName,
  reloadKey,
}: {
  rule: CheckoutWebhookRule;
  busy: boolean;
  run: Run;
  secret: string | null;
  onSecret: (value: string) => void;
  onEdit: () => void;
  productName: (id: string) => string;
  reloadKey: number;
}) {
  const api = useApiClient();
  const [history, setHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900">{rule.name}</h3>
          <p className="break-all text-sm text-slate-600">{rule.url}</p>
          <p className="mt-1 text-xs text-slate-500">
            Eventos: {rule.events.length ? rule.events.map((event) => EVENT_LABELS[event] ?? event).join(", ") : "todos"} · Produtos:{" "}
            {rule.productIds.length ? rule.productIds.map(productName).join(", ") : "todos"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onEdit}>Editar</button>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const sent = await api.testCheckoutWebhookRule(rule.id);
                return sent.status === "DELIVERED"
                  ? { error: false, text: `Teste de "${rule.name}" entregue (${result(sent)}).` }
                  : { error: true, text: `O teste de "${rule.name}" não foi aceito (${result(sent)}).` };
              })
            }
          >
            Enviar teste
          </button>
        </div>
      </div>

      {rule.disabledAt && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={16} />
          Desligada em {formatDateTime(rule.disabledAt)}: o endereço ficou 3 dias sem responder com sucesso.
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy}
            onClick={() => void run(async () => { await api.enableCheckoutWebhookRule(rule.id); return { error: false, text: `"${rule.name}" religada.` }; })}
          >
            Religar
          </button>
        </div>
      )}
      {!rule.disabledAt && rule.failingSince && (
        <p className="text-sm text-amber-700">Falhando desde {formatDateTime(rule.failingSince)}. Depois de 3 dias, a regra é desligada.</p>
      )}

      {secret && (
        <div role="status" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Segredo desta regra para conferir a assinatura (mostrado só agora; guarde no seu sistema):</p>
          <p className="flex items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 font-semibold">{secret}</code>
            <button type="button" aria-label="Copiar segredo" onClick={() => void navigator.clipboard?.writeText(secret)}>
              <Copy size={16} />
            </button>
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        <button type="button" className="font-semibold text-emerald-700 hover:underline" onClick={() => setHistory((open) => !open)}>
          {history ? "Esconder histórico" : "Ver histórico"}
        </button>
        {!secret && (
          <button
            type="button"
            className="font-semibold text-slate-600 hover:underline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const created = await api.rotateCheckoutWebhookSecret(rule.id);
                onSecret(created.secret);
                return { error: false, text: "Novo segredo gerado. O anterior deixou de valer." };
              })
            }
          >
            Gerar novo segredo
          </button>
        )}
        {confirming ? (
          <span className="flex flex-wrap items-center gap-2 text-slate-700">
            Excluir a regra? Os avisos na fila dela não serão enviados.
            <button
              type="button"
              className="font-semibold text-red-600 hover:underline"
              disabled={busy}
              onClick={() => void run(async () => { await api.deleteCheckoutWebhookRule(rule.id); return { error: false, text: `"${rule.name}" excluída.` }; })}
            >
              Confirmar exclusão
            </button>
            <button type="button" className="font-semibold text-slate-600 hover:underline" onClick={() => setConfirming(false)}>Cancelar</button>
          </span>
        ) : (
          <button type="button" className="font-semibold text-red-600 hover:underline" disabled={busy} onClick={() => setConfirming(true)}>
            Excluir
          </button>
        )}
      </div>

      {history && <RuleHistory rule={rule} busy={busy} run={run} reloadKey={reloadKey} />}
    </div>
  );
}

/** Reloads with the panel after each action (test, resend, religar). */
function RuleHistory({ rule, busy, run, reloadKey }: { rule: CheckoutWebhookRule; busy: boolean; run: Run; reloadKey: number }) {
  const api = useApiClient();
  const [deliveries, setDeliveries] = useState<CheckoutWebhookDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .listCheckoutWebhookDeliveries(rule.id, { page: 1, pageSize: 20 }, controller.signal)
      .then((page) => setDeliveries(page.items))
      .catch((caught: unknown) => {
        if (loadFailed(controller.signal, caught)) setError(messageOf(caught, "Não foi possível carregar o histórico."));
      });
    return () => controller.abort();
  }, [api, rule.id, reloadKey]);

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!deliveries) return <p className="text-sm text-slate-500">Carregando histórico…</p>;
  if (!deliveries.length) return <p className="text-sm text-slate-500">Nenhum aviso enviado ainda.</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm" aria-label={`Histórico de ${rule.name}`}>
      {deliveries.map((delivery) => (
        <li key={delivery.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-slate-600">
          <span>{formatDateTime(delivery.createdAt)}</span>
          <span className="font-medium text-slate-800">{HISTORY_LABELS[delivery.eventType] ?? delivery.eventType}</span>
          <span>{STATUS_LABELS[delivery.status]}</span>
          <span>{result(delivery)}</span>
          <span>{delivery.attempts} tentativa(s)</span>
          {delivery.status !== "PENDING" && delivery.status !== "DELIVERED" && !rule.disabledAt && (
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
  );
}

function RuleForm({
  rule,
  products,
  busy,
  onSave,
  onCancel,
}: {
  rule?: CheckoutWebhookRule;
  products: CheckoutProduct[];
  busy: boolean;
  onSave: (input: CheckoutWebhookRuleInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [url, setUrl] = useState(rule?.url ?? "");
  const [events, setEvents] = useState<string[]>(rule?.events ?? []);
  const [productIds, setProductIds] = useState<string[]>(rule?.productIds ?? []);
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ name: name.trim(), url: url.trim(), events, productIds });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-4" aria-label={rule ? `Editar ${rule.name}` : "Nova regra"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome da regra">
          <input className={inputClass} required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="URL do seu sistema" hint="Só https, com nome de domínio.">
          <input className={inputClass} required placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Eventos</legend>
        <p className="text-xs text-slate-500">Nenhum marcado: recebe todos.</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {Object.entries(EVENT_LABELS).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={events.includes(value)} onChange={() => setEvents((list) => toggle(list, value))} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Produtos</legend>
        <p className="text-xs text-slate-500">Nenhum marcado: todos. Conta o produto vendido como principal ou como order bump.</p>
        {products.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhum produto cadastrado.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {products.map((product) => (
              <label key={product.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={productIds.includes(product.id)}
                  onChange={() => setProductIds((list) => toggle(list, product.id))}
                />
                {product.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={busy}>Salvar regra</button>
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
