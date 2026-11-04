"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type {
  CheckoutBump,
  CheckoutBumpInput,
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

export const MAX_ACTIVE_BUMPS = 6;

interface BumpForm {
  offeredProductId: string;
  price: string;
  compareAt: string;
  headline: string;
  description: string;
  active: boolean;
}

function formOf(bump?: CheckoutBump): BumpForm {
  return {
    offeredProductId: bump?.offeredProductId ?? "",
    price: centsToInput(bump?.priceCents),
    compareAt: centsToInput(bump?.compareAtPriceCents),
    headline: bump?.headline ?? "",
    description: bump?.description ?? "",
    active: bump?.active ?? true,
  };
}

function toInput(form: BumpForm): CheckoutBumpInput {
  if (!form.offeredProductId) throw new Error("Escolha o produto oferecido.");
  const priceCents = parseAmountToCents(form.price);
  if (priceCents === null || priceCents < 500)
    throw new Error("Informe um preço de pelo menos R$ 5,00.");
  const compareAtPriceCents = form.compareAt.trim() ? parseAmountToCents(form.compareAt) : null;
  if (form.compareAt.trim() && (compareAtPriceCents === null || compareAtPriceCents <= priceCents))
    throw new Error('O preço "De" precisa ser maior que o preço promocional.');
  return {
    offeredProductId: form.offeredProductId,
    priceCents,
    compareAtPriceCents,
    headline: form.headline.trim() || null,
    description: form.description.trim() || null,
    active: form.active,
  };
}

function BumpEditor({
  bump,
  options,
  onCancel,
  onSave,
}: {
  bump?: CheckoutBump;
  options: CheckoutProduct[];
  onCancel: () => void;
  onSave: (input: CheckoutBumpInput) => Promise<void>;
}) {
  const [form, setForm] = useState<BumpForm>(() => formOf(bump));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<BumpForm>) => setForm((current) => ({ ...current, ...change }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave(toInput(form));
    } catch (caught) {
      setError(messageOf(caught, "Não foi possível salvar o order bump."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Produto oferecido">
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
        <Field label="Preço promocional (R$)">
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
          maxLength={80}
          value={form.headline}
          onChange={(event) => set({ headline: event.target.value })}
        />
      </Field>
      <Field label="Texto da oferta" hint="Opcional. Sem ele, a página usa a descrição do produto.">
        <textarea
          className={`${inputClass} h-20 py-2`}
          maxLength={300}
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(event) => set({ active: event.target.checked })}
        />
        Ativo na página de pagamento
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={saving}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          Salvar order bump
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Up to six active offers shown on the product's checkout, in this order. */
export function BumpsPanel({
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
  const bumps = product.bumps ?? [];
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const activeCount = bumps.filter((bump) => bump.active).length;
  const options = catalog.filter((item) => item.id !== product.id);

  async function run(action: () => Promise<CheckoutProduct>, done: string) {
    setNotice(null);
    try {
      onChanged(await action());
      setEditing(null);
      setNotice({ error: false, text: done });
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED") {
        onConflict();
        setEditing(null);
        setNotice({
          error: true,
          text: "Os order bumps foram alterados em outra tela. A lista foi recarregada.",
        });
        return;
      }
      throw caught;
    }
  }

  function move(index: number, offset: number) {
    const ids = bumps.map((bump) => bump.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void run(() => api.reorderCheckoutBumps(product.id, ids), "Ordem salva.").catch(
      (caught: unknown) => setNotice({ error: true, text: messageOf(caught, "Não foi possível reordenar.") }),
    );
  }

  function remove(bump: CheckoutBump) {
    void run(() => api.removeCheckoutBump(product.id, bump.id), "Order bump removido.").catch(
      (caught: unknown) => setNotice({ error: true, text: messageOf(caught, "Não foi possível remover.") }),
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Order bumps</h2>
          <p className="text-sm text-slate-500">
            Ofertas marcadas pelo comprador antes de pagar. {activeCount} de {MAX_ACTIVE_BUMPS} ativos.
          </p>
        </div>
        <button
          type="button"
          className={buttonClass}
          disabled={activeCount >= MAX_ACTIVE_BUMPS || editing !== null || options.length === 0}
          onClick={() => setEditing("new")}
        >
          <Plus size={16} /> Adicionar order bump
        </button>
      </header>
      {options.length === 0 && (
        <p className="text-sm text-slate-500">Cadastre outro produto para oferecê-lo como order bump.</p>
      )}
      {activeCount >= MAX_ACTIVE_BUMPS && (
        <p className="text-sm text-amber-700">Limite de {MAX_ACTIVE_BUMPS} order bumps ativos atingido.</p>
      )}
      <NoticeText notice={notice} />
      {editing === "new" && (
        <BumpEditor
          options={options}
          onCancel={() => setEditing(null)}
          onSave={(input) => run(() => api.createCheckoutBump(product.id, input), "Order bump criado.")}
        />
      )}
      {bumps.length === 0 && editing !== "new" ? (
        <p className="text-sm text-slate-500">Nenhum order bump neste produto.</p>
      ) : (
        <ul className="space-y-2">
          {bumps.map((bump, index) =>
            editing === bump.id ? (
              <li key={bump.id}>
                <BumpEditor
                  bump={bump}
                  options={options}
                  onCancel={() => setEditing(null)}
                  onSave={(input) =>
                    run(
                      () =>
                        api.updateCheckoutBump(product.id, bump.id, {
                          ...input,
                          expectedVersion: bump.version,
                        }),
                      "Order bump salvo.",
                    )
                  }
                />
              </li>
            ) : (
              <li
                key={bump.id}
                className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center"
              >
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {bump.headline || bump.offeredProduct.name}
                    {!bump.active && <span className="ml-2 text-xs font-normal text-slate-500">(inativo)</span>}
                  </p>
                  <p className="text-sm text-slate-500">
                    {bump.offeredProduct.name} ·{" "}
                    {bump.compareAtPriceCents && (
                      <span className="line-through">{formatCents(bump.compareAtPriceCents)}</span>
                    )}{" "}
                    {formatCents(bump.priceCents)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Subir"
                    className="rounded p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    disabled={index === 0 || editing !== null}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Descer"
                    className="rounded p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    disabled={index === bumps.length - 1 || editing !== null}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Editar ${bump.offeredProduct.name}`}
                    className="rounded p-2 text-slate-500 hover:bg-slate-100"
                    disabled={editing !== null}
                    onClick={() => setEditing(bump.id)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remover ${bump.offeredProduct.name}`}
                    className="rounded p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                    disabled={editing !== null}
                    onClick={() => remove(bump)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
