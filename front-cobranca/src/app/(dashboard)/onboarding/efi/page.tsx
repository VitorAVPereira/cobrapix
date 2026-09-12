"use client";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useApiClient } from "@/lib/use-api-client";
import { useFinancialActivation } from "@/components/features/financial-activation-context";
import { EFI_STATUS_LABELS } from "@/lib/efi-onboarding";
import type { EfiDraftInput } from "@/lib/efi-onboarding";

function Field({
  name,
  label,
  value = "",
  type = "text",
  maxLength = 160,
}: {
  name: string;
  label: string;
  value?: string | null;
  type?: string;
  maxLength?: number;
}): ReactNode {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900 focus:ring-2 focus:ring-emerald-500"
        name={name}
        type={type}
        defaultValue={value ?? ""}
        maxLength={maxLength}
        autoComplete="off"
      />
    </label>
  );
}
const actionLabels: Record<string, string> = {
  EFI_DRAFT_SAVED: "Rascunho salvo",
  EFI_DRAFT_CONSENTED: "Autorizações registradas",
  EFI_SUBMITTED: "Solicitação enviada à Efí",
  EFI_ACCOUNT_OPENED: "Conta aprovada; configuração iniciada",
  EFI_ACCOUNT_REFUSED: "Recusa registrada",
  EFI_ACCOUNT_ACTIVATED: "Conta validada e ativada",
  EFI_ADMIN_RETRY_PROVISIONING: "Nova validação solicitada",
  EFI_ADMIN_MANUAL_RECOVERY: "Recuperação assistida pela CifraMais",
};

export default function EfiOnboardingPage(): ReactNode {
  const api = useApiClient();
  const router = useRouter();
  const { data: session } = useSession();
  const {
    state,
    loading,
    error: loadError,
    refresh,
  } = useFinancialActivation();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!state) return;
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const action =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
        "data-action",
      ) ?? "save";
    const text = (key: string): string | undefined => {
      const value = data.get(key);
      return typeof value === "string" && value.trim()
        ? value.trim()
        : undefined;
    };
    const digits = (key: string): string | undefined =>
      text(key)?.replace(/\D/g, "");
    const input: EfiDraftInput = { revision: state.revision };
    if (step === 0) {
      input.corporateName = text("corporateName");
      input.tradeName = text("tradeName");
      input.document = digits("document");
      input.address = {
        postalCode: digits("postalCode"),
        street: text("street"),
        number: text("number"),
        district: text("district"),
        city: text("city"),
        state: text("state")?.toUpperCase(),
      };
    }
    if (step === 1) {
      const representative = {
        name: text("name"),
        cpf: digits("cpf"),
        birthDate: text("birthDate"),
        motherName: text("motherName"),
        email: text("email"),
        phone: digits("phone"),
      };
      if (Object.values(representative).some(Boolean))
        input.representative = representative;
    }
    if (
      step === 2 &&
      data.get("authorized") &&
      data.get("terms") &&
      data.get("privacy")
    )
      input.consent = {
        authorized: true,
        termsAccepted: true,
        privacyAccepted: true,
        authorizationVersion: state.legalVersions.authorization,
        termsVersion: state.legalVersions.terms,
        privacyVersion: state.legalVersions.privacy,
      };
    try {
      if (action === "submit" && !input.consent)
        throw new Error(
          "Confirme as três declarações antes de solicitar a ativação.",
        );
      const savedState = await api.saveEfiDraft(input);
      if (action === "submit")
        await api.submitEfiOnboarding(savedState.actions.canRetry);
      await refresh();
      if (action === "next") setStep((value) => Math.min(2, value + 1));
      if (action === "later") router.push("/cobrancas");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (session?.user.role === "PLATFORM_ADMIN")
    return (
      <div className="p-8">
        <Link
          href="/admin/efi-onboarding"
          className="text-emerald-700 underline"
        >
          Acompanhar ativações no painel administrativo
        </Link>
      </div>
    );
  if (loading && !state)
    return (
      <p className="p-8" role="status">
        Carregando sua ativação…
      </p>
    );
  if (!state)
    return (
      <div className="p-8" role="alert">
        {loadError ?? "Ativação indisponível."}
        <button className="ml-4 underline" onClick={() => void refresh()}>
          Tentar novamente
        </button>
      </div>
    );
  const company = state.company;
  return (
    <div className="mx-auto max-w-5xl p-5 sm:p-8 space-y-6">
      <header>
        <p className="text-sm font-semibold text-emerald-700">
          CifraMais + Efí Bank
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-slate-900">
          Ative seus recebimentos
        </h1>
        <p className="mt-2 text-slate-600">
          Prepare sua conta para receber por Bolix e Pix. A conta Efí
          pertence à sua empresa.
        </p>
      </header>
      <section
        className="rounded-xl border border-slate-200 bg-white p-5"
        aria-label="Situação da ativação"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">
            {EFI_STATUS_LABELS[state.status]}
          </h2>
          <button
            className="text-sm text-emerald-700 underline"
            onClick={() => void refresh()}
          >
            Atualizar situação
          </button>
        </div>
        {state.reason && <p className="mt-2 text-slate-700">{state.reason}</p>}
        {state.retryBlockedUntil && state.status === "REFUSED" && (
          <p className="mt-2 text-sm text-slate-600">
            Uma nova solicitação poderá ser feita após{" "}
            {new Date(state.retryBlockedUntil).toLocaleString("pt-BR")}, com
            correção e novo consentimento.
          </p>
        )}
        {state.lastReminderAt && (
          <p className="mt-2 text-sm text-slate-600">
            Último lembrete:{" "}
            {new Date(state.lastReminderAt).toLocaleString("pt-BR")}.
          </p>
        )}
        {state.status === "ACTIVE" && (
          <p className="mt-3 text-emerald-800">
            Conta ativada. Seus rascunhos permanecem salvos; escolha quando
            emitir cada cobrança.
          </p>
        )}
        {!state.actions.canEdit && state.status !== "ACTIVE" && (
          <p className="mt-3 text-sm text-slate-600">
            Acompanhe esta página. O cadastro fica protegido durante o
            processamento e a CifraMais acompanha eventuais pendências.
          </p>
        )}
      </section>
      {state.actions.canEdit && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
          <ol className="mb-7 flex gap-3 text-sm">
            {[
              "Empresa e endereço",
              "Representante",
              "Revisão e autorização",
            ].map((label, index) => (
              <li
                key={label}
                className={`flex-1 border-b-2 pb-3 ${step === index ? "border-emerald-600 font-semibold text-emerald-800" : "border-slate-200 text-slate-500"}`}
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>
          <form
            key={`${state.revision}-${step}`}
            onSubmit={(event) => void save(event)}
            className="space-y-6"
            autoComplete="off"
          >
            <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
              {step === 0 && (
                <>
                  <legend className="sr-only">Empresa e endereço</legend>
                  <Field
                    name="corporateName"
                    label="Razão social (beneficiário)"
                    value={company.corporateName}
                  />
                  <Field
                    name="tradeName"
                    label="Nome fantasia para as mensagens"
                    value={company.tradeName}
                  />
                  <Field
                    name="document"
                    label="CNPJ"
                    value={company.document}
                    maxLength={18}
                  />
                  <Field
                    name="postalCode"
                    label="CEP"
                    value={company.addressPostalCode}
                    maxLength={9}
                  />
                  <Field
                    name="street"
                    label="Logradouro"
                    value={company.addressStreet}
                  />
                  <Field
                    name="number"
                    label="Número"
                    value={company.addressNumber}
                    maxLength={20}
                  />
                  <Field
                    name="district"
                    label="Bairro"
                    value={company.addressDistrict}
                  />
                  <Field
                    name="city"
                    label="Cidade"
                    value={company.addressCity}
                  />
                  <Field
                    name="state"
                    label="UF"
                    value={company.addressState}
                    maxLength={2}
                  />
                </>
              )}
              {step === 1 && (
                <>
                  <legend className="sr-only">Representante autorizado</legend>
                  <p className="sm:col-span-2 text-sm text-slate-600">
                    O representante pode ser outra pessoa autorizada pela
                    empresa.{" "}
                    {state.representativeProvided
                      ? "Os dados já estão salvos com proteção. Preencha somente o que deseja corrigir."
                      : "Informe os dados completos para a Efí."}
                  </p>
                  <Field name="name" label="Nome completo" />
                  <Field name="cpf" label="CPF" maxLength={14} />
                  <Field
                    name="birthDate"
                    label="Data de nascimento"
                    type="date"
                  />
                  <Field name="motherName" label="Nome completo da mãe" />
                  <Field
                    name="email"
                    label="E-mail do representante"
                    type="email"
                  />
                  <Field
                    name="phone"
                    label="WhatsApp com DDD"
                    type="tel"
                    maxLength={20}
                  />
                </>
              )}
              {step === 2 && (
                <div className="sm:col-span-2 space-y-4">
                  <p>
                    <strong>{company.corporateName}</strong> · CNPJ{" "}
                    {company.document}
                  </p>
                  <p className="text-sm text-slate-600">
                    {state.representativeProvided
                      ? "Dados do representante salvos."
                      : "Os dados do representante ainda precisam ser preenchidos."}{" "}
                    Primeiro enviaremos um aviso pelo WhatsApp da CifraMais. Em
                    seguida, a Efí solicitará a confirmação do representante.
                  </p>
                  <label className="flex gap-3 items-start">
                    <input name="authorized" type="checkbox" className="mt-1" />
                    <span>
                      Declaro que tenho autorização para solicitar a integração
                      da conta Efí desta empresa e fornecer os dados do
                      representante. Autorizo a configuração de recebimentos,
                      webhooks e divisão da taxa CifraMais.{" "}
                      <small className="block text-slate-500">
                        Versão {state.legalVersions.authorization}
                      </small>
                    </span>
                  </label>
                  <label className="flex gap-3 items-start">
                    <input name="terms" type="checkbox" className="mt-1" />
                    <span>
                      Li e aceito os{" "}
                      <Link
                        target="_blank"
                        className="underline text-emerald-700"
                        href="/onboarding/termos"
                      >
                        termos de uso da integração
                      </Link>
                      .{" "}
                      <small className="block text-slate-500">
                        Versão {state.legalVersions.terms}
                      </small>
                    </span>
                  </label>
                  <label className="flex gap-3 items-start">
                    <input name="privacy" type="checkbox" className="mt-1" />
                    <span>
                      Li e aceito a{" "}
                      <Link
                        target="_blank"
                        className="underline text-emerald-700"
                        href="/onboarding/privacidade"
                      >
                        política de privacidade
                      </Link>
                      .{" "}
                      <small className="block text-slate-500">
                        Versão {state.legalVersions.privacy}
                      </small>
                    </span>
                  </label>
                </div>
              )}
            </fieldset>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                disabled={busy}
                type="submit"
                data-action={step < 2 ? "next" : "submit"}
                className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                {busy
                  ? "Salvando…"
                  : step < 2
                    ? "Salvar e continuar"
                    : "Autorizar e solicitar ativação"}
              </button>
              <button
                disabled={busy}
                data-action="later"
                type="submit"
                className="rounded-lg border border-slate-300 px-4 py-3"
              >
                Salvar e concluir depois
              </button>
              {step > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  className="px-3 py-3 text-slate-600"
                  onClick={() => setStep((value) => value - 1)}
                >
                  Voltar
                </button>
              )}
            </div>
          </form>
        </section>
      )}
      {state.timeline.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">
            Histórico da ativação
          </h2>
          <ol className="mt-4 space-y-4 border-l-2 border-emerald-100 pl-5">
            {state.timeline.map((item, index) => (
              <li key={`${item.createdAt}-${index}`}>
                <p className="text-sm font-medium">
                  {actionLabels[item.action] ??
                    "Situação atualizada pela CifraMais"}
                </p>
                <time className="text-xs text-slate-500">
                  {new Date(item.createdAt).toLocaleString("pt-BR")}
                </time>
              </li>
            ))}
          </ol>
        </section>
      )}
      <Link
        href="/cobrancas"
        className="inline-block text-sm text-slate-600 underline"
      >
        Voltar para meus cadastros e cobranças
      </Link>
    </div>
  );
}
