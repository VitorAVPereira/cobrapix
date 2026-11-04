"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { AlertTriangle, Loader2, Plus, ShoppingBag } from "lucide-react";
import type {
  CheckoutClientDetail,
  CheckoutClientSummary,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatPercentageBps } from "@/lib/billing-fees";
import { formatDebtorDocument } from "@/lib/debtor-document";
import { errorCode, formatDateTime } from "@/lib/disbursements";
import { parsePercentToBps } from "@/lib/checkout";
import { PlatformAccountPanel } from "@/components/features/checkout/PlatformAccountPanel";
import { FinancePanel } from "@/components/features/checkout/FinancePanel";

const inputClass =
  "h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";
const buttonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}

interface TermsForm {
  percent: string;
  payoutDocument: string;
  payoutPixKey: string;
}

/** The % and payout data, shared by the new-client and the terms forms. */
function TermsFields({
  value,
  onChange,
}: {
  value: TermsForm;
  onChange: (next: TermsForm) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="% Cifra+ por venda">
        <input
          className={inputClass}
          inputMode="decimal"
          placeholder="2,5"
          value={value.percent}
          onChange={(event) => onChange({ ...value, percent: event.target.value })}
          required
        />
      </Field>
      <Field label="CPF/CNPJ de repasse">
        <input
          className={inputClass}
          value={value.payoutDocument}
          onChange={(event) =>
            onChange({ ...value, payoutDocument: event.target.value })
          }
          required
        />
      </Field>
      <Field label="Chave Pix de repasse">
        <input
          className={inputClass}
          placeholder="CPF, CNPJ, e-mail, +55 DDD celular ou aleatória"
          value={value.payoutPixKey}
          onChange={(event) =>
            onChange({ ...value, payoutPixKey: event.target.value })
          }
          required
        />
      </Field>
    </div>
  );
}

function termsInput(form: TermsForm) {
  const platformFeeBasisPoints = parsePercentToBps(form.percent);
  if (platformFeeBasisPoints === null)
    throw new Error("Informe a % Cifra+ entre 0 e 100, como 2,5.");
  return {
    platformFeeBasisPoints,
    payoutDocument: form.payoutDocument,
    payoutPixKey: form.payoutPixKey,
  };
}

const EMPTY_TERMS: TermsForm = { percent: "", payoutDocument: "", payoutPixKey: "" };

function NewClientForm({
  onCreated,
}: {
  onCreated: (client: CheckoutClientDetail, password: string) => void;
}) {
  const api = useApiClient();
  const [company, setCompany] = useState({
    corporateName: "",
    document: "",
    email: "",
    phoneNumber: "",
  });
  const [user, setUser] = useState({ name: "", email: "" });
  const [terms, setTerms] = useState<TermsForm>(EMPTY_TERMS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await api.createCheckoutClient({
        company,
        firstUser: user,
        terms: termsInput(terms),
      });
      onCreated(result.client, result.temporaryPassword);
    } catch (caught) {
      setError(messageOf(caught, "Não foi possível criar o cliente."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Novo cliente de checkout
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Razão social">
          <input
            className={inputClass}
            value={company.corporateName}
            onChange={(event) =>
              setCompany({ ...company, corporateName: event.target.value })
            }
            required
          />
        </Field>
        <Field label="CPF/CNPJ">
          <input
            className={inputClass}
            value={company.document}
            onChange={(event) =>
              setCompany({ ...company, document: event.target.value })
            }
            required
          />
        </Field>
        <Field label="E-mail da empresa">
          <input
            type="email"
            className={inputClass}
            value={company.email}
            onChange={(event) =>
              setCompany({ ...company, email: event.target.value })
            }
            required
          />
        </Field>
        <Field label="Telefone">
          <input
            className={inputClass}
            value={company.phoneNumber}
            onChange={(event) =>
              setCompany({ ...company, phoneNumber: event.target.value })
            }
            required
          />
        </Field>
        <Field label="Nome do usuário">
          <input
            className={inputClass}
            value={user.name}
            onChange={(event) => setUser({ ...user, name: event.target.value })}
            required
          />
        </Field>
        <Field label="E-mail de acesso">
          <input
            type="email"
            className={inputClass}
            value={user.email}
            onChange={(event) => setUser({ ...user, email: event.target.value })}
            required
          />
        </Field>
      </div>
      <TermsFields value={terms} onChange={setTerms} />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" className={buttonClass} disabled={saving}>
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        Criar cliente
      </button>
    </form>
  );
}

type Notice = { error: boolean; text: string } | null;

function ClientDetail({
  client,
  notice,
  onChanged,
}: {
  client: CheckoutClientDetail;
  notice: Notice;
  onChanged: (client: CheckoutClientDetail, notice: Notice) => void;
}) {
  const api = useApiClient();
  const current = client.terms[0] ?? null;
  // The parent remounts this form (key) whenever a new version arrives.
  const [terms, setTerms] = useState<TermsForm>(() =>
    current
      ? {
          percent: String(current.platformFeeBasisPoints / 100).replace(".", ","),
          payoutDocument: current.payoutDocument,
          payoutPixKey: current.payoutPixKey,
        }
      : EMPTY_TERMS,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Notice>(notice);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const updated = await api.updateCheckoutTerms(client.id, {
        ...termsInput(terms),
        expectedVersion: current?.version ?? 0,
      });
      onChanged(updated, { error: false, text: "Termos salvos em uma nova versão." });
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED") {
        // Someone else saved first: show their version instead of overwriting it.
        onChanged(await api.getCheckoutClient(client.id), {
          error: true,
          text: "Outra pessoa alterou os termos. Os dados foram recarregados.",
        });
      } else {
        setMessage({
          error: true,
          text: messageOf(caught, "Não foi possível salvar os termos."),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          {client.corporateName}
        </h2>
        <p className="text-sm text-slate-500">
          {formatDebtorDocument(client.document)} · {client.email}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Acesso:{" "}
          {client.users
            .map(
              (user) =>
                `${user.email}${user.mustChangePassword ? " (primeiro acesso pendente)" : ""}`,
            )
            .join(", ")}
        </p>
      </div>
      <form onSubmit={save} className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">
          Termos atuais {current ? `(versão ${current.version})` : ""}
        </h3>
        <TermsFields value={terms} onChange={setTerms} />
        {message && (
          <p
            role={message.error ? "alert" : "status"}
            className={`text-sm ${message.error ? "text-red-600" : "text-emerald-700"}`}
          >
            {message.text}
          </p>
        )}
        <button type="submit" className={buttonClass} disabled={saving}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          Salvar nova versão
        </button>
      </form>
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Histórico</h3>
        <ul className="mt-2 divide-y divide-slate-100 text-sm text-slate-600">
          {client.terms.map((version) => (
            <li key={version.id} className="py-2">
              Versão {version.version} · {formatPercentageBps(version.platformFeeBasisPoints)}{" "}
              · repasse {formatDebtorDocument(version.payoutDocument)} ·{" "}
              {formatDateTime(version.createdAt)}
            </li>
          ))}
        </ul>
      </div>
      <FinancePanel companyId={client.id} />
    </section>
  );
}

export default function AdminCheckoutPage() {
  const api = useApiClient();
  const [clients, setClients] = useState<CheckoutClientSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CheckoutClientDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  function reloadList(): void {
    setListError(null);
    setReload((value) => value + 1);
  }

  function selectClient(id: string): void {
    setDetail(null);
    setDetailError(null);
    setNotice(null);
    setSelectedId(id);
  }

  useEffect(() => {
    const controller = new AbortController();
    api
      .listCheckoutClients(controller.signal)
      .then((result) => setClients(result))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setListError(messageOf(caught, "Não foi possível carregar os clientes."));
      });
    return () => controller.abort();
  }, [api, reload]);

  useEffect(() => {
    if (!selectedId) return;
    // A slower answer for a previous client must not replace the current one.
    const controller = new AbortController();
    api
      .getCheckoutClient(selectedId, controller.signal)
      .then((result) => setDetail(result))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setDetailError(messageOf(caught, "Não foi possível carregar o cliente."));
      });
    return () => controller.abort();
  }, [api, selectedId]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <ShoppingBag size={20} />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Checkout</h1>
            <p className="text-sm text-slate-500">
              Clientes que vendem pelo Cifra+ Checkout, na conta Efí da Cifra+.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            setCreating((open) => !open);
            setPassword(null);
          }}
        >
          <Plus size={16} />
          Novo cliente de checkout
        </button>
      </header>

      <PlatformAccountPanel />

      {password && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          Cliente criado. Senha temporária (mostrada só agora):{" "}
          <code className="rounded bg-white px-2 py-0.5 font-semibold">{password}</code>
        </div>
      )}

      {creating && (
        <NewClientForm
          onCreated={(client, temporaryPassword) => {
            setCreating(false);
            setPassword(temporaryPassword);
            selectClient(client.id);
            reloadList();
          }}
        />
      )}

      {listError ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={16} />
          {listError}
          <button
            type="button"
            className="ml-auto font-semibold underline"
            onClick={reloadList}
          >
            Tentar de novo
          </button>
        </div>
      ) : clients === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Carregando clientes…
        </p>
      ) : clients.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          Nenhum cliente de checkout ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">CPF/CNPJ</th>
                <th className="px-4 py-3">% Cifra+</th>
                <th className="px-4 py-3">Produtos ativos</th>
                <th className="px-4 py-3">Reembolsos pedidos</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((client) => (
                <tr key={client.id} className={client.id === selectedId ? "bg-emerald-50/50" : ""}>
                  <td className="px-4 py-3 font-medium text-slate-900">{client.corporateName}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDebtorDocument(client.document)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {client.currentTerms
                      ? formatPercentageBps(client.currentTerms.platformFeeBasisPoints)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{client.activeProducts}</td>
                  <td className={`px-4 py-3 ${client.pendingRefundRequests ? "font-semibold text-amber-700" : "text-slate-600"}`}>
                    {client.pendingRefundRequests}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="font-semibold text-emerald-700 hover:underline"
                      onClick={() => selectClient(client.id)}
                    >
                      Ver termos e financeiro
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId &&
        (detailError ? (
          <p role="alert" className="text-sm text-red-600">
            {detailError}
          </p>
        ) : detail ? (
          <ClientDetail
            key={`${detail.id}-${detail.terms[0]?.version ?? 0}`}
            client={detail}
            notice={notice}
            onChanged={(updated, next) => {
              setDetail(updated);
              setNotice(next);
              reloadList();
            }}
          />
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Carregando cliente…
          </p>
        ))}
    </div>
  );
}
