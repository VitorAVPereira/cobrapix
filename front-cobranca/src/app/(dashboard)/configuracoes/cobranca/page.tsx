"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CirclePlus,
  CreditCard,
  Loader2,
  MessageCircle,
  Play,
  RefreshCcw,
  Save,
  Trash2,
} from "lucide-react";
import type {
  BillingMethod,
  BillingRunSummary,
  BillingSettings,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const DEFAULT_OFFSETS = [-2, 0, 2, 7];
const QUICK_OFFSETS = [-7, -3, -2, -1, 0, 1, 2, 3, 7, 15, 30];
const MIN_OFFSET = -30;
const MAX_OFFSET = 365;
const BILLING_METHODS: BillingMethod[] = ["PIX", "BOLETO", "BOLIX"];

type WhatsAppConnectionStatus = "checking" | "connected" | "disconnected";

function normalizeOffsets(offsets: number[]): number[] {
  return Array.from(
    new Set(
      offsets.filter(
        (offset) =>
          Number.isInteger(offset) &&
          offset >= MIN_OFFSET &&
          offset <= MAX_OFFSET,
      ),
    ),
  ).sort((left, right) => left - right);
}

function getMethodLabel(method: BillingMethod): string {
  if (method === "PIX") return "Pix";
  if (method === "BOLETO") return "Boleto";
  return "Bolix";
}

function getMethodDescription(method: BillingMethod): string {
  if (method === "PIX") {
    return "Cobrança Pix com tarifa Efí percentual e nossa taxa fixa por transação.";
  }

  if (method === "BOLETO") {
    return "Cobrança por boleto com tarifa fixa da Efí somada à taxa fixa da plataforma.";
  }

  return "Cobrança Bolix com tarifa fixa da Efí somada à taxa fixa da plataforma.";
}

function getErrorMessage(
  error: unknown,
  fallback = "Nao foi possivel salvar a configuracao.",
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

function isWhatsappConnected(data: { state?: string; dbStatus?: string }): boolean {
  const state = data.state?.toLowerCase();
  const dbStatus = data.dbStatus?.toUpperCase();

  return state === "open" || state === "connected" || dbStatus === "CONNECTED";
}

function getBillingRunErrorMessage(error: unknown): string {
  const message = getErrorMessage(
    error,
    "Nao foi possivel executar a regua de cobranca agora.",
  );

  if (message.toLowerCase().includes("whatsapp")) {
    return "WhatsApp nao esta conectado. Conecte o aparelho para executar a regua manual.";
  }

  return message;
}

function formatOffset(offset: number): string {
  if (offset === 0) {
    return "No vencimento";
  }

  const absoluteOffset = Math.abs(offset);
  const dayLabel = absoluteOffset === 1 ? "dia" : "dias";
  return offset < 0
    ? `${absoluteOffset} ${dayLabel} antes`
    : `${absoluteOffset} ${dayLabel} depois`;
}

function estimateFee(method: BillingMethod, amount: number, settings: BillingSettings): string {
  const tariff = settings.tariffs[method];

  if (tariff.efiKind === "percentage") {
    const efiAmount = (amount * tariff.efiValue) / 100;
    const total = efiAmount + tariff.platformFixedFee;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(total);
  }

  return tariff.combinedLabel;
}

export default function BillingSettingsPage() {
  const apiClient = useApiClient();
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [preferredBillingMethod, setPreferredBillingMethod] =
    useState<BillingMethod>("PIX");
  const [selectedOffsets, setSelectedOffsets] = useState<number[]>([0]);
  const [customOffset, setCustomOffset] = useState("");
  const [autoGenerateFirstCharge, setAutoGenerateFirstCharge] = useState(true);
  const [autoDiscountEnabled, setAutoDiscountEnabled] = useState(false);
  const [autoDiscountDaysAfterDue, setAutoDiscountDaysAfterDue] = useState("0");
  const [autoDiscountPercentage, setAutoDiscountPercentage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [whatsappStatus, setWhatsappStatus] =
    useState<WhatsAppConnectionStatus>("checking");
  const [runningBilling, setRunningBilling] = useState(false);
  const [billingRunResult, setBillingRunResult] =
    useState<BillingRunSummary | null>(null);
  const [billingRunMessage, setBillingRunMessage] = useState<string | null>(
    null,
  );
  const [billingRunError, setBillingRunError] = useState<string | null>(null);

  const orderedOffsets = useMemo(
    () => normalizeOffsets(selectedOffsets),
    [selectedOffsets],
  );
  const whatsappConnected = whatsappStatus === "connected";

  const refreshWhatsappStatus = useCallback(async (): Promise<boolean> => {
    setWhatsappStatus("checking");

    try {
      const response = await apiClient.getWhatsappStatus();
      const connected = isWhatsappConnected(response);

      setWhatsappStatus(connected ? "connected" : "disconnected");
      return connected;
    } catch {
      setWhatsappStatus("disconnected");
      return false;
    }
  }, [apiClient]);

  useEffect(() => {
    let active = true;

    async function loadSettings(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.getBillingSettings();

        if (!active) {
          return;
        }

        setSettings(response);
        setPreferredBillingMethod(response.preferredBillingMethod);
        setSelectedOffsets(normalizeOffsets(response.collectionReminderDays));
        setAutoGenerateFirstCharge(response.autoGenerateFirstCharge);
        setAutoDiscountEnabled(response.autoDiscountEnabled);
        setAutoDiscountDaysAfterDue(
          String(response.autoDiscountDaysAfterDue ?? 0),
        );
        setAutoDiscountPercentage(
          response.autoDiscountPercentage?.toString() ?? "",
        );
      } catch (loadError) {
        if (active) {
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      active = false;
    };
  }, [apiClient]);

  useEffect(() => {
    void refreshWhatsappStatus();
  }, [refreshWhatsappStatus]);

  function toggleOffset(offset: number): void {
    setSelectedOffsets((current) => {
      if (current.includes(offset)) {
        const nextOffsets = current.filter((item) => item !== offset);
        return nextOffsets.length > 0 ? nextOffsets : current;
      }

      return normalizeOffsets([...current, offset]);
    });
    setSuccess(null);
  }

  function removeOffset(offset: number): void {
    setSelectedOffsets((current) => {
      const nextOffsets = current.filter((item) => item !== offset);
      return nextOffsets.length > 0 ? nextOffsets : current;
    });
    setSuccess(null);
  }

  function applyDefaultOffsets(): void {
    setSelectedOffsets(DEFAULT_OFFSETS);
    setSuccess(null);
  }

  function addCustomOffset(): void {
    const offset = Number(customOffset);

    if (
      !Number.isInteger(offset) ||
      offset < MIN_OFFSET ||
      offset > MAX_OFFSET
    ) {
      setError("Informe um numero inteiro entre -30 e 365.");
      return;
    }

    setSelectedOffsets((current) => normalizeOffsets([...current, offset]));
    setCustomOffset("");
    setError(null);
    setSuccess(null);
  }

  async function saveSettings(): Promise<void> {
    const collectionReminderDays = normalizeOffsets(selectedOffsets);
    const parsedDiscountDays = Number(autoDiscountDaysAfterDue);
    const parsedDiscountPercentage = Number(autoDiscountPercentage);

    if (collectionReminderDays.length === 0) {
      setError("Mantenha pelo menos um dia de cobranca ativo.");
      return;
    }

    if (autoDiscountEnabled) {
      if (
        !Number.isInteger(parsedDiscountDays) ||
        parsedDiscountDays < 0 ||
        parsedDiscountDays > 365
      ) {
        setError("Informe em quantos dias apos o vencimento o desconto vale.");
        return;
      }

      if (
        !Number.isFinite(parsedDiscountPercentage) ||
        parsedDiscountPercentage <= 0 ||
        parsedDiscountPercentage > 100
      ) {
        setError("Informe um percentual de desconto entre 0,01% e 100%.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const saved = await apiClient.updateBillingSettings({
        preferredBillingMethod,
        collectionReminderDays,
        autoGenerateFirstCharge,
        autoDiscountEnabled,
        autoDiscountDaysAfterDue: autoDiscountEnabled ? parsedDiscountDays : null,
        autoDiscountPercentage: autoDiscountEnabled
          ? Number(parsedDiscountPercentage.toFixed(2))
          : null,
      });

      setSettings(saved);
      setPreferredBillingMethod(saved.preferredBillingMethod);
      setSelectedOffsets(normalizeOffsets(saved.collectionReminderDays));
      setAutoGenerateFirstCharge(saved.autoGenerateFirstCharge);
      setAutoDiscountEnabled(saved.autoDiscountEnabled);
      setAutoDiscountDaysAfterDue(String(saved.autoDiscountDaysAfterDue ?? 0));
      setAutoDiscountPercentage(
        saved.autoDiscountPercentage?.toString() ?? "",
      );
      setSuccess("Configuracoes de cobranca salvas.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runBillingNow(): Promise<void> {
    setRunningBilling(true);
    setBillingRunError(null);
    setBillingRunMessage(null);
    setBillingRunResult(null);

    const connected = await refreshWhatsappStatus();

    if (!connected) {
      setBillingRunError(
        "WhatsApp nao esta conectado. Conecte o aparelho para executar a regua manual.",
      );
      setRunningBilling(false);
      return;
    }

    try {
      const response = await apiClient.runBilling();
      setBillingRunResult(response.summary);
      setBillingRunMessage(response.message);
      setSuccess(null);
    } catch (runError) {
      const message = getBillingRunErrorMessage(runError);
      setBillingRunError(message);

      if (message.toLowerCase().includes("whatsapp")) {
        setWhatsappStatus("disconnected");
      }
    } finally {
      setRunningBilling(false);
    }
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              Agenda de cobranca
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Escolha o metodo global de cobranca e deixe as tarifas visiveis para a tomada de decisao.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={saving || loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Save size={18} />
            )}
            Salvar
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            <CheckCircle2 size={18} />
            {success}
          </div>
        )}

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-2">
              <Play size={20} className="mt-0.5 text-emerald-600" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Executar regua agora
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Enfileire manualmente as cobrancas elegiveis para os dias ativos da agenda.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span
                className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold ${
                  whatsappStatus === "checking"
                    ? "border-slate-200 bg-slate-50 text-slate-600"
                    : whatsappConnected
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {whatsappStatus === "checking" ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : whatsappConnected ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <MessageCircle size={15} />
                )}
                {whatsappStatus === "checking"
                  ? "Verificando WhatsApp"
                  : whatsappConnected
                    ? "WhatsApp conectado"
                    : "WhatsApp desconectado"}
              </span>

              <button
                type="button"
                onClick={() => void refreshWhatsappStatus()}
                disabled={runningBilling || whatsappStatus === "checking"}
                title="Atualizar status do WhatsApp"
                aria-label="Atualizar status do WhatsApp"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCcw
                  size={16}
                  className={whatsappStatus === "checking" ? "animate-spin" : ""}
                />
              </button>

              <button
                type="button"
                onClick={() => void runBillingNow()}
                disabled={
                  runningBilling ||
                  whatsappStatus === "checking" ||
                  !whatsappConnected
                }
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runningBilling ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Play size={17} />
                )}
                Executar agora
              </button>
            </div>
          </div>

          <div className="space-y-4 p-5">
            {!whatsappConnected && whatsappStatus !== "checking" && (
              <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                  <p>
                    Conecte o WhatsApp antes de rodar a regua. Assim as mensagens podem ser enfileiradas com seguranca.
                  </p>
                </div>
                <Link
                  href="/configuracoes/whatsapp"
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-amber-900 px-3 text-sm font-semibold text-white transition hover:bg-amber-800"
                >
                  <MessageCircle size={16} />
                  Conectar
                </Link>
              </div>
            )}

            {billingRunError && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                <span>{billingRunError}</span>
              </div>
            )}

            {billingRunResult && (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                  <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
                  <span>{billingRunMessage ?? "Regua de cobranca executada."}</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Avaliadas
                    </p>
                    <p className="mt-2 text-2xl font-bold text-slate-950">
                      {billingRunResult.total}
                    </p>
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-xs font-semibold uppercase text-emerald-700">
                      Enfileiradas
                    </p>
                    <p className="mt-2 text-2xl font-bold text-emerald-800">
                      {billingRunResult.queued}
                    </p>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-semibold uppercase text-amber-700">
                      Puladas
                    </p>
                    <p className="mt-2 text-2xl font-bold text-amber-800">
                      {billingRunResult.skipped}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
            <MessageCircle size={20} className="text-emerald-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Primeira cobrança
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Gere e enfileire a primeira cobrança assim que uma fatura for cadastrada.
              </p>
            </div>
          </div>

          <div className="p-5">
            <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <input
                type="checkbox"
                checked={autoGenerateFirstCharge}
                onChange={(event) => {
                  setAutoGenerateFirstCharge(event.target.checked);
                  setSuccess(null);
                }}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Ativar no cadastro
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  CSVs grandes passam pela fila com intervalos entre mensagens.
                </p>
              </div>
            </label>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
            <CreditCard size={20} className="text-emerald-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Metodo de pagamento
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                A tarifa da Efí é apenas informativa e sempre recebe o adicional fixo de R$ 0,50 da plataforma.
              </p>
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-3">
            {BILLING_METHODS.map((method) => {
              const active = preferredBillingMethod === method;
              const tariff = settings?.tariffs[method];

              return (
                <button
                  key={method}
                  type="button"
                  onClick={() => {
                    setPreferredBillingMethod(method);
                    setSuccess(null);
                  }}
                  className={`rounded-md border px-4 py-4 text-left transition ${
                    active
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {getMethodLabel(method)}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Efí: {tariff?.efiLabel ?? "-"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Plataforma: {tariff?.platformLabel ?? "-"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    Total: {tariff?.combinedLabel ?? "-"}
                  </p>
                  {settings && (
                    <p className="mt-2 text-xs text-slate-500">
                      Exemplo em R$ 100,00: {estimateFee(method, 100, settings)}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-slate-500">
                    {getMethodDescription(method)}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <CalendarClock size={20} className="text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                Dias ativos
              </h2>
            </div>
            <button
              type="button"
              onClick={applyDefaultOffsets}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              Padrao
            </button>
          </div>

          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="animate-spin" size={18} />
                  Carregando agenda
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {QUICK_OFFSETS.map((offset) => {
                      const active = orderedOffsets.includes(offset);

                      return (
                        <button
                          key={offset}
                          type="button"
                          onClick={() => toggleOffset(offset)}
                          className={`min-h-20 rounded-md border px-4 py-3 text-left transition ${
                            active
                              ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span className="block text-sm font-semibold">
                            {formatOffset(offset)}
                          </span>
                          <span className="mt-2 block text-xs text-slate-500">
                            D
                            {offset === 0
                              ? ""
                              : offset > 0
                                ? `+${offset}`
                                : offset}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="number"
                      min={MIN_OFFSET}
                      max={MAX_OFFSET}
                      step={1}
                      value={customOffset}
                      onChange={(event) => setCustomOffset(event.target.value)}
                      className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:max-w-52"
                      placeholder="-2, 0, 7..."
                    />
                    <button
                      type="button"
                      onClick={addCustomOffset}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      <CirclePlus size={18} />
                      Adicionar
                    </button>
                  </div>
                </>
              )}
            </div>

            <aside className="rounded-md border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Sequencia
                </h2>
              </div>

              <div className="space-y-2 p-3">
                {orderedOffsets.map((offset) => (
                  <div
                    key={offset}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {formatOffset(offset)}
                      </p>
                      <p className="text-xs text-slate-500">
                        D{offset === 0 ? "" : offset > 0 ? `+${offset}` : offset}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeOffset(offset)}
                      disabled={orderedOffsets.length === 1}
                      aria-label={`Remover ${formatOffset(offset)}`}
                      title="Remover"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
            <CreditCard size={20} className="text-emerald-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Desconto automatico
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Defina um desconto global para pagamentos feitos apos o vencimento.
              </p>
            </div>
          </div>

          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-5">
              <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                <input
                  type="checkbox"
                  checked={autoDiscountEnabled}
                  onChange={(event) => {
                    setAutoDiscountEnabled(event.target.checked);
                    setSuccess(null);
                  }}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Ativar desconto automatico
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Quando ativo, novas cobrancas passam a sair com a regra de desconto configurada.
                  </p>
                </div>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Dias apos o vencimento
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    value={autoDiscountDaysAfterDue}
                    disabled={!autoDiscountEnabled}
                    onChange={(event) => {
                      setAutoDiscountDaysAfterDue(event.target.value);
                      setSuccess(null);
                    }}
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    placeholder="Ex: 3"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Percentual de desconto
                  </span>
                  <div className="relative">
                    <input
                      type="number"
                      min={0.01}
                      max={100}
                      step={0.01}
                      value={autoDiscountPercentage}
                      disabled={!autoDiscountEnabled}
                      onChange={(event) => {
                        setAutoDiscountPercentage(event.target.value);
                        setSuccess(null);
                      }}
                      className="h-11 w-full rounded-md border border-slate-300 px-3 pr-9 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      placeholder="Ex: 10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      %
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <aside className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Resumo</h3>
              <p className="mt-3 text-sm text-slate-600">
                Metodo atual: {getMethodLabel(preferredBillingMethod)}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Tarifa aplicada: {settings?.tariffs[preferredBillingMethod].combinedLabel ?? "-"}
              </p>
              <p className="mt-3 text-sm text-slate-600">
                {autoDiscountEnabled
                  ? `${autoDiscountPercentage || "0"}% de desconto ate ${autoDiscountDaysAfterDue || "0"} dia(s) apos o vencimento.`
                  : "Nenhum desconto automatico configurado."}
              </p>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
