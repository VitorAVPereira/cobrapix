"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2, Settings2 } from "lucide-react";
import type {
  CheckoutFeePayer,
  CheckoutSettings,
  CheckoutSettingsInput,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { errorCode } from "@/lib/disbursements";
import {
  buttonClass,
  Field,
  ImageUpload,
  inputClass,
  messageOf,
  NoticeText,
  type Notice,
} from "@/components/features/checkout/ui";
import { WebhookPanel } from "@/components/features/checkout/WebhookPanel";

const FEE_PAYER_LABELS: Record<CheckoutFeePayer, string> = {
  SELLER: "Eu pago (o comprador paga o preço do produto)",
  BUYER: "O comprador paga (acrescentada ao total)",
};

function digitsOrNull(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

function SettingsForm({
  settings,
  onSaved,
  onConflict,
}: {
  settings: CheckoutSettings;
  onSaved: (settings: CheckoutSettings) => void;
  onConflict: () => void;
}) {
  const api = useApiClient();
  const [form, setForm] = useState<CheckoutSettingsInput>(() => ({
    displayName: settings.displayName,
    logoAssetId: settings.logoAssetId,
    bannerAssetId: settings.bannerAssetId,
    primaryColor: settings.primaryColor,
    supportEmail: settings.supportEmail,
    supportWhatsapp: settings.supportWhatsapp,
    whatsappButtonPhone: settings.whatsappButtonPhone,
    pixEnabled: settings.pixEnabled,
    cardEnabled: settings.cardEnabled,
    maxInstallments: settings.maxInstallments,
    pixFeePayer: settings.pixFeePayer,
    cardFeePayer: settings.cardFeePayer,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<CheckoutSettingsInput>) =>
    setForm((current) => ({ ...current, ...change }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      onSaved(
        await api.updateCheckoutSettings({
          ...form,
          supportEmail: form.supportEmail?.trim() || null,
          supportWhatsapp: digitsOrNull(form.supportWhatsapp),
          whatsappButtonPhone: digitsOrNull(form.whatsappButtonPhone),
          expectedVersion: settings.version,
        }),
      );
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED") onConflict();
      else setError(messageOf(caught, "Não foi possível salvar as configurações."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Aparência</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageUpload label="Logo" kind="LOGO" assetId={form.logoAssetId} onChange={(logoAssetId) => set({ logoAssetId })} />
          <ImageUpload
            label="Banner do topo"
            kind="BANNER"
            assetId={form.bannerAssetId}
            onChange={(bannerAssetId) => set({ bannerAssetId })}
          />
        </div>
        <Field label="Cor principal">
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Escolher cor"
              className="h-11 w-14 rounded-md border border-slate-300"
              value={form.primaryColor}
              onChange={(event) => set({ primaryColor: event.target.value.toUpperCase() })}
            />
            <input
              className={inputClass}
              value={form.primaryColor}
              onChange={(event) => set({ primaryColor: event.target.value })}
              pattern="#[0-9a-fA-F]{6}"
            />
          </div>
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Nome e suporte</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome exibido ao comprador">
            <input
              className={inputClass}
              value={form.displayName}
              onChange={(event) => set({ displayName: event.target.value })}
              required
            />
          </Field>
          <Field label="E-mail de suporte" hint="Opcional. Aparece na página e no e-mail de acesso.">
            <input
              type="email"
              className={inputClass}
              value={form.supportEmail ?? ""}
              onChange={(event) => set({ supportEmail: event.target.value })}
            />
          </Field>
          <Field label="WhatsApp de suporte" hint="Opcional. Com DDD.">
            <input
              className={inputClass}
              inputMode="tel"
              value={form.supportWhatsapp ?? ""}
              onChange={(event) => set({ supportWhatsapp: event.target.value })}
            />
          </Field>
          <Field label="WhatsApp do botão flutuante" hint="Opcional. Com DDD. Sem número, o botão não aparece.">
            <input
              className={inputClass}
              inputMode="tel"
              value={form.whatsappButtonPhone ?? ""}
              onChange={(event) => set({ whatsappButtonPhone: event.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Formas de pagamento e taxas</h2>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.pixEnabled} onChange={(event) => set({ pixEnabled: event.target.checked })} />
          Pix
        </label>
        <Field label="Taxa do Pix">
          <select
            className={inputClass}
            value={form.pixFeePayer}
            onChange={(event) => set({ pixFeePayer: event.target.value as CheckoutFeePayer })}
          >
            {Object.entries(FEE_PAYER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={false} disabled aria-describedby="card-soon" />
          Cartão de crédito
        </label>
        <p id="card-soon" className="text-xs text-slate-500">
          Disponível em breve. As opções abaixo já ficam guardadas para quando o cartão for liberado.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Parcelas no cartão (até)">
            <select
              className={inputClass}
              value={form.maxInstallments}
              onChange={(event) => set({ maxInstallments: Number(event.target.value) })}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count}x
                </option>
              ))}
            </select>
          </Field>
          <Field label="Taxa do cartão">
            <select
              className={inputClass}
              value={form.cardFeePayer}
              onChange={(event) => set({ cardFeePayer: event.target.value as CheckoutFeePayer })}
            >
              {Object.entries(FEE_PAYER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          A taxa repassada ao comprador cobre só o custo do meio de pagamento. A porcentagem da Cifra+ é sempre
          descontada da sua venda.
        </p>
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" className={buttonClass} disabled={saving}>
        {saving && <Loader2 size={16} className="animate-spin" />}
        Salvar configurações
      </button>
    </form>
  );
}

export default function CheckoutSettingsPage() {
  const api = useApiClient();
  const [settings, setSettings] = useState<CheckoutSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getCheckoutSettings(controller.signal)
      .then((result) => setSettings(result))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(messageOf(caught, "Não foi possível carregar as configurações."));
      });
    return () => controller.abort();
  }, [api, reload]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <Settings2 size={20} />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Configurações do checkout</h1>
          <p className="text-sm text-slate-500">Como a sua página de pagamento aparece para o comprador.</p>
        </div>
      </header>
      <NoticeText notice={notice} />
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : !settings ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Carregando configurações…
        </p>
      ) : (
        <SettingsForm
          // A new version (saved here or elsewhere) refills the form.
          key={settings.version}
          settings={settings}
          onSaved={(saved) => {
            setSettings(saved);
            setNotice({ error: false, text: "Configurações salvas." });
          }}
          onConflict={() => {
            setNotice({
              error: true,
              text: "As configurações foram alteradas em outra tela. Os dados foram recarregados.",
            });
            setReload((value) => value + 1);
          }}
        />
      )}
      <WebhookPanel />
    </div>
  );
}
