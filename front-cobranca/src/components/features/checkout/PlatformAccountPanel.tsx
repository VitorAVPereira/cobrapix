"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Landmark, Loader2 } from "lucide-react";
import type { CheckoutPlatformView } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { errorCode, formatDateTime } from "@/lib/disbursements";
import { formatPercentageBps } from "@/lib/billing-fees";
import { parsePercentToBps } from "@/lib/checkout";
import { PlatformCardForm } from "./PlatformCardForm";
import { buttonClass, Field, inputClass, messageOf, NoticeText, secondaryButtonClass, type Notice, loadFailed } from "./ui";

const CREDENTIAL_STATUS: Record<string, string> = {
  CANDIDATE: "aguardando validação",
  ACTIVE: "em uso",
  RETIRED: "substituída",
  REJECTED: "recusada",
};

function CredentialsForm({ onSaved }: { onSaved: () => void }) {
  const api = useApiClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    setSaving(true);
    try {
      await api.uploadCheckoutPlatformCredentials(new FormData(form));
      // Secrets never stay on screen after being sent.
      form.reset();
      onSaved();
    } catch (caught) {
      setError(messageOf(caught, "Não foi possível salvar as credenciais."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" autoComplete="off">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Ambiente">
          <select name="environment" className={inputClass} defaultValue="PRODUCTION">
            <option value="PRODUCTION">Produção</option>
            <option value="HOMOLOGATION">Homologação</option>
          </select>
        </Field>
        <Field label="CNPJ da Cifra+">
          <input name="holderDocument" className={inputClass} inputMode="numeric" pattern="\d{14}" required />
        </Field>
        <Field label="Número da conta Efí">
          <input name="efiAccountNumber" className={inputClass} inputMode="numeric" required />
        </Field>
        <Field label="Código do recebedor (payee code)">
          <input name="payeeCode" className={inputClass} required />
        </Field>
        <Field label="Chave Pix da conta">
          <input name="pixKey" className={inputClass} required />
        </Field>
        <Field label="Client ID">
          <input name="clientId" className={inputClass} required />
        </Field>
        <Field label="Client Secret">
          <input name="clientSecret" type="password" className={inputClass} required />
        </Field>
        <Field label="Certificado (.p12)">
          <input name="certificate" type="file" accept=".p12,application/x-pkcs12" className="text-sm" required />
        </Field>
        <Field label="Senha do certificado" hint="Opcional.">
          <input name="certificatePassword" type="password" className={inputClass} />
        </Field>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" className={buttonClass} disabled={saving}>
        {saving && <Loader2 size={16} className="animate-spin" />}
        Salvar credenciais
      </button>
    </form>
  );
}

/** The CifraMais Efí account the checkout receives in, and its Pix tariff. */
export function PlatformAccountPanel() {
  const api = useApiClient();
  const [view, setView] = useState<CheckoutPlatformView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [webhookInUse, setWebhookInUse] = useState<string | null>(null);
  const [fee, setFee] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api
      .getCheckoutPlatformAccount(controller.signal)
      .then((result) => setView(result))
      .catch((caught: unknown) => {
        if (loadFailed(controller.signal, caught)) setLoadError(messageOf(caught, "Não foi possível carregar a conta."));
      });
    return () => controller.abort();
  }, [api, reload]);

  function refresh(next: Notice) {
    setNotice(next);
    setLoadError(null);
    setReload((value) => value + 1);
  }

  async function validate(confirmOverwrite: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      setView(await api.validateCheckoutPlatformAccount(confirmOverwrite));
      setWebhookInUse(null);
      setNotice({ error: false, text: "Conta validada e webhook Pix ligado." });
    } catch (caught) {
      if (errorCode(caught) === "PIX_WEBHOOK_IN_USE") {
        const data = (caught as { data?: { currentUrl?: unknown } }).data;
        setWebhookInUse(typeof data?.currentUrl === "string" ? data.currentUrl : "outro endereço");
      } else setNotice({ error: true, text: messageOf(caught, "A validação falhou.") });
    } finally {
      setBusy(false);
    }
  }

  async function saveFee(event: FormEvent) {
    event.preventDefault();
    const bps = parsePercentToBps(fee);
    if (bps === null || bps > 1000 || !view?.current) {
      setNotice({ error: true, text: "Informe a tarifa em %, de 0 a 10, como 1,19." });
      return;
    }
    setBusy(true);
    try {
      setView(await api.setCheckoutPlatformPixFee({ expectedVersion: view.current.version, pixFeeBasisPoints: bps }));
      setFee("");
      setNotice({ error: false, text: "Tarifa salva em uma nova versão." });
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED")
        refresh({ error: true, text: "Outra pessoa alterou a conta. Os dados foram recarregados." });
      else setNotice({ error: true, text: messageOf(caught, "Não foi possível salvar a tarifa.") });
    } finally {
      setBusy(false);
    }
  }

  const identity = view?.identity;
  const latest = identity?.credentialVersions[0];
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <Landmark size={18} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Conta Efí da Cifra+</h2>
          <p className="text-sm text-slate-500">Onde o checkout recebe os Pix. Sem ela validada e com tarifa, o checkout não vende.</p>
        </div>
      </header>

      {loadError ? (
        <p role="alert" className="text-sm text-red-600">{loadError}</p>
      ) : !view ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Carregando…</p>
      ) : (
        <>
          <p className={`flex items-center gap-2 text-sm font-medium ${view.ready ? "text-emerald-700" : "text-amber-700"}`}>
            {view.ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {view.ready ? "Pronta para vender" : "Ainda não está pronta para vender"}
          </p>
          {identity && (
            <dl className="grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
              <div>Ambiente: {identity.environment === "PRODUCTION" ? "Produção" : "Homologação"}</div>
              <div>Conta: {identity.efiAccountNumber}</div>
              <div>Chave Pix: {identity.pixKey ?? "—"}</div>
              <div>
                Credencial: {latest ? `versão ${latest.version}, ${CREDENTIAL_STATUS[latest.status] ?? latest.status}` : "—"}
              </div>
              {latest && <div>Certificado vence em {formatDateTime(latest.certificateExpiresAt)}</div>}
              <div>
                Tarifa do Pix: {view.current?.pixFeeBasisPoints != null ? formatPercentageBps(view.current.pixFeeBasisPoints) : "não definida"}
              </div>
            </dl>
          )}
          <NoticeText notice={notice} />

          <details className="rounded-md border border-slate-200 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              {identity ? "Trocar credenciais" : "Cadastrar credenciais"}
            </summary>
            <div className="mt-4">
              <CredentialsForm onSaved={() => refresh({ error: false, text: "Credenciais salvas. Valide para começar a usar." })} />
            </div>
          </details>

          {identity && (
            <div className="space-y-2">
              <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void validate(false)}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                Validar e ligar webhook Pix
              </button>
              {webhookInUse && (
                <div role="alert" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p>
                    A chave Pix já avisa <code className="break-all">{webhookInUse}</code>. A Efí aceita um endereço por chave:
                    trocar faz esse endereço parar de receber os avisos desta chave.
                  </p>
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => void validate(true)}>
                    Trocar pelo endereço da Cifra+
                  </button>
                </div>
              )}
            </div>
          )}

          {view.current && (
            <form onSubmit={saveFee} className="flex flex-wrap items-end gap-2">
              <Field label="Nova tarifa do Pix (%)" hint="Tarifa da Efí sobre cada Pix recebido na conta Cifra+.">
                <input className={inputClass} inputMode="decimal" placeholder="1,19" value={fee} onChange={(event) => setFee(event.target.value)} />
              </Field>
              <button type="submit" className={buttonClass} disabled={busy || !fee.trim()}>
                Salvar tarifa
              </button>
            </form>
          )}

          {view.current && (
            <PlatformCardForm
              key={view.current.version}
              current={view.current}
              onSaved={(next) => {
                setView(next);
                setNotice({ error: false, text: "Cartão salvo em uma nova versão." });
              }}
              onConflict={() => refresh({ error: true, text: "Outra pessoa alterou a conta. Os dados foram recarregados." })}
            />
          )}
        </>
      )}
    </section>
  );
}
