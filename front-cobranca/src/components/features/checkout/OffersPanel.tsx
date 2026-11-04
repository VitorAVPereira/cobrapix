"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Copy, Loader2, Pencil, Plus } from "lucide-react";
import type {
  CheckoutOffer,
  CheckoutOfferInput,
  CheckoutOfferKind,
  CheckoutProduct,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { errorCode, formatCents, parseAmountToCents } from "@/lib/disbursements";
import { centsToInput } from "@/lib/checkout";
import {
  buttonClass,
  Field,
  inputClass,
  messageOf,
  NoticeText,
  secondaryButtonClass,
  type Notice,
} from "./ui";

const KIND_LABELS: Record<CheckoutOfferKind, string> = {
  UPSELL: "Upsell",
  DOWNSELL: "Downsell",
};

interface OfferForm {
  offeredProductId: string;
  price: string;
  compareAt: string;
  headline: string;
  description: string;
  active: boolean;
}

function formOf(offer?: CheckoutOffer): OfferForm {
  return {
    offeredProductId: offer?.offeredProductId ?? "",
    price: centsToInput(offer?.priceCents),
    compareAt: centsToInput(offer?.compareAtPriceCents),
    headline: offer?.headline ?? "",
    description: offer?.description ?? "",
    active: offer?.active ?? true,
  };
}

function toInput(kind: CheckoutOfferKind, form: OfferForm): CheckoutOfferInput {
  if (!form.offeredProductId) throw new Error("Escolha o produto oferecido.");
  const priceCents = parseAmountToCents(form.price);
  if (priceCents === null || priceCents < 500) throw new Error("Informe um preço de pelo menos R$ 5,00.");
  const compareAtPriceCents = form.compareAt.trim() ? parseAmountToCents(form.compareAt) : null;
  if (form.compareAt.trim() && (compareAtPriceCents === null || compareAtPriceCents <= priceCents))
    throw new Error('O preço "De" precisa ser maior que o preço da oferta.');
  return {
    kind,
    offeredProductId: form.offeredProductId,
    priceCents,
    compareAtPriceCents,
    headline: form.headline.trim() || null,
    description: form.description.trim() || null,
    active: form.active,
  };
}

/** The one-click link the seller's own page builds with the cifra_oferta it receives. */
export function oneClickLink(offerId: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/c/oferta/{cifra_oferta}?oferta=${offerId}`;
}

function OfferEditor({
  kind,
  offer,
  options,
  onCancel,
  onSave,
}: {
  kind: CheckoutOfferKind;
  offer?: CheckoutOffer;
  options: CheckoutProduct[];
  onCancel: () => void;
  onSave: (input: CheckoutOfferInput) => Promise<void>;
}) {
  const [form, setForm] = useState<OfferForm>(() => formOf(offer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<OfferForm>) => setForm((current) => ({ ...current, ...change }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave(toInput(kind, form));
    } catch (caught) {
      setError(messageOf(caught, "Não foi possível salvar a oferta."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Produto do ${KIND_LABELS[kind].toLowerCase()}`}>
          <select
            className={inputClass}
            value={form.offeredProductId}
            onChange={(event) => set({ offeredProductId: event.target.value })}
            required
          >
            <option value="">Escolha…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Preço da oferta (R$)">
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.price}
            onChange={(event) => set({ price: event.target.value })}
            required
          />
        </Field>
        <Field label='Preço "De" (R$)'>
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.compareAt}
            onChange={(event) => set({ compareAt: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Título da oferta" hint="Opcional. Sem ele, a página usa o nome do produto.">
        <input
          className={inputClass}
          maxLength={120}
          value={form.headline}
          onChange={(event) => set({ headline: event.target.value })}
        />
      </Field>
      <Field label="Texto da oferta" hint="Opcional. Sem ele, a página usa a descrição do produto.">
        <textarea
          className={`${inputClass} h-20 py-2`}
          maxLength={1000}
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.active} onChange={(event) => set({ active: event.target.checked })} />
        Ativa
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={saving}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          Salvar {KIND_LABELS[kind].toLowerCase()}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * Upsell after the purchase and, for whoever declines it, a downsell. Each
 * accepted offer is a sale of its own, charged with one click.
 */
export function OffersPanel({
  product,
  catalog,
  onChanged,
  onConflict,
}: {
  product: CheckoutProduct;
  catalog: CheckoutProduct[];
  onChanged: (product: CheckoutProduct) => void;
  onConflict: () => void;
}) {
  const api = useApiClient();
  const offers = product.offers ?? [];
  const [editing, setEditing] = useState<CheckoutOfferKind | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const options = catalog.filter((item) => item.id !== product.id);
  const mode = product.afterPurchase ?? "ACCESS";

  async function save(kind: CheckoutOfferKind, input: CheckoutOfferInput, offer?: CheckoutOffer) {
    setNotice(null);
    try {
      onChanged(
        offer
          ? await api.updateCheckoutOffer(product.id, offer.id, { ...input, expectedVersion: offer.version })
          : await api.createCheckoutOffer(product.id, input),
      );
      setEditing(null);
      setNotice({ error: false, text: `${KIND_LABELS[kind]} salvo.` });
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED") {
        onConflict();
        setEditing(null);
        setNotice({ error: true, text: "As ofertas foram alteradas em outra tela. A lista foi recarregada." });
        return;
      }
      throw caught;
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ error: false, text: "Link copiado." });
    } catch {
      setNotice({ error: true, text: "Não foi possível copiar. Selecione o link e copie." });
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h2 className="text-base font-semibold text-slate-900">Ofertas depois da compra</h2>
        <p className="text-sm text-slate-500">
          Logo depois do pagamento, o comprador aceita com um clique, no mesmo cartão ou num Pix novo. Quem recusa o
          upsell vê o downsell.
        </p>
      </header>
      {mode === "ACCESS" && (
        <p className="text-sm text-amber-700">
          Para mostrar as ofertas, escolha em &quot;Depois da compra&quot; a oferta de 1 clique ou a sua página de
          oferta, e salve o produto.
        </p>
      )}
      {options.length === 0 && (
        <p className="text-sm text-slate-500">Cadastre outro produto para oferecê-lo depois da compra.</p>
      )}
      <NoticeText notice={notice} />
      <ul className="space-y-3">
        {(["UPSELL", "DOWNSELL"] as const).map((kind) => {
          const offer = offers.find((item) => item.kind === kind);
          const blocked = kind === "DOWNSELL" && !offers.some((item) => item.kind === "UPSELL");
          if (editing === kind)
            return (
              <li key={kind}>
                <OfferEditor
                  kind={kind}
                  offer={offer}
                  options={options}
                  onCancel={() => setEditing(null)}
                  onSave={(input) => save(kind, input, offer)}
                />
              </li>
            );
          return (
            <li key={kind} className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase text-slate-500">{KIND_LABELS[kind]}</p>
                  {offer ? (
                    <p className="text-sm text-slate-900">
                      <span className="font-semibold">{offer.headline || offer.offeredProduct.name}</span> ·{" "}
                      {offer.compareAtPriceCents && (
                        <span className="text-slate-500 line-through">{formatCents(offer.compareAtPriceCents)}</span>
                      )}{" "}
                      {formatCents(offer.priceCents)}
                      {!offer.active && <span className="ml-2 text-xs text-slate-500">(inativa)</span>}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {blocked ? "Crie o upsell primeiro." : "Nenhum."}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={editing !== null || blocked || options.length === 0}
                  onClick={() => setEditing(kind)}
                >
                  {offer ? <Pencil size={16} /> : <Plus size={16} />}
                  {offer ? "Editar" : `Adicionar ${KIND_LABELS[kind].toLowerCase()}`}
                </button>
              </div>
              {offer && mode === "EXTERNAL" && (
                <div className="flex flex-col gap-1 text-xs text-slate-600 sm:flex-row sm:items-center">
                  <span className="flex-1 break-all font-mono">{oneClickLink(offer.id)}</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
                    onClick={() => void copy(oneClickLink(offer.id))}
                  >
                    <Copy size={14} /> Copiar link de 1 clique
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {mode === "EXTERNAL" && (
        <p className="text-xs text-slate-500">
          Na sua página, troque {"{cifra_oferta}"} pelo valor do parâmetro cifra_oferta que chega no endereço. Sem
          ele, o link não vende.
        </p>
      )}
    </section>
  );
}
