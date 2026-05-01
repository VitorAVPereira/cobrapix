"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CirclePlus,
  CreditCard,
  Loader2,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import type {
  BillingMethod,
  BillingSettings,
  DebtorBillingSettings,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const QUICK_OFFSETS = [-7, -3, -2, -1, 0, 1, 2, 3, 7, 15, 30];
const MIN_OFFSET = -30;
const MAX_OFFSET = 365;
const BILLING_METHODS: BillingMethod[] = ["PIX", "BOLETO", "BOLIX"];

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

function getMethodLabel(method: BillingMethod): string {
  if (method === "PIX") return "Pix";
  if (method === "BOLETO") return "Boleto";
  return "Bolix";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Nao foi possivel salvar as configuracoes do devedor.";
}

function estimateFee(method: BillingMethod, settings: BillingSettings): string {
  const tariff = settings.tariffs[method];
  return tariff.combinedLabel;
}

interface DebtorSettingsModalProps {
  debtorId: string;
  debtorName: string;
  onClose: () => void;
}

export function DebtorSettingsModal({
  debtorId,
  debtorName,
  onClose,
}: DebtorSettingsModalProps) {
  const apiClient = useApiClient();
  const [settings, setSettings] = useState<DebtorBillingSettings | null>(null);
  const [useGlobalBillingSettings, setUseGlobalBillingSettings] =
    useState(true);
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
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

  const orderedOffsets = useMemo(
    () => normalizeOffsets(selectedOffsets),
    [selectedOffsets],
  );

  useEffect(() => {
    let active = true;

    async function loadSettings(): Promise<void> {
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const response = await apiClient.getDebtorBillingSettings(debtorId);
        if (!active) return;

        setSettings(response);
        setWhatsappOptIn(response.whatsappOptIn);
        setUseGlobalBillingSettings(response.useGlobalBillingSettings);
        setPreferredBillingMethod(
          response.useGlobalBillingSettings
            ? response.globalSettings.preferredBillingMethod
            : (response.customPreferredBillingMethod ??
                response.globalSettings.preferredBillingMethod),
        );
        setSelectedOffsets(
          normalizeOffsets(
            response.useGlobalBillingSettings
              ? response.globalSettings.collectionReminderDays
              : response.customCollectionReminderDays,
          ),
        );
        setAutoGenerateFirstCharge(
          response.useGlobalBillingSettings
            ? response.globalSettings.autoGenerateFirstCharge
            : (response.customAutoGenerateFirstCharge ??
                response.globalSettings.autoGenerateFirstCharge),
        );
        setAutoDiscountEnabled(
          response.useGlobalBillingSettings
            ? response.globalSettings.autoDiscountEnabled
            : (response.customAutoDiscountEnabled ?? false),
        );
        setAutoDiscountDaysAfterDue(
          String(
            response.useGlobalBillingSettings
              ? (response.globalSettings.autoDiscountDaysAfterDue ?? 0)
              : (response.customAutoDiscountDaysAfterDue ?? 0),
          ),
        );
        setAutoDiscountPercentage(
          String(
            response.useGlobalBillingSettings
              ? (response.globalSettings.autoDiscountPercentage ?? "")
              : (response.customAutoDiscountPercentage ?? ""),
          ),
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
  }, [apiClient, debtorId]);

  function applySnapshot(useGlobal: boolean, snapshot: DebtorBillingSettings): void {
    setPreferredBillingMethod(
      useGlobal
        ? snapshot.globalSettings.preferredBillingMethod
        : (snapshot.customPreferredBillingMethod ??
            snapshot.globalSettings.preferredBillingMethod),
    );
    setSelectedOffsets(
      normalizeOffsets(
        useGlobal
          ? snapshot.globalSettings.collectionReminderDays
          : (snapshot.customCollectionReminderDays.length > 0
              ? snapshot.customCollectionReminderDays
              : snapshot.globalSettings.collectionReminderDays),
      ),
    );
    setAutoDiscountEnabled(
      useGlobal
        ? snapshot.globalSettings.autoDiscountEnabled
        : (snapshot.customAutoDiscountEnabled ??
            snapshot.globalSettings.autoDiscountEnabled),
    );
    setAutoGenerateFirstCharge(
      useGlobal
        ? snapshot.globalSettings.autoGenerateFirstCharge
        : (snapshot.customAutoGenerateFirstCharge ??
            snapshot.globalSettings.autoGenerateFirstCharge),
    );
    setAutoDiscountDaysAfterDue(
      String(
        useGlobal
          ? (snapshot.globalSettings.autoDiscountDaysAfterDue ?? 0)
          : (snapshot.customAutoDiscountDaysAfterDue ??
              snapshot.globalSettings.autoDiscountDaysAfterDue ??
              0),
      ),
    );
    setAutoDiscountPercentage(
      (
        useGlobal
          ? (snapshot.globalSettings.autoDiscountPercentage ?? "")
          : (snapshot.customAutoDiscountPercentage ??
              snapshot.globalSettings.autoDiscountPercentage ??
              "")
      ).toString(),
    );
  }

  function toggleOffset(offset: number): void {
    setSelectedOffsets((current) => {
      if (current.includes(offset)) {
        const next = current.filter((item) => item !== offset);
        return next.length > 0 ? next : current;
      }

      return normalizeOffsets([...current, offset]);
    });
    setSuccess(null);
  }

  function removeOffset(offset: number): void {
    setSelectedOffsets((current) => {
      const next = current.filter((item) => item !== offset);
      return next.length > 0 ? next : current;
    });
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

    if (!useGlobalBillingSettings && collectionReminderDays.length === 0) {
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
      const saved = await apiClient.updateDebtorBillingSettings(debtorId, {
        useGlobalBillingSettings,
        whatsappOptIn,
        preferredBillingMethod: useGlobalBillingSettings
          ? null
          : preferredBillingMethod,
        collectionReminderDays: useGlobalBillingSettings
          ? null
          : collectionReminderDays,
        autoGenerateFirstCharge: useGlobalBillingSettings
          ? null
          : autoGenerateFirstCharge,
        autoDiscountEnabled: useGlobalBillingSettings
          ? null
          : autoDiscountEnabled,
        autoDiscountDaysAfterDue:
          useGlobalBillingSettings || !autoDiscountEnabled
            ? null
            : parsedDiscountDays,
        autoDiscountPercentage:
          useGlobalBillingSettings || !autoDiscountEnabled
            ? null
            : Number(parsedDiscountPercentage.toFixed(2)),
      });

      setSettings(saved);
      setWhatsappOptIn(saved.whatsappOptIn);
      setUseGlobalBillingSettings(saved.useGlobalBillingSettings);
      applySnapshot(saved.useGlobalBillingSettings, saved);
      setSuccess("Configuracoes do devedor salvas.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  const globalSummary = settings?.globalSettings;
  const effectiveSummary = settings?.effectiveSettings;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Configurar devedor
            </h2>
            <p className="mt-1 text-sm text-slate-500">{debtorName}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-5">
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

          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={18} />
              Carregando configuracoes do devedor
            </div>
          ) : (
            <>
              <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <label className="mb-4 flex items-start gap-3 border-b border-slate-200 pb-4">
                  <input
                    type="checkbox"
                    checked={whatsappOptIn}
                    onChange={(event) => {
                      setWhatsappOptIn(event.target.checked);
                      setSuccess(null);
                    }}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Opt-in WhatsApp oficial
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Autoriza templates de cobrança pela Meta Cloud API.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={useGlobalBillingSettings}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setUseGlobalBillingSettings(next);
                      if (settings) {
                        applySnapshot(next, settings);
                      }
                      setSuccess(null);
                    }}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Usar configuracao global da empresa
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Desmarque para definir metodo de pagamento e regras exclusivas para este devedor.
                    </p>
                  </div>
                </label>
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-5">
                  <section className="rounded-md border border-slate-200 bg-white">
                    <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                      <CreditCard size={18} className="text-emerald-600" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        Metodo de pagamento
                      </h3>
                    </div>

                    <div className="grid gap-3 p-4 md:grid-cols-3">
                      {BILLING_METHODS.map((method) => {
                        const active = preferredBillingMethod === method;
                        const tariffs = settings?.globalSettings.tariffs[method];

                        return (
                          <button
                            key={method}
                            type="button"
                            disabled={useGlobalBillingSettings}
                            onClick={() => {
                              setPreferredBillingMethod(method);
                              setSuccess(null);
                            }}
                            className={`rounded-md border px-4 py-4 text-left transition ${
                              active
                                ? "border-emerald-300 bg-emerald-50"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                            } disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400`}
                          >
                            <p className="text-sm font-semibold text-slate-900">
                              {getMethodLabel(method)}
                            </p>
                            <p className="mt-2 text-sm text-slate-600">
                              Efí: {tariffs?.efiLabel ?? "-"}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">
                              Plataforma: {tariffs?.platformLabel ?? "-"}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              Total: {estimateFee(method, settings?.globalSettings ?? {
                                preferredBillingMethod: "PIX",
                                collectionReminderDays: [0],
                                autoGenerateFirstCharge: true,
                                autoDiscountEnabled: false,
                                autoDiscountDaysAfterDue: null,
                                autoDiscountPercentage: null,
                                tariffs: settings?.globalSettings.tariffs ?? {
                                  PIX: {
                                    method: "PIX",
                                    efiLabel: "-",
                                    platformLabel: "-",
                                    combinedLabel: "-",
                                    efiKind: "fixed",
                                    efiValue: 0,
                                    platformFixedFee: 0,
                                  },
                                  BOLETO: {
                                    method: "BOLETO",
                                    efiLabel: "-",
                                    platformLabel: "-",
                                    combinedLabel: "-",
                                    efiKind: "fixed",
                                    efiValue: 0,
                                    platformFixedFee: 0,
                                  },
                                  BOLIX: {
                                    method: "BOLIX",
                                    efiLabel: "-",
                                    platformLabel: "-",
                                    combinedLabel: "-",
                                    efiKind: "fixed",
                                    efiValue: 0,
                                    platformFixedFee: 0,
                                  },
                                },
                              })}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-md border border-slate-200 bg-white">
                    <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                      <Settings2 size={18} className="text-emerald-600" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        Dias de cobranca
                      </h3>
                    </div>

                    <div className="space-y-4 p-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {QUICK_OFFSETS.map((offset) => {
                          const active = orderedOffsets.includes(offset);

                          return (
                            <button
                              key={offset}
                              type="button"
                              disabled={useGlobalBillingSettings}
                              onClick={() => toggleOffset(offset)}
                              className={`min-h-20 rounded-md border px-4 py-3 text-left transition ${
                                active
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              } disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400`}
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
                          disabled={useGlobalBillingSettings}
                          onChange={(event) => setCustomOffset(event.target.value)}
                          className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:max-w-52"
                          placeholder="-2, 0, 7..."
                        />
                        <button
                          type="button"
                          disabled={useGlobalBillingSettings}
                          onClick={addCustomOffset}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <CirclePlus size={18} />
                          Adicionar
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-md border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Primeira cobrança
                      </h3>
                    </div>

                    <div className="p-4">
                      <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                        <input
                          type="checkbox"
                          checked={autoGenerateFirstCharge}
                          disabled={useGlobalBillingSettings}
                          onChange={(event) => {
                            setAutoGenerateFirstCharge(event.target.checked);
                            setSuccess(null);
                          }}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            Gerar no cadastro deste devedor
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            Quando ativo, a primeira fatura já entra na fila de cobrança.
                          </p>
                        </div>
                      </label>
                    </div>
                  </section>

                  <section className="rounded-md border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Desconto automatico
                      </h3>
                    </div>

                    <div className="space-y-4 p-4">
                      <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                        <input
                          type="checkbox"
                          checked={autoDiscountEnabled}
                          disabled={useGlobalBillingSettings}
                          onChange={(event) => {
                            setAutoDiscountEnabled(event.target.checked);
                            setSuccess(null);
                          }}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            Ativar desconto individual
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            Essa regra passa a valer apenas para este devedor.
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
                            disabled={useGlobalBillingSettings || !autoDiscountEnabled}
                            onChange={(event) => {
                              setAutoDiscountDaysAfterDue(event.target.value);
                              setSuccess(null);
                            }}
                            className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
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
                              disabled={
                                useGlobalBillingSettings || !autoDiscountEnabled
                              }
                              onChange={(event) => {
                                setAutoDiscountPercentage(event.target.value);
                                setSuccess(null);
                              }}
                              className="h-11 w-full rounded-md border border-slate-300 px-3 pr-9 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                              %
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>
                  </section>
                </div>

                <aside className="space-y-5">
                  <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Regra global
                    </h3>
                    <p className="mt-3 text-sm text-slate-600">
                      Metodo:{" "}
                      {globalSummary
                        ? getMethodLabel(globalSummary.preferredBillingMethod)
                        : "-"}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Tarifa:{" "}
                      {globalSummary
                        ? globalSummary.tariffs[globalSummary.preferredBillingMethod]
                            .combinedLabel
                        : "-"}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Primeira cobrança:{" "}
                      {globalSummary?.autoGenerateFirstCharge ? "ativa" : "inativa"}
                    </p>
                  </section>

                  <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Regra efetiva
                    </h3>
                    <p className="mt-3 text-sm text-slate-600">
                      Metodo:{" "}
                      {effectiveSummary
                        ? getMethodLabel(effectiveSummary.preferredBillingMethod)
                        : "-"}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Tarifa:{" "}
                      {effectiveSummary
                        ? effectiveSummary.tariffs[effectiveSummary.preferredBillingMethod]
                            .combinedLabel
                        : "-"}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Dias:{" "}
                      {effectiveSummary?.collectionReminderDays
                        .map((offset) => formatOffset(offset))
                        .join(", ") || "-"}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Primeira cobrança:{" "}
                      {effectiveSummary?.autoGenerateFirstCharge
                        ? "ativa"
                        : "inativa"}
                    </p>
                    <div className="mt-4 space-y-2">
                      {orderedOffsets.map((offset) => (
                        <div
                          key={offset}
                          className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {formatOffset(offset)}
                            </p>
                            <p className="text-xs text-slate-500">
                              D{offset === 0 ? "" : offset > 0 ? `+${offset}` : offset}
                            </p>
                          </div>
                          {!useGlobalBillingSettings && (
                            <button
                              type="button"
                              onClick={() => removeOffset(offset)}
                              disabled={orderedOffsets.length === 1}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </aside>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={loading || saving}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            Salvar configuracoes
          </button>
        </div>
      </div>
    </div>
  );
}
