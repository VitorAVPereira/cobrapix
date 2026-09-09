"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  Webhook,
  WifiOff,
} from "lucide-react";
import type { WhatsAppUsageResponse } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

type ConnectionStatus = "LOADING" | "CONNECTED" | "DISCONNECTED" | "SAVING";

interface BackendWhatsappStatus {
  state?: string;
  dbStatus?: string;
  phoneNumberId?: string | null;
  businessAccountId?: string | null;
  businessPhoneNumber?: string | null;
  defaultLanguage?: string;
  webhookUrl?: string;
}

interface MetaFormState {
  phoneNumberId: string;
  businessAccountId: string;
  businessPhoneNumber: string;
  defaultLanguage: string;
  accessToken: string;
}

const INITIAL_FORM: MetaFormState = {
  phoneNumberId: "",
  businessAccountId: "",
  businessPhoneNumber: "",
  defaultLanguage: "pt_BR",
  accessToken: "",
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isConnectedStatus(data: BackendWhatsappStatus): boolean {
  const state = data.state?.toLowerCase();
  const dbStatus = data.dbStatus?.toUpperCase();

  return state === "open" || state === "connected" || dbStatus === "CONNECTED";
}

export default function WhatsappConfigPage() {
  const apiClient = useApiClient();
  const [status, setStatus] = useState<ConnectionStatus>("LOADING");
  const [form, setForm] = useState<MetaFormState>(INITIAL_FORM);
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [usage, setUsage] = useState<WhatsAppUsageResponse | null>(null);

  useEffect(() => {
    let active = true;

    async function loadStatus(): Promise<void> {
      setErrorMsg(null);

      try {
        const data = await apiClient.getWhatsappStatus();
        if (!active) return;

        setWebhookUrl(data.webhookUrl ?? "");
        setForm((current) => ({
          ...current,
          phoneNumberId: data.phoneNumberId ?? "",
          businessAccountId: data.businessAccountId ?? "",
          businessPhoneNumber: data.businessPhoneNumber ?? "",
          defaultLanguage: data.defaultLanguage ?? "pt_BR",
          accessToken: "",
        }));
        setStatus(isConnectedStatus(data) ? "CONNECTED" : "DISCONNECTED");
      } catch (error) {
        if (active) {
          setStatus("DISCONNECTED");
          setErrorMsg(
            getErrorMessage(error, "Nao foi possivel consultar o WhatsApp."),
          );
        }
      }
    }

    async function loadUsage(): Promise<void> {
      try {
        const data = await apiClient.getWhatsappUsage();
        if (active) setUsage(data);
      } catch {
        // nao critico
      }
    }

    void loadStatus();
    void loadUsage();

    return () => {
      active = false;
    };
  }, [apiClient]);

  function updateForm<Field extends keyof MetaFormState>(
    field: Field,
    value: MetaFormState[Field],
  ): void {
    setForm((current) => ({ ...current, [field]: value }));
    setSuccessMsg(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus("SAVING");
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const saved = await apiClient.configureMetaWhatsapp({
        phoneNumberId: form.phoneNumberId.trim(),
        businessAccountId: form.businessAccountId.trim(),
        businessPhoneNumber: form.businessPhoneNumber.trim() || undefined,
        defaultLanguage: form.defaultLanguage.trim() || "pt_BR",
        accessToken: form.accessToken.trim(),
      });

      setWebhookUrl(saved.webhookUrl ?? webhookUrl);
      setForm((current) => ({ ...current, accessToken: "" }));
      setStatus("CONNECTED");
      setSuccessMsg("Meta Cloud API conectada.");
    } catch (error: unknown) {
      setStatus("DISCONNECTED");
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel validar a Meta Cloud API."),
      );
    }
  }

  async function handleDisconnect(): Promise<void> {
    if (!confirm("Deseja desconectar a Meta Cloud API desta empresa?")) {
      return;
    }

    try {
      await apiClient.disconnectWhatsapp();
      setForm(INITIAL_FORM);
      setStatus("DISCONNECTED");
      setSuccessMsg("Integração desconectada.");
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error, "Erro ao desconectar WhatsApp."));
    }
  }

  const connected = status === "CONNECTED";
  const saving = status === "SAVING";

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          WhatsApp oficial
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Envio por Meta Cloud API com templates aprovados e controle de opt-in.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="rounded-md border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <PlugZap size={20} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Canal Meta Cloud API
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Credenciais oficiais do WhatsApp Business Platform.
                </p>
              </div>
            </div>

            <span
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold ${
                connected
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {status === "LOADING" || saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : connected ? (
                <CheckCircle2 size={14} />
              ) : (
                <WifiOff size={14} />
              )}
              {status === "LOADING"
                ? "Verificando"
                : saving
                  ? "Validando"
                  : connected
                    ? "Conectado"
                    : "Desconectado"}
            </span>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Phone Number ID
              </span>
              <input
                required
                value={form.phoneNumberId}
                onChange={(event) =>
                  updateForm("phoneNumberId", event.target.value)
                }
                className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                WhatsApp Business Account ID
              </span>
              <input
                required
                value={form.businessAccountId}
                onChange={(event) =>
                  updateForm("businessAccountId", event.target.value)
                }
                className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Número exibido
              </span>
              <input
                value={form.businessPhoneNumber}
                placeholder="+55 11 99999-9999"
                onChange={(event) =>
                  updateForm("businessPhoneNumber", event.target.value)
                }
                className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Idioma padrão
              </span>
              <input
                required
                value={form.defaultLanguage}
                onChange={(event) =>
                  updateForm("defaultLanguage", event.target.value)
                }
                className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Access token permanente
              </span>
              <input
                required
                type="password"
                value={form.accessToken}
                onChange={(event) => updateForm("accessToken", event.target.value)}
                className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>
          </div>

          {(errorMsg || successMsg) && (
            <div className="px-5 pb-4">
              <div
                className={`rounded-md border px-4 py-3 text-sm font-medium ${
                  errorMsg
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}
              >
                {errorMsg ?? successMsg}
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
            {connected && (
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Desconectar
              </button>
            )}
            <button
              type="submit"
              disabled={saving || status === "LOADING"}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar integração
            </button>
          </div>
        </form>

        <aside className="space-y-4">
          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Webhook size={18} className="text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-900">Webhook</h3>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              {webhookUrl || "Configure META_WEBHOOK_BASE_URL no backend."}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck size={18} className="text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Regras de envio
              </h3>
            </div>
            <div className="space-y-3 text-sm text-slate-600">
              <p>Mensagens de cobrança saem como templates oficiais.</p>
              <p>Devedores sem opt-in são bloqueados antes do envio.</p>
              <p>Respostas STOP, SAIR, PARAR ou CANCELAR revogam o opt-in.</p>
            </div>
          </section>

          {usage && (
            <section className="rounded-md border border-blue-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Activity size={18} className="text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Consumo Diario
                </h3>
              </div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">
                  {usage.dailyUsage}
                </span>
                <span className="text-xs text-slate-400">
                  / {usage.dailyLimit} clientes
                </span>
              </div>
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${
                    usage.remaining === 0
                      ? "bg-rose-500"
                      : usage.dailyUsage / usage.dailyLimit > 0.8
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (usage.dailyUsage / usage.dailyLimit) * 100,
                    )}%`,
                  }}
                />
              </div>
              <p className="text-xs text-slate-500">
                Tier: {usage.tier.replace("TIER_", "")}
                {usage.remaining > 0
                  ? ` — ${usage.remaining} restantes`
                  : " — esgotado"}
              </p>
            </section>
          )}

          <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 text-amber-700" size={18} />
              <p className="text-xs leading-relaxed text-amber-900">
                Cadastre no painel da Meta os eventos de mensagens para
                `/webhooks/meta` e use o mesmo verify token do backend.
              </p>
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound size={18} className="text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-900">Token</h3>
            </div>
            <p className="text-sm text-slate-600">
              O token é validado na Meta e armazenado criptografado no backend.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
