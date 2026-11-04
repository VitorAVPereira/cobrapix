"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type {
  CheckoutDeliveryMode,
  CheckoutProduct,
  CheckoutProductInput,
} from "@/lib/api-client";
import { parseAmountToCents } from "@/lib/disbursements";
import { centsToInput, DELIVERY_MODE_LABELS } from "@/lib/checkout";
import { buttonClass, Field, ImageUpload, inputClass } from "./ui";

const MIN_PRICE_CENTS = 500;

interface FormState {
  name: string;
  description: string;
  price: string;
  compareAt: string;
  imageAssetId: string | null;
  accessPeriodMonths: string;
  deliveryMode: CheckoutDeliveryMode;
  accessUrl: string;
  accessInstructions: string;
}

function initialState(product?: CheckoutProduct): FormState {
  return {
    name: product?.name ?? "",
    description: product?.description ?? "",
    price: centsToInput(product?.priceCents),
    compareAt: centsToInput(product?.compareAtPriceCents),
    imageAssetId: product?.imageAssetId ?? null,
    accessPeriodMonths: product?.accessPeriodMonths ? String(product.accessPeriodMonths) : "",
    deliveryMode: product?.deliveryMode ?? "ACCESS_LINK",
    accessUrl: product?.accessUrl ?? "",
    accessInstructions: product?.accessInstructions ?? "",
  };
}

/** Validates in the browser what the API also checks, so the seller sees it at once. */
export function toProductInput(form: FormState): CheckoutProductInput {
  const priceCents = parseAmountToCents(form.price);
  if (priceCents === null || priceCents < MIN_PRICE_CENTS)
    throw new Error("Informe um preço de pelo menos R$ 5,00.");
  const compareAtPriceCents = form.compareAt.trim() ? parseAmountToCents(form.compareAt) : null;
  if (form.compareAt.trim() && (compareAtPriceCents === null || compareAtPriceCents <= priceCents))
    throw new Error('O preço "De" precisa ser maior que o preço de venda.');
  const months = form.accessPeriodMonths.trim() ? Number(form.accessPeriodMonths) : null;
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120))
    throw new Error("O período de acesso vai de 1 a 120 meses.");
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    priceCents,
    compareAtPriceCents,
    imageAssetId: form.imageAssetId,
    accessPeriodMonths: months,
    deliveryMode: form.deliveryMode,
    accessUrl: form.deliveryMode === "WEBHOOK" ? null : form.accessUrl.trim() || null,
    accessInstructions: form.accessInstructions.trim() || null,
  };
}

export function ProductForm({
  product,
  submitLabel,
  onSubmit,
}: {
  product?: CheckoutProduct;
  submitLabel: string;
  onSubmit: (input: CheckoutProductInput) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<FormState>) => setForm((current) => ({ ...current, ...change }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit(toProductInput(form));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar o produto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do produto">
          <input
            className={inputClass}
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            required
          />
        </Field>
        <Field label="Período de acesso (meses)" hint="Opcional. Ex.: 12 para anual, 3 para trimestral.">
          <input
            className={inputClass}
            inputMode="numeric"
            value={form.accessPeriodMonths}
            onChange={(event) => set({ accessPeriodMonths: event.target.value })}
          />
        </Field>
        <Field label="Preço (R$)" hint="Mínimo R$ 5,00.">
          <input
            className={inputClass}
            inputMode="decimal"
            placeholder="67,00"
            value={form.price}
            onChange={(event) => set({ price: event.target.value })}
            required
          />
        </Field>
        <Field label='Preço "De" (R$)' hint="Opcional. Aparece riscado na página.">
          <input
            className={inputClass}
            inputMode="decimal"
            placeholder="97,00"
            value={form.compareAt}
            onChange={(event) => set({ compareAt: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Descrição">
        <textarea
          className={`${inputClass} h-24 py-2`}
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>
      <ImageUpload
        label="Imagem do produto"
        kind="PRODUCT_IMAGE"
        assetId={form.imageAssetId}
        onChange={(imageAssetId) => set({ imageAssetId })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Entrega do acesso">
          <select
            className={inputClass}
            value={form.deliveryMode}
            onChange={(event) =>
              set({ deliveryMode: event.target.value as CheckoutDeliveryMode })
            }
          >
            {Object.entries(DELIVERY_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {form.deliveryMode !== "WEBHOOK" && (
          <Field label="Link de acesso" hint="Enviado ao comprador por e-mail e no redirecionamento.">
            <input
              className={inputClass}
              placeholder="https://"
              value={form.accessUrl}
              onChange={(event) => set({ accessUrl: event.target.value })}
              required
            />
          </Field>
        )}
      </div>
      <Field
        label="Instruções de acesso"
        hint={
          form.deliveryMode === "WEBHOOK"
            ? "Obrigatório: explique como o comprador recebe o acesso. O aviso automático ao seu sistema (webhook) será liberado em breve."
            : "Opcional. Aparecem depois do pagamento."
        }
      >
        <textarea
          className={`${inputClass} h-20 py-2`}
          value={form.accessInstructions}
          onChange={(event) => set({ accessInstructions: event.target.value })}
          required={form.deliveryMode === "WEBHOOK"}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" className={buttonClass} disabled={saving}>
        {saving && <Loader2 size={16} className="animate-spin" />}
        {submitLabel}
      </button>
    </form>
  );
}
