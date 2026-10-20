"use client";
import { useFinancialActivation } from "@/components/features/financial-activation-context";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CreditCard,
  Loader2,
  Percent,
  Play,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Tag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  BillingMethod,
  BillingRunSummary,
  BillingSettings,
} from "@/lib/api-client";
import { getBillingMethodLabel } from "@/lib/billing-fees";
import { useApiClient } from "@/lib/use-api-client";
import { LateTermsFields } from "@/components/features/LateTermsFields";
import {
  describeLateTerms,
  EMPTY_LATE_TERMS,
  lateTermsFormFromValues,
  parseLateTermsForm,
  type LateTermsFormValues,
} from "@/lib/late-terms";

const BILLING_METHODS: BillingMethod[] = ["PIX", "BOLIX", "CREDIT_CARD"];

const SECTIONS = [
  { id: "pagamento", label: "Pagamento" },
  { id: "multa-juros", label: "Multa e juros" },
  { id: "desconto", label: "Desconto" },
  { id: "avisos", label: "Aviso de pagamento" },
  { id: "regua", label: "Régua de cobrança" },
];

const inputClass =
  "h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function getMethodDescription(method: BillingMethod): string {
  if (method === "PIX") {
    return "Tarifa Efí percentual e taxa percentual da plataforma.";
  }

  if (method === "CREDIT_CARD") {
    return "Tarifa da Efí no cartão e taxa percentual da plataforma.";
  }

  return "Tarifa fixa da Efí e taxa percentual da plataforma.";
}

function getErrorMessage(
  error: unknown,
  fallback = "Não foi possível salvar a configuração.",
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

function parseNotificationEmails(value: string): {
  emails: string[];
  invalid: string[];
} {
  const entries = value
    .split(/[\n,;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const uniqueEntries = Array.from(new Set(entries));
  const invalid = uniqueEntries.filter(
    (email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  );

  return {
    emails: uniqueEntries.filter((email) => !invalid.includes(email)),
    invalid,
  };
}

function Section({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <Icon size={18} />
          </span>
          <div>
            <h2 id={`${id}-title`} className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          </div>
        </div>
        {action}
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

/** A yes/no setting: a checkbox shown as a switch, named by its title and description. */
function Toggle({
  checked,
  disabled,
  title,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-slate-200 p-4 transition hover:bg-slate-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <span>
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-sm text-slate-500">{description}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="h-6 w-11 rounded-full bg-slate-300 transition after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:bg-emerald-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-300"
        />
      </span>
    </label>
  );
}

export default function BillingSettingsPage() {
  const {canIssue}=useFinancialActivation();
  const apiClient = useApiClient();
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [preferredBillingMethod, setPreferredBillingMethod] =
    useState<BillingMethod>("PIX");
  const [autoGenerateFirstCharge, setAutoGenerateFirstCharge] = useState(true);
  const [autoDiscountEnabled, setAutoDiscountEnabled] = useState(false);
  const [autoDiscountDaysAfterDue, setAutoDiscountDaysAfterDue] = useState("0");
  const [autoDiscountPercentage, setAutoDiscountPercentage] = useState("");
  const [lateTerms, setLateTerms] =
    useState<LateTermsFormValues>(EMPTY_LATE_TERMS);
  const [paymentNotificationEnabled, setPaymentNotificationEnabled] =
    useState(true);
  const [paymentNotificationEmails, setPaymentNotificationEmails] =
    useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [runningBilling, setRunningBilling] = useState(false);
  const [billingRunResult, setBillingRunResult] =
    useState<BillingRunSummary | null>(null);
  const [billingRunMessage, setBillingRunMessage] = useState<string | null>(
    null,
  );
  const [billingRunError, setBillingRunError] = useState<string | null>(null);

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
        setPreferredBillingMethod(
          response.enabledBillingMethods.includes(response.preferredBillingMethod)
            ? response.preferredBillingMethod
            : (response.enabledBillingMethods[0] ?? "PIX"),
        );
        setAutoGenerateFirstCharge(response.autoGenerateFirstCharge);
        setAutoDiscountEnabled(response.autoDiscountEnabled);
        setAutoDiscountDaysAfterDue(
          String(response.autoDiscountDaysAfterDue ?? 0),
        );
        setAutoDiscountPercentage(
          response.autoDiscountPercentage?.toString() ?? "",
        );
        setLateTerms(lateTermsFromSettings(response));
        setPaymentNotificationEnabled(response.paymentNotificationEnabled);
        setPaymentNotificationEmails(
          response.paymentNotificationEmails.join("\n"),
        );
        setDirty(false);
      } catch (loadError) {
        if (active) {
          setError(
            getErrorMessage(
              loadError,
              "Não foi possível carregar as configurações.",
            ),
          );
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
  }, [apiClient, reloadKey]);

  /** Any edit: the last "saved" message no longer describes the form. */
  function touch(): void {
    setSuccess(null);
    setDirty(true);
  }

  async function saveSettings(): Promise<void> {
    // Without the loaded settings the form holds only defaults; saving would overwrite them.
    if (!settings) return;
    const parsedDiscountDays = Number(autoDiscountDaysAfterDue);
    const parsedDiscountPercentage = Number(autoDiscountPercentage);

    if (autoDiscountEnabled) {
      if (
        !Number.isInteger(parsedDiscountDays) ||
        parsedDiscountDays < 0 ||
        parsedDiscountDays > 365
      ) {
        setError("Informe em quantos dias após o vencimento o desconto vale.");
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

    // Company defaults: an empty fine or interest means none.
    const parsedLateTerms = parseLateTermsForm(lateTerms);
    if ("error" in parsedLateTerms) {
      setError(parsedLateTerms.error);
      return;
    }
    if (parsedLateTerms.terms.days === null) {
      setError("Informe quantos dias após o vencimento o pagamento é aceito.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const parsedEmails = parseNotificationEmails(paymentNotificationEmails);

      if (parsedEmails.invalid.length > 0) {
        setError(`E-mail inválido: ${parsedEmails.invalid[0]}`);
        setSaving(false);
        return;
      }

      const saved = await apiClient.updateBillingSettings({
        preferredBillingMethod,
        collectionReminderDays: settings.collectionReminderDays ?? [0],
        autoGenerateFirstCharge,
        autoDiscountEnabled,
        autoDiscountDaysAfterDue: autoDiscountEnabled
          ? parsedDiscountDays
          : null,
        autoDiscountPercentage: autoDiscountEnabled
          ? Number(parsedDiscountPercentage.toFixed(2))
          : null,
        paymentNotificationEnabled,
        paymentNotificationEmails: parsedEmails.emails,
        lateFinePercentage: parsedLateTerms.terms.fine ?? 0,
        lateInterestMonthlyPercentage: parsedLateTerms.terms.interest ?? 0,
        paymentDaysAfterDue: parsedLateTerms.terms.days,
      });

      setSettings(saved);
      setPreferredBillingMethod(
        saved.enabledBillingMethods.includes(saved.preferredBillingMethod)
          ? saved.preferredBillingMethod
          : (saved.enabledBillingMethods[0] ?? "PIX"),
      );
      setAutoGenerateFirstCharge(saved.autoGenerateFirstCharge);
      setAutoDiscountEnabled(saved.autoDiscountEnabled);
      setAutoDiscountDaysAfterDue(String(saved.autoDiscountDaysAfterDue ?? 0));
      setAutoDiscountPercentage(saved.autoDiscountPercentage?.toString() ?? "");
      setLateTerms(lateTermsFromSettings(saved));
      setPaymentNotificationEnabled(saved.paymentNotificationEnabled);
      setPaymentNotificationEmails(saved.paymentNotificationEmails.join("\n"));
      setDirty(false);
      setSuccess("Configurações salvas.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runBillingNow(): Promise<void> {
    if(!canIssue)return;
    setRunningBilling(true);
    setBillingRunError(null);
    setBillingRunMessage(null);
    setBillingRunResult(null);

    try {
      const response = await apiClient.runBilling();
      setBillingRunResult(response.summary);
      setBillingRunMessage(response.message);
      setSuccess(null);
    } catch (runError) {
      setBillingRunError(
        getErrorMessage(
          runError,
          "Não foi possível executar a régua de cobrança.",
        ),
      );
    } finally {
      setRunningBilling(false);
    }
  }

  const enabledBillingMethods = settings?.enabledBillingMethods.length
    ? settings.enabledBillingMethods.filter((method) => method !== "BOLETO")
    : ["BOLIX"];
  const busy = loading || saving;

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            Configurações
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Geral
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Padrões da empresa para as novas cobranças: forma de pagamento,
            multa, juros, desconto e avisos.
          </p>
        </header>

        {loading && !settings ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white p-10 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={18} />
            Carregando configurações...
          </div>
        ) : !settings ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 shrink-0" size={18} />
              {error ?? "Não foi possível carregar as configurações."}
            </span>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 font-semibold text-red-800 transition hover:bg-red-100"
            >
              <RefreshCw size={16} />
              Tentar novamente
            </button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
            <nav aria-label="Seções" className="hidden lg:block">
              <ul className="sticky top-6 space-y-1 text-sm">
                {SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded-md px-3 py-2 text-slate-600 transition hover:bg-white hover:text-slate-900"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0 space-y-6">
              <Section
                id="pagamento"
                icon={CreditCard}
                title="Forma de pagamento"
                description="Usada nas novas cobranças. A tarifa da Efí é informativa; a taxa da plataforma é a configurada para a sua empresa."
              >
                <div
                  role="group"
                  aria-label="Forma de pagamento padrão"
                  className="grid gap-3 md:grid-cols-3"
                >
                  {BILLING_METHODS.map((method) => {
                    const active = preferredBillingMethod === method;
                    const tariff = settings.tariffs[method];
                    const enabled = enabledBillingMethods.includes(method);

                    return (
                      <button
                        key={method}
                        type="button"
                        aria-pressed={active}
                        disabled={!enabled || busy}
                        onClick={() => {
                          if (!enabled) return;
                          setPreferredBillingMethod(method);
                          touch();
                        }}
                        className={`relative rounded-md border p-4 text-left transition ${
                          active
                            ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                            : enabled
                              ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                              : "cursor-not-allowed border-dashed border-slate-200 bg-slate-50 text-slate-400"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-semibold ${enabled ? "text-slate-900" : "text-slate-500"}`}>
                            {getBillingMethodLabel(method)}
                          </span>
                          {active && (
                            <CheckCircle2 size={18} className="text-emerald-600" />
                          )}
                        </span>
                        <span className="mt-2 block text-sm text-slate-600">
                          Taxa: {tariff?.combinedLabel ?? "Não configurada"}
                        </span>
                        <span className="mt-2 block text-xs text-slate-500">
                          {enabled
                            ? getMethodDescription(method)
                            : "Não liberado para a sua empresa"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <Toggle
                  checked={autoGenerateFirstCharge}
                  disabled={busy}
                  title="Enviar a primeira cobrança no cadastro"
                  description="Gera e enfileira a primeira cobrança assim que a fatura é cadastrada. Importações grandes passam pela fila com intervalo entre as mensagens."
                  onChange={(checked) => {
                    setAutoGenerateFirstCharge(checked);
                    touch();
                  }}
                />
              </Section>

              <Section
                id="multa-juros"
                icon={Percent}
                title="Multa, juros e prazo após o vencimento"
                description="Padrão das novas cobranças. Cada cobrança pode alterar esses valores; mudar aqui não altera cobranças já emitidas."
              >
                <LateTermsFields
                  idPrefix="company-late-terms"
                  values={lateTerms}
                  disabled={busy}
                  onChange={(values) => {
                    setLateTerms(values);
                    touch();
                  }}
                />
                <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Novas cobranças:{" "}
                  {describeLateTerms({
                    fine: Number(lateTerms.fine.replace(",", ".")) || 0,
                    interest: Number(lateTerms.interest.replace(",", ".")) || 0,
                    days: Number(lateTerms.days) || 0,
                  })}
                  .
                </p>
                <p className="text-xs text-slate-500">
                  Para devedor pessoa física, o Código de Defesa do Consumidor
                  limita a multa a 2%.
                </p>
              </Section>

              <Section
                id="desconto"
                icon={Tag}
                title="Desconto automático"
                description="Desativado por padrão. Quando ativo, as novas cobranças saem com esta regra de desconto."
              >
                <Toggle
                  checked={autoDiscountEnabled}
                  disabled={busy}
                  title="Ativar desconto automático"
                  description={
                    autoDiscountEnabled
                      ? `${autoDiscountPercentage || "0"}% de desconto até ${autoDiscountDaysAfterDue || "0"} dia(s) após o vencimento.`
                      : "Nenhum desconto automático configurado."
                  }
                  onChange={(checked) => {
                    setAutoDiscountEnabled(checked);
                    touch();
                  }}
                />

                {autoDiscountEnabled && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Dias após o vencimento
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        step={1}
                        value={autoDiscountDaysAfterDue}
                        onChange={(event) => {
                          setAutoDiscountDaysAfterDue(event.target.value);
                          touch();
                        }}
                        className={inputClass}
                        placeholder="Ex: 3"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span id="auto-discount-percentage-label" className="text-xs font-semibold uppercase text-slate-500">
                        Percentual de desconto
                      </span>
                      <div className="relative">
                        <input
                          type="number"
                          aria-labelledby="auto-discount-percentage-label"
                          min={0.01}
                          max={100}
                          step={0.01}
                          value={autoDiscountPercentage}
                          onChange={(event) => {
                            setAutoDiscountPercentage(event.target.value);
                            touch();
                          }}
                          className={`${inputClass} w-full pr-9`}
                          placeholder="Ex: 10"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                          %
                        </span>
                      </div>
                    </label>
                  </div>
                )}
              </Section>

              <Section
                id="avisos"
                icon={BellRing}
                title="Aviso de pagamento recebido"
                description="Quem recebe um e-mail na hora em que uma fatura é paga. O histórico continua em Baixas."
              >
                <Toggle
                  checked={paymentNotificationEnabled}
                  disabled={busy}
                  title="Enviar e-mail imediato"
                  description={
                    paymentNotificationEnabled
                      ? "Avisos ativos."
                      : "Avisos pausados: os pagamentos só aparecem em Baixas."
                  }
                  onChange={(checked) => {
                    setPaymentNotificationEnabled(checked);
                    touch();
                  }}
                />

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Destinatários
                  </span>
                  <textarea
                    rows={3}
                    value={paymentNotificationEmails}
                    disabled={busy}
                    onChange={(event) => {
                      setPaymentNotificationEmails(event.target.value);
                      touch();
                    }}
                    placeholder={"financeiro@empresa.com\nsecretaria@empresa.com"}
                    aria-describedby="payment-notification-emails-help"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100"
                  />
                  <span id="payment-notification-emails-help" className="text-xs text-slate-500">
                    Um e-mail por linha. Se ficar vazio, usamos o e-mail
                    principal da empresa.
                  </span>
                </label>
              </Section>

              <Section
                id="regua"
                icon={SlidersHorizontal}
                title="Régua de cobrança"
                description="Os dias, canais e janelas de envio ficam nos perfis da régua."
                action={
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link
                      href="/configuracoes/regua"
                      className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      Configurar perfis e etapas
                    </Link>
                    <button
                      type="button"
                      onClick={() => void runBillingNow()}
                      disabled={!canIssue || runningBilling}
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
                }
              >
                <p className="text-sm text-slate-500">
                  &quot;Executar agora&quot; enfileira na hora as cobranças
                  elegíveis, conforme os perfis e etapas configurados.
                </p>

                {billingRunError && (
                  <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                    <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                    <span>{billingRunError}</span>
                  </div>
                )}

                {billingRunResult && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
                      <span>
                        {billingRunMessage ?? "Régua de cobrança executada."}
                      </span>
                    </div>
                    <dl className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                        <dt className="text-xs font-semibold uppercase text-slate-500">
                          Avaliadas
                        </dt>
                        <dd className="mt-2 text-2xl font-bold text-slate-950">
                          {billingRunResult.total}
                        </dd>
                      </div>
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                        <dt className="text-xs font-semibold uppercase text-emerald-700">
                          Enfileiradas
                        </dt>
                        <dd className="mt-2 text-2xl font-bold text-emerald-800">
                          {billingRunResult.queued}
                        </dd>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                        <dt className="text-xs font-semibold uppercase text-amber-700">
                          Puladas
                        </dt>
                        <dd className="mt-2 text-2xl font-bold text-amber-800">
                          {billingRunResult.skipped}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </Section>

              {/* Kept in view while scrolling, so saving never needs a trip back to the top. */}
              <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:shadow-sm">
                {error && (
                  <p role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                    <AlertTriangle className="mt-0.5 shrink-0" size={16} />
                    {error}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm" aria-live="polite">
                    {success ? (
                      <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                        <CheckCircle2 size={16} />
                        {success}
                      </span>
                    ) : dirty ? (
                      <span className="font-medium text-amber-700">
                        Alterações não salvas
                      </span>
                    ) : (
                      <span className="text-slate-500">Nenhuma alteração</span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveSettings()}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <Save size={18} />
                    )}
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function lateTermsFromSettings(settings: BillingSettings): LateTermsFormValues {
  return lateTermsFormFromValues({
    fine: settings.lateFinePercentage ?? 0,
    interest: settings.lateInterestMonthlyPercentage ?? 0,
    days: settings.paymentDaysAfterDue ?? 30,
  });
}
