"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, Loader2, Plus, TicketPercent } from "lucide-react";
import type {
  CheckoutCoupon,
  CheckoutCouponInput,
  CheckoutCouponType,
  CheckoutProduct,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { errorCode, formatCents, parseAmountToCents } from "@/lib/disbursements";
import { formatPercentageBps } from "@/lib/billing-fees";
import { centsToInput, parsePercentToBps } from "@/lib/checkout";
import {
  buttonClass,
  Field,
  inputClass,
  messageOf,
  NoticeText,
  secondaryButtonClass,
  type Notice,
} from "@/components/features/checkout/ui";

interface CouponForm {
  code: string;
  type: CheckoutCouponType;
  value: string;
  appliesToAllProducts: boolean;
  productIds: string[];
  startsAt: string;
  expiresAt: string;
  maxUses: string;
  active: boolean;
}

/** Dates are whole days in São Paulo: from 00:00 of the start to 23:59 of the end. */
function dayStart(date: string): string | null {
  return date ? new Date(`${date}T00:00:00-03:00`).toISOString() : null;
}
function dayEnd(date: string): string | null {
  return date ? new Date(`${date}T23:59:59-03:00`).toISOString() : null;
}
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

function formOf(coupon?: CheckoutCoupon): CouponForm {
  return {
    code: coupon?.code ?? "",
    type: coupon?.type ?? "PERCENT",
    value: coupon
      ? coupon.type === "PERCENT"
        ? String(coupon.value / 100).replace(".", ",")
        : centsToInput(coupon.value)
      : "",
    appliesToAllProducts: coupon?.appliesToAllProducts ?? true,
    productIds: coupon?.products.map((item) => item.productId) ?? [],
    startsAt: toDateInput(coupon?.startsAt ?? null),
    expiresAt: toDateInput(coupon?.expiresAt ?? null),
    maxUses: coupon?.maxUses ? String(coupon.maxUses) : "",
    active: coupon?.active ?? true,
  };
}

function toInput(form: CouponForm): CheckoutCouponInput {
  const value =
    form.type === "PERCENT" ? parsePercentToBps(form.value) : parseAmountToCents(form.value);
  if (!value)
    throw new Error(
      form.type === "PERCENT"
        ? "Informe a porcentagem de desconto, de 0,01 a 100."
        : "Informe o valor do desconto em reais.",
    );
  if (!form.appliesToAllProducts && form.productIds.length === 0)
    throw new Error("Escolha os produtos em que o cupom vale.");
  const maxUses = form.maxUses.trim() ? Number(form.maxUses) : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1))
    throw new Error("O limite de usos precisa ser um número inteiro a partir de 1.");
  return {
    code: form.code.trim(),
    type: form.type,
    value,
    appliesToAllProducts: form.appliesToAllProducts,
    productIds: form.appliesToAllProducts ? [] : form.productIds,
    startsAt: dayStart(form.startsAt),
    expiresAt: dayEnd(form.expiresAt),
    maxUses,
    active: form.active,
  };
}

function CouponEditor({
  coupon,
  products,
  onCancel,
  onSave,
}: {
  coupon?: CheckoutCoupon;
  products: CheckoutProduct[];
  onCancel: () => void;
  onSave: (input: CheckoutCouponInput) => Promise<void>;
}) {
  const [form, setForm] = useState<CouponForm>(() => formOf(coupon));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<CouponForm>) => setForm((current) => ({ ...current, ...change }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave(toInput(form));
    } catch (caught) {
      setError(messageOf(caught, "Não foi possível salvar o cupom."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Código" hint="Letras, números, - e _. Fica em maiúsculas.">
          <input
            className={inputClass}
            value={form.code}
            onChange={(event) => set({ code: event.target.value })}
            required
          />
        </Field>
        <Field label="Tipo de desconto">
          <select
            className={inputClass}
            value={form.type}
            onChange={(event) => set({ type: event.target.value as CheckoutCouponType, value: "" })}
          >
            <option value="PERCENT">Porcentagem</option>
            <option value="FIXED">Valor fixo</option>
          </select>
        </Field>
        <Field label={form.type === "PERCENT" ? "Desconto (%)" : "Desconto (R$)"}>
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.value}
            onChange={(event) => set({ value: event.target.value })}
            required
          />
        </Field>
        <Field label="Válido a partir de" hint="Opcional.">
          <input
            type="date"
            className={inputClass}
            value={form.startsAt}
            onChange={(event) => set({ startsAt: event.target.value })}
          />
        </Field>
        <Field label="Válido até" hint="Opcional. Inclui o dia todo.">
          <input
            type="date"
            className={inputClass}
            value={form.expiresAt}
            onChange={(event) => set({ expiresAt: event.target.value })}
          />
        </Field>
        <Field label="Limite de usos" hint="Opcional. Conta só pedidos pagos.">
          <input
            className={inputClass}
            inputMode="numeric"
            value={form.maxUses}
            onChange={(event) => set({ maxUses: event.target.value })}
          />
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        O desconto vale no produto principal, não nos order bumps, e o preço nunca fica abaixo de R$ 5,00.
      </p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.appliesToAllProducts}
          onChange={(event) => set({ appliesToAllProducts: event.target.checked })}
        />
        Vale para todos os produtos
      </label>
      {!form.appliesToAllProducts && (
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Produtos</legend>
          {products.map((product) => (
            <label key={product.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.productIds.includes(product.id)}
                onChange={(event) =>
                  set({
                    productIds: event.target.checked
                      ? [...form.productIds, product.id]
                      : form.productIds.filter((id) => id !== product.id),
                  })
                }
              />
              {product.name}
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.active} onChange={(event) => set({ active: event.target.checked })} />
        Ativo
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={saving}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          Salvar cupom
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function describe(coupon: CheckoutCoupon): string {
  const discount =
    coupon.type === "PERCENT" ? formatPercentageBps(coupon.value) : formatCents(coupon.value);
  const uses = coupon.maxUses ? `${coupon.usedCount}/${coupon.maxUses} usos` : `${coupon.usedCount} usos`;
  const scope = coupon.appliesToAllProducts ? "todos os produtos" : `${coupon.products.length} produto(s)`;
  return `${discount} · ${scope} · ${uses}`;
}

export default function CheckoutCouponsPage() {
  const api = useApiClient();
  const [coupons, setCoupons] = useState<CheckoutCoupon[] | null>(null);
  const [products, setProducts] = useState<CheckoutProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  function reloadAll(): void {
    setCoupons(null);
    setError(null);
    setReload((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.listCheckoutCoupons(controller.signal),
      api.listCheckoutProducts(undefined, controller.signal),
    ])
      .then(([loadedCoupons, loadedProducts]) => {
        setCoupons(loadedCoupons);
        setProducts(loadedProducts);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(messageOf(caught, "Não foi possível carregar os cupons."));
      });
    return () => controller.abort();
  }, [api, reload]);

  async function save(action: () => Promise<CheckoutCoupon>, done: string) {
    setNotice(null);
    try {
      await action();
      setEditing(null);
      setNotice({ error: false, text: done });
      reloadAll();
    } catch (caught) {
      if (errorCode(caught) !== "VERSION_CHANGED") throw caught;
      setEditing(null);
      setNotice({ error: true, text: "Este cupom foi alterado em outra tela. A lista foi recarregada." });
      reloadAll();
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <TicketPercent size={20} />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Cupons</h1>
            <p className="text-sm text-slate-500">Descontos que o comprador informa na página de pagamento.</p>
          </div>
        </div>
        <button type="button" className={buttonClass} disabled={editing !== null} onClick={() => setEditing("new")}>
          <Plus size={16} /> Novo cupom
        </button>
      </header>
      <NoticeText notice={notice} />
      {editing === "new" && (
        <CouponEditor
          products={products}
          onCancel={() => setEditing(null)}
          onSave={(input) => save(() => api.createCheckoutCoupon(input), "Cupom criado.")}
        />
      )}
      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
          <button type="button" className="ml-auto font-semibold underline" onClick={reloadAll}>
            Tentar de novo
          </button>
        </div>
      ) : coupons === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Carregando cupons…
        </p>
      ) : coupons.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          Nenhum cupom criado ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {coupons.map((coupon) =>
            editing === coupon.id ? (
              <li key={coupon.id}>
                <CouponEditor
                  coupon={coupon}
                  products={products}
                  onCancel={() => setEditing(null)}
                  onSave={(input) =>
                    save(
                      () => api.updateCheckoutCoupon(coupon.id, { ...input, expectedVersion: coupon.version }),
                      "Cupom salvo.",
                    )
                  }
                />
              </li>
            ) : (
              <li
                key={coupon.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
              >
                <div className="flex-1">
                  <p className="font-mono text-sm font-semibold text-slate-900">
                    {coupon.code}
                    {!coupon.active && <span className="ml-2 font-sans text-xs font-normal text-slate-500">(inativo)</span>}
                  </p>
                  <p className="text-sm text-slate-500">{describe(coupon)}</p>
                </div>
                <button
                  type="button"
                  className="text-sm font-semibold text-emerald-700 hover:underline"
                  disabled={editing !== null}
                  onClick={() => setEditing(coupon.id)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="text-sm font-semibold text-slate-600 hover:underline"
                  disabled={editing !== null}
                  onClick={() =>
                    void save(
                      () =>
                        api.setCheckoutCouponActive(coupon.id, {
                          expectedVersion: coupon.version,
                          active: !coupon.active,
                        }),
                      coupon.active ? "Cupom desativado." : "Cupom ativado.",
                    ).catch((caught: unknown) =>
                      setNotice({ error: true, text: messageOf(caught, "Não foi possível alterar o cupom.") }),
                    )
                  }
                >
                  {coupon.active ? "Desativar" : "Ativar"}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
