"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type {
  CheckoutAfterPurchase,
  CheckoutDeliveryMode,
  CheckoutProduct,
  CheckoutProductInput,
} from "@/lib/api-client";
import { parseAmountToCents } from "@/lib/disbursements";
import { centsToInput, DELIVERY_MODE_LABELS } from "@/lib/checkout";
import { buttonClass, Field, ImageUpload, inputClass } from "./ui";

const MIN_PRICE_CENTS = 500;

const AFTER_PURCHASE_LABELS: Record<CheckoutAfterPurchase, string> = {
  ACCESS: "Levar ao link de acesso",
  OFFER: "Mostrar a oferta de 1 clique (upsell e downsell)",
  EXTERNAL: "Levar à minha página de oferta",
};

interface FormState {
  name: string;
  description: string;
  price: string;
  compareAt: string;
  imageAssetId: string | null;
  logoAssetId: string | null;
  bannerAssetId: string | null;
  // Empty: the color of the checkout settings.
  primaryColor: string;
  accessPeriodMonths: string;
  deliveryMode: CheckoutDeliveryMode;
  accessUrl: string;
  accessInstructions: string;
  afterPurchase: CheckoutAfterPurchase;
  afterPurchaseUrl: string;
  offerWindowMinutes: string;
}

function initialState(product?: CheckoutProduct): FormState {
  return {
    name: product?.name ?? "",
    description: product?.description ?? "",
    price: centsToInput(product?.priceCents),
    compareAt: centsToInput(product?.compareAtPriceCents),
    imageAssetId: product?.imageAssetId ?? null,
    logoAssetId: product?.logoAssetId ?? null,
    bannerAssetId: product?.bannerAssetId ?? null,
    primaryColor: product?.primaryColor ?? "",
    accessPeriodMonths: product?.accessPeriodMonths ? String(product.accessPeriodMonths) : "",
    deliveryMode: product?.deliveryMode ?? "ACCESS_LINK",
    accessUrl: product?.accessUrl ?? "",
    accessInstructions: product?.accessInstructions ?? "",
    afterPurchase: product?.afterPurchase ?? "ACCESS",
    afterPurchaseUrl: product?.afterPurchaseUrl ?? "",
    offerWindowMinutes: String(product?.offerWindowMinutes ?? 30),
  };
}

/** What the page preview shows while the seller types, before anything is saved. */
export interface ProductDraft {
  name: string;
  description: string | null;
  priceCents: number | null;
  compareAtPriceCents: number | null;
  imageAssetId: string | null;
  logoAssetId: string | null;
  bannerAssetId: string | null;
  primaryColor: string | null;
  accessPeriodMonths: number | null;
}

function draftOf(form: FormState): ProductDraft {
  const months = Number(form.accessPeriodMonths);
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    priceCents: parseAmountToCents(form.price),
    compareAtPriceCents: form.compareAt.trim() ? parseAmountToCents(form.compareAt) : null,
    imageAssetId: form.imageAssetId,
    logoAssetId: form.logoAssetId,
    bannerAssetId: form.bannerAssetId,
    primaryColor: /^#[0-9a-fA-F]{6}$/.test(form.primaryColor.trim()) ? form.primaryColor.trim() : null,
    accessPeriodMonths: Number.isInteger(months) && months >= 1 && months <= 120 ? months : null,
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
  const window = Number(form.offerWindowMinutes);
  if (!Number.isInteger(window) || window < 15 || window > 1440)
    throw new Error("A oferta vale de 15 minutos a 24 horas (1.440 minutos).");
  const afterPurchaseUrl = form.afterPurchaseUrl.trim();
  const primaryColor = form.primaryColor.trim();
  if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor))
    throw new Error("Informe a cor no formato #RRGGBB ou deixe em branco para usar a das Configurações.");
  if (form.afterPurchase === "EXTERNAL" && !afterPurchaseUrl.startsWith("https://"))
    throw new Error("O endereço da sua página de oferta precisa começar com https://.");
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    priceCents,
    compareAtPriceCents,
    imageAssetId: form.imageAssetId,
    logoAssetId: form.logoAssetId,
    bannerAssetId: form.bannerAssetId,
    primaryColor: primaryColor ? primaryColor.toUpperCase() : null,
    accessPeriodMonths: months,
    deliveryMode: form.deliveryMode,
    accessUrl: form.deliveryMode === "WEBHOOK" ? null : form.accessUrl.trim() || null,
    accessInstructions: form.accessInstructions.trim() || null,
    afterPurchase: form.afterPurchase,
    afterPurchaseUrl: form.afterPurchase === "EXTERNAL" ? afterPurchaseUrl : null,
    offerWindowMinutes: window,
  };
}

export function ProductForm({
  product,
  submitLabel,
  defaultColor,
  onSubmit,
  onDraftChange,
}: {
  product?: CheckoutProduct;
  submitLabel: string;
  /** The color of the checkout settings, used while the product has none. */
  defaultColor?: string;
  onSubmit: (input: CheckoutProductInput) => Promise<void>;
  onDraftChange?: (draft: ProductDraft) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<FormState>) => setForm((current) => ({ ...current, ...change }));

  useEffect(() => {
    onDraftChange?.(draftOf(form));
  }, [form, onDraftChange]);

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
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-800">Aparência da página</legend>
        <p className="text-xs text-slate-500">
          Só deste produto. Em branco, a página usa o logo, o banner e a cor das Configurações do checkout.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageUpload label="Logo" kind="LOGO" assetId={form.logoAssetId} onChange={(logoAssetId) => set({ logoAssetId })} />
          <ImageUpload
            label="Banner do topo"
            kind="BANNER"
            assetId={form.bannerAssetId}
            onChange={(bannerAssetId) => set({ bannerAssetId })}
          />
        </div>
        <Field label="Cor principal" hint="Usada na página de oferta depois da compra.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Escolher cor"
              className="h-11 w-14 shrink-0 rounded-md border border-slate-300"
              value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : (defaultColor ?? "#0F766E")}
              onChange={(event) => set({ primaryColor: event.target.value.toUpperCase() })}
            />
            <input
              className={inputClass}
              placeholder={defaultColor ? `${defaultColor} (das Configurações)` : "Das Configurações"}
              value={form.primaryColor}
              onChange={(event) => set({ primaryColor: event.target.value })}
            />
            {form.primaryColor && (
              <button
                type="button"
                className="shrink-0 text-sm font-semibold text-slate-500 hover:text-slate-800"
                onClick={() => set({ primaryColor: "" })}
              >
                Usar a padrão
              </button>
            )}
          </div>
        </Field>
      </fieldset>
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
      <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-800">Depois da compra</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Para onde o comprador vai">
            <select
              className={inputClass}
              value={form.afterPurchase}
              onChange={(event) => set({ afterPurchase: event.target.value as CheckoutAfterPurchase })}
            >
              {Object.entries(AFTER_PURCHASE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {form.afterPurchase !== "ACCESS" && (
            <Field
              label="Validade da oferta (minutos)"
              hint="De 15 minutos a 24 horas (1.440), contados do pagamento. Depois disso, o link de 1 clique deixa de vender."
            >
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.offerWindowMinutes}
                onChange={(event) => set({ offerWindowMinutes: event.target.value })}
              />
            </Field>
          )}
        </div>
        {form.afterPurchase === "EXTERNAL" && (
          <Field
            label="Endereço da sua página de oferta"
            hint="O comprador chega com o parâmetro cifra_oferta, que monta os links de 1 clique das suas ofertas."
          >
            <input
              className={inputClass}
              placeholder="https://"
              value={form.afterPurchaseUrl}
              onChange={(event) => set({ afterPurchaseUrl: event.target.value })}
              required
            />
          </Field>
        )}
        <p className="text-xs text-slate-500">
          O e-mail com o acesso sai em qualquer caso. Com oferta, o cartão da compra fica guardado só até o fim da
          validade, para o comprador aceitar sem digitar de novo.
        </p>
      </fieldset>
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
