"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useApiClient } from "@/lib/use-api-client";
import type { ApiError } from "@/lib/api-client";
import {
  PROFILE_STATUS_LABELS,
  STEP_LABELS,
  STEP_STATUS_LABELS,
} from "@/lib/financial-activation";
import type {
  FinancialEnvironment,
  FinancialMethod,
  FinancialOverview,
  FinancialProfile,
} from "@/lib/financial-activation";

const METHODS: FinancialMethod[] = ["PIX", "BOLIX"];
const OPEN_STATUSES = ["DRAFT", "VALIDATING", "READY", "VALIDATION_FAILED"];

function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function date(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 space-y-3 text-sm text-slate-700">{children}</div>
    </section>
  );
}

function Input({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  readOnly,
  accept,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | null;
  required?: boolean;
  readOnly?: boolean;
  accept?: string;
  hint?: string;
}): ReactNode {
  const hintId = useId();
  return (
    <div>
      <label className="block font-medium text-slate-700">
        {label}
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-slate-900 read-only:bg-slate-100"
          name={name}
          type={type}
          defaultValue={defaultValue ?? undefined}
          required={required}
          readOnly={readOnly}
          accept={accept}
          autoComplete="off"
          aria-describedby={hint ? hintId : undefined}
        />
      </label>
      {hint && (
        <span id={hintId} className="mt-1 block text-xs text-slate-500">
          {hint}
        </span>
      )}
    </div>
  );
}

function MethodChoices({
  selected,
}: {
  selected: FinancialMethod[];
}): ReactNode {
  return (
    <fieldset>
      <legend className="font-medium">Meios de pagamento</legend>
      <div className="mt-1 flex gap-4">
        {METHODS.map((method) => (
          <label key={method} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="enabledMethods"
              value={method}
              defaultChecked={selected.includes(method)}
            />
            {method === "PIX" ? "Pix" : "Bolix"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ProfileSummary({ profile }: { profile: FinancialProfile }): ReactNode {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      <div>
        <dt className="text-slate-500">Conta Efí</dt>
        <dd>{profile.issuer?.efiAccountNumber ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Ambiente</dt>
        <dd>
          {profile.environment === "PRODUCTION" ? "Produção" : "Homologação"}
        </dd>
      </div>
      <div>
        <dt className="text-slate-500">Meios</dt>
        <dd>{profile.enabledMethods.join(", ")}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Certificado válido até</dt>
        <dd>{date(profile.credential?.certificateExpiresAt)}</dd>
      </div>
    </dl>
  );
}

export function FinancialActivationAdmin({
  companyId,
}: {
  companyId: string;
}): ReactNode {
  const api = useApiClient();
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replaceCredentials, setReplaceCredentials] = useState(false);
  const [confirmEffects, setConfirmEffects] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  // One key per intent, reused if the same request is retried.
  const createKey = useRef(newKey());
  const validationKey = useRef(newKey());
  const activationKey = useRef(newKey());

  const load = useCallback(async (): Promise<void> => {
    try {
      setOverview(await api.getFinancialOverview(companyId));
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível carregar a ativação financeira.",
      );
    }
  }, [api, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const candidate = overview?.candidate ?? null;
  const validation = candidate?.latestValidation ?? null;
  const validating =
    candidate?.status === "VALIDATING" ||
    validation?.status === "PENDING" ||
    validation?.status === "RUNNING";
  useEffect(() => {
    if (!validating) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [validating, load]);

  async function run(
    action: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
      return true;
    } catch (caught: unknown) {
      const apiError = caught as ApiError;
      const code = (apiError.data as { code?: string } | undefined)?.code;
      setError(
        code === "REVISION_CONFLICT"
          ? "A ativação foi alterada em outra tela. Os dados foram recarregados; revise e tente novamente."
          : caught instanceof Error
            ? caught.message
            : "Não foi possível concluir a operação.",
      );
      if (code === "REVISION_CONFLICT") await load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  function methodsOf(form: HTMLFormElement): FinancialMethod[] {
    return new FormData(form)
      .getAll("enabledMethods")
      .map(String) as FinancialMethod[];
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const enabledMethods = methodsOf(event.currentTarget);
    if (enabledMethods.length === 0) {
      setError("Escolha ao menos um meio de pagamento.");
      return;
    }
    const ok = await run(
      () =>
        api.createFinancialActivation(companyId, {
          idempotencyKey: createKey.current,
          environment: form.get("environment") as FinancialEnvironment,
          enabledMethods,
        }),
      "Ativação iniciada. Cadastre as credenciais da conta Efí do cliente.",
    );
    if (ok) createKey.current = newKey();
  }

  async function saveCredentials(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!candidate) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    // Take the file from the input itself and attach it explicitly.
    const input = element.elements.namedItem("certificate");
    const file =
      input instanceof HTMLInputElement ? input.files?.item(0) : null;
    if (!file || file.size === 0) {
      setError("Selecione o certificado .p12 da conta do cliente.");
      return;
    }
    form.set("certificate", file, file.name);
    form.set("expectedRevision", String(candidate.revision));
    for (const key of ["efiAccountDigit", "pixKey", "certificatePassword"])
      if (!String(form.get(key) ?? "").trim()) form.delete(key);
    const ok = await run(
      () => api.uploadFinancialCredentials(candidate.id, form),
      "Credenciais salvas. Elas não serão exibidas novamente.",
    );
    // Secrets never stay in the page, whatever the result.
    for (const name of ["clientSecret", "certificatePassword", "certificate"]) {
      const input = element.elements.namedItem(name);
      if (input instanceof HTMLInputElement) input.value = "";
    }
    if (ok) {
      element.reset();
      setReplaceCredentials(false);
    }
  }

  async function saveConfiguration(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!candidate || !overview) return;
    const form = new FormData(event.currentTarget);
    const enabledMethods = methodsOf(event.currentTarget);
    if (enabledMethods.length === 0) {
      setError("Escolha ao menos um meio de pagamento.");
      return;
    }
    const validUntil = String(form.get("authorizationValidUntil") ?? "");
    const attested = form.get("ownershipVerified") === "on";
    await run(
      () =>
        api.updateFinancialConfiguration(candidate.id, {
          expectedRevision: candidate.revision,
          enabledMethods,
          authorizationReference: String(form.get("authorizationReference")),
          ...(validUntil
            ? {
                authorizationValidUntil: new Date(
                  `${validUntil}T23:59:59`,
                ).toISOString(),
              }
            : {}),
          ...(attested
            ? {
                ownershipVerifiedDocument: overview.company.document,
                ownershipEvidenceReference: String(
                  form.get("ownershipEvidenceReference"),
                ),
              }
            : {}),
        }),
      "Configuração salva. Valide a integração novamente.",
    );
  }

  async function validate(): Promise<void> {
    if (!candidate) return;
    const ok = await run(
      () =>
        api.requestFinancialValidation(candidate.id, {
          expectedRevision: candidate.revision,
          idempotencyKey: validationKey.current,
        }),
      "Validação iniciada. O resultado aparece abaixo em instantes.",
    );
    if (ok) validationKey.current = newKey();
  }

  async function activate(): Promise<void> {
    if (!candidate || !validation) return;
    const ok = await run(
      () =>
        api.activateFinancialProfile(candidate.id, {
          expectedRevision: candidate.revision,
          validationAttemptId: validation.id,
          idempotencyKey: activationKey.current,
          confirmEffects: true,
          acknowledgeUnverifiedSteps: acknowledge,
        }),
      "Ativação financeira concluída.",
    );
    if (ok) {
      activationKey.current = newKey();
      setConfirmEffects(false);
      setAcknowledge(false);
    }
  }

  async function cancel(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!candidate) return;
    const reason = String(new FormData(event.currentTarget).get("reason"));
    await run(
      () =>
        api.cancelFinancialActivation(candidate.id, {
          expectedRevision: candidate.revision,
          reason,
        }),
      "Preparação cancelada e credenciais descartadas.",
    );
  }

  if (!overview)
    return (
      <div className="p-8" role={error ? "alert" : "status"}>
        {error ?? "Carregando ativação financeira…"}
      </div>
    );

  const hasCandidate =
    candidate !== null && OPEN_STATUSES.includes(candidate.status);
  const ready =
    candidate?.status === "READY" &&
    validation?.status === "SUCCEEDED" &&
    validation.profileRevision === candidate.revision &&
    Boolean(validation.validUntil) &&
    new Date(validation.validUntil ?? 0).getTime() > Date.now();
  const unverified =
    validation?.steps.filter((step) => step.status === "NOT_VERIFIABLE") ?? [];
  const missing = candidate
    ? [
        !candidate.credential && "credenciais",
        !candidate.authorization.reference && "referência da autorização",
        !candidate.ownership.verifiedAt && "atestação de titularidade",
        candidate.enabledMethods.includes("PIX") &&
          !candidate.issuer?.pixKey &&
          "chave Pix",
      ].filter(Boolean)
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-5 sm:p-8">
      <header>
        <Link
          href="/admin/clientes"
          className="text-sm text-emerald-700 underline"
        >
          Voltar aos clientes
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          Ativação financeira — {overview.company.corporateName}
        </h1>
        <p className="text-sm text-slate-500">
          Documento {overview.company.document}. A conta Efí é do cliente; a
          comissão CifraMais segue as tarifas vigentes.
        </p>
      </header>

      {!overview.manualActivationReleased && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          Novas ativações manuais estão pausadas. É possível preparar os dados,
          mas validar e ativar exigem liberar “Ativação financeira manual” em{" "}
          <Link
            href="/admin/efi-onboarding"
            className="font-semibold underline"
          >
            Ativações e saúde
          </Link>
          .
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      {overview.active && (
        <Section
          title={`Configuração ativa (versão ${overview.active.version})`}
        >
          <ProfileSummary profile={overview.active} />
          <p className="text-slate-500">
            Ativada em {date(overview.active.activatedAt)}. Uma nova ativação
            vale apenas para cobranças emitidas depois dela.
          </p>
        </Section>
      )}

      {!hasCandidate && (
        <Section title={overview.active ? "Nova versão" : "Iniciar ativação"}>
          <form className="space-y-4" onSubmit={(e) => void create(e)}>
            <fieldset>
              <legend className="font-medium">
                Conta que emite a cobrança
              </legend>
              <label className="mt-1 flex items-center gap-2">
                <input
                  type="radio"
                  name="accountMode"
                  defaultChecked
                  readOnly
                />
                Conta Efí do cliente (credenciais e certificado do cliente)
              </label>
              <label className="flex items-center gap-2 text-slate-400">
                <input type="radio" name="accountMode" disabled />
                Conta CifraMais com split ou repasse manual (em breve)
              </label>
            </fieldset>
            <label className="block font-medium">
              Ambiente
              <select
                name="environment"
                defaultValue="PRODUCTION"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5"
              >
                <option value="PRODUCTION">Produção</option>
                <option value="HOMOLOGATION">Homologação</option>
              </select>
            </label>
            <MethodChoices selected={METHODS} />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              Iniciar ativação
            </button>
          </form>
        </Section>
      )}

      {hasCandidate && candidate && (
        <>
          <p className="text-sm text-slate-600">
            Situação: <strong>{PROFILE_STATUS_LABELS[candidate.status]}</strong>{" "}
            ·{" "}
            {candidate.environment === "PRODUCTION"
              ? "Produção"
              : "Homologação"}{" "}
            · revisão {candidate.revision}
          </p>

          <Section title="1. Credenciais da conta Efí do cliente">
            {candidate.credential && !replaceCredentials ? (
              <>
                <p>
                  Credencial cadastrada (versão {candidate.credential.version})
                  para a conta {candidate.issuer?.efiAccountNumber}
                  {candidate.issuer?.pixKey
                    ? `, chave Pix ${candidate.issuer.pixKey}`
                    : ""}
                  .
                </p>
                <p className="break-all text-xs text-slate-500">
                  Certificado {candidate.credential.certificateFingerprint} ·
                  válido até {date(candidate.credential.certificateExpiresAt)}
                </p>
                <button
                  type="button"
                  className="text-emerald-700 underline"
                  onClick={() => setReplaceCredentials(true)}
                >
                  Substituir credenciais
                </button>
              </>
            ) : (
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => void saveCredentials(e)}
              >
                <Input
                  label="CPF/CNPJ do titular"
                  name="holderDocument"
                  defaultValue={overview.company.document}
                  readOnly
                  hint="Precisa ser o mesmo documento da empresa."
                />
                <Input
                  label="Número da conta Efí"
                  name="efiAccountNumber"
                  required
                />
                <Input label="Dígito da conta" name="efiAccountDigit" />
                <Input
                  label="Identificador de conta (payee_code)"
                  name="payeeCode"
                  required
                />
                <Input
                  label="Chave Pix de recebimento"
                  name="pixKey"
                  required={candidate.enabledMethods.includes("PIX")}
                />
                <Input label="Client ID" name="clientId" required />
                <Input
                  label="Client Secret"
                  name="clientSecret"
                  type="password"
                  required
                />
                <Input
                  label="Certificado (.p12)"
                  name="certificate"
                  type="file"
                  accept=".p12,.pfx,application/x-pkcs12"
                  // Presence is checked on submit with a clear message.
                  hint="Até 1 MiB. Enviado apenas ao servidor e guardado cifrado."
                />
                <Input
                  label="Senha do certificado (se houver)"
                  name="certificatePassword"
                  type="password"
                />
                <div className="flex gap-3 sm:col-span-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
                  >
                    Salvar credenciais
                  </button>
                  {candidate.credential && (
                    <button
                      type="button"
                      className="text-slate-600 underline"
                      onClick={() => setReplaceCredentials(false)}
                    >
                      Manter as atuais
                    </button>
                  )}
                </div>
              </form>
            )}
          </Section>

          <Section title="2. Autorização e titularidade">
            <form
              className="space-y-3"
              onSubmit={(e) => void saveConfiguration(e)}
            >
              <MethodChoices selected={candidate.enabledMethods} />
              <Input
                label="Referência da autorização do cliente (contrato ou documento)"
                name="authorizationReference"
                defaultValue={candidate.authorization.reference}
                required
              />
              <Input
                label="Validade da autorização (opcional)"
                name="authorizationValidUntil"
                type="date"
              />
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="ownershipVerified"
                  className="mt-1"
                />
                <span>
                  Conferi no painel da Efí que a conta pertence a{" "}
                  {overview.company.corporateName} ({overview.company.document}
                  ).
                </span>
              </label>
              <Input
                label="Onde está a evidência da conferência"
                name="ownershipEvidenceReference"
                defaultValue={candidate.ownership.evidenceReference}
                hint="Ex.: número do chamado ou pasta com a captura de tela."
              />
              {candidate.ownership.verifiedAt && (
                <p className="text-emerald-700">
                  Titularidade atestada em{" "}
                  {date(candidate.ownership.verifiedAt)}.
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Salvar
              </button>
            </form>
          </Section>

          <Section title="3. Validação da integração">
            <p>A validação consulta a Efí com as credenciais do cliente e:</p>
            <ul className="list-disc pl-5">
              {candidate.enabledMethods.includes("PIX") && (
                <>
                  <li>
                    configura o webhook Pix da chave{" "}
                    {candidate.issuer?.pixKey ?? "informada"} para a CifraMais;
                  </li>
                  <li>
                    grava uma configuração de split de validação (não cria
                    cobrança nem transfere dinheiro).
                  </li>
                </>
              )}
              {candidate.enabledMethods.includes("BOLIX") && (
                <li>
                  confere o acesso à API de Cobranças. A emissão de BOLIX só é
                  comprovável emitindo cobrança; teste-a em homologação.
                </li>
              )}
            </ul>
            {missing.length > 0 && (
              <p className="text-amber-800">Falta: {missing.join(", ")}.</p>
            )}
            <button
              type="button"
              disabled={
                busy ||
                validating ||
                missing.length > 0 ||
                !overview.manualActivationReleased
              }
              onClick={() => void validate()}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {validating ? "Validando…" : "Validar integração"}
            </button>
            {validation && (
              <table className="w-full text-left">
                <tbody>
                  {validation.steps.map((step) => (
                    <tr key={step.code} className="border-t border-slate-100">
                      <td className="py-1.5">
                        {STEP_LABELS[step.code] ?? step.code}
                      </td>
                      <td
                        className={
                          step.status === "FAILED"
                            ? "text-red-700"
                            : step.status === "PASSED"
                              ? "text-emerald-700"
                              : "text-slate-500"
                        }
                      >
                        {STEP_STATUS_LABELS[step.status]}
                        {step.errorCode ? ` (${step.errorCode})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {validation?.status === "FAILED" && (
              <p className="text-red-700">
                A validação falhou ({validation.errorCode}). Corrija os dados e
                valide novamente.
              </p>
            )}
          </Section>

          <Section title="4. Revisão e ativação">
            {!ready ? (
              <p className="text-slate-500">
                Disponível após uma validação aprovada (vale 15 minutos).
              </p>
            ) : (
              <>
                <ProfileSummary profile={candidate} />
                <p className="text-slate-500">
                  Validação válida até {date(validation?.validUntil)}.
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={confirmEffects}
                    onChange={(e) => setConfirmEffects(e.target.checked)}
                  />
                  <span>
                    Confirmo a ativação: as emissões desta empresa passam a usar
                    esta conta. Nenhuma cobrança ou mensagem é enviada agora; se
                    a régua estiver habilitada, ela pode voltar a atuar no
                    próximo ciclo.
                  </span>
                </label>
                {unverified.length > 0 && (
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={acknowledge}
                      onChange={(e) => setAcknowledge(e.target.checked)}
                    />
                    <span>
                      Estou ciente de que{" "}
                      {unverified
                        .map((step) => STEP_LABELS[step.code] ?? step.code)
                        .join(" e ")}{" "}
                      não podem ser comprovados sem emitir cobrança.
                    </span>
                  </label>
                )}
                <button
                  type="button"
                  disabled={
                    busy ||
                    !overview.manualActivationReleased ||
                    !confirmEffects ||
                    (unverified.length > 0 && !acknowledge)
                  }
                  onClick={() => void activate()}
                  className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  Ativar financeiro
                </button>
              </>
            )}
          </Section>

          <form
            className="flex flex-wrap items-end gap-3 rounded-xl border border-red-100 p-4 text-sm"
            onSubmit={(e) => void cancel(e)}
          >
            <Input label="Motivo do cancelamento" name="reason" required />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-red-300 px-4 py-2 font-semibold text-red-700 disabled:opacity-50"
            >
              Cancelar preparação
            </button>
          </form>
        </>
      )}
    </div>
  );
}
