"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { DebtorPaymentHistoryModal } from "@/components/features/DebtorPaymentHistoryModal";
import { DebtorSettingsModal } from "@/components/features/DebtorSettingsModal";
import type {
  BillingMethod,
  CollectionRuleProfile,
  CreateDebtorInput,
  DebtorListItem,
  DebtorListResponse,
  DebtorPaymentStatusFilter,
} from "@/lib/api-client";
import { normalizeRequiredDebtorDocument } from "@/lib/debtor-document";
import { useApiClient } from "@/lib/use-api-client";
import {
  formatWhatsAppNumber,
  normalizeWhatsAppNumber,
} from "@/lib/whatsapp-number";

interface ClientForm {
  name: string;
  document: string;
  whatsapp: string;
  email: string;
  whatsappOptIn: boolean;
  collectionProfileId: string;
}

interface ChargeForm {
  amount: string;
  dueDate: string;
  billingType: BillingMethod;
}

interface ApiErrorData {
  details?: string[];
  message?: string | string[];
}

const emptyClientForm: ClientForm = {
  name: "",
  document: "",
  whatsapp: "",
  email: "",
  whatsappOptIn: false,
  collectionProfileId: "",
};

const emptyChargeForm: ChargeForm = {
  amount: "",
  dueDate: "",
  billingType: "PIX",
};

const emptyResponse: DebtorListResponse = {
  data: [],
  total: 0,
  page: 1,
  pageSize: 20,
  summary: {
    totalDebtors: 0,
    openInvoiceAmount: 0,
    openInvoiceCount: 0,
    paidInvoiceAmount: 0,
    paidInvoiceCount: 0,
  },
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: ApiErrorData }).data;

    if (data?.details?.length) {
      return data.details.join(" | ");
    }

    if (Array.isArray(data?.message)) {
      return data.message[0] ?? fallback;
    }

    if (data?.message) {
      return data.message;
    }
  }

  return fallback;
}

function profileTypeLabel(profile: CollectionRuleProfile | DebtorListItem["collectionProfile"]): string {
  if (profile.profileType === "GOOD") {
    return "Bom pagador";
  }

  if (profile.profileType === "DOUBTFUL") {
    return "Duvidoso";
  }

  if (profile.profileType === "BAD") {
    return "Mau pagador";
  }

  return "Novo pagador";
}

function buildClientForm(
  debtor: DebtorListItem,
  fallbackProfileId: string,
): ClientForm {
  return {
    name: debtor.name,
    document: debtor.document,
    whatsapp: debtor.phone_number,
    email: debtor.email ?? "",
    whatsappOptIn: debtor.whatsapp_opt_in,
    collectionProfileId: debtor.collectionProfile.id || fallbackProfileId,
  };
}

export default function ClientesPage() {
  const apiClient = useApiClient();
  const router = useRouter();
  const [response, setResponse] = useState<DebtorListResponse>(emptyResponse);
  const [profiles, setProfiles] = useState<CollectionRuleProfile[]>([]);
  const [search, setSearch] = useState("");
  const [profileId, setProfileId] = useState("");
  const [paymentStatus, setPaymentStatus] =
    useState<DebtorPaymentStatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [savingClient, setSavingClient] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clientModalMode, setClientModalMode] = useState<"create" | "edit" | null>(
    null,
  );
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
  const [editingDebtor, setEditingDebtor] = useState<DebtorListItem | null>(
    null,
  );
  const [chargeTarget, setChargeTarget] = useState<DebtorListItem | null>(null);
  const [chargeForm, setChargeForm] = useState<ChargeForm>(emptyChargeForm);
  const [openActionDebtorId, setOpenActionDebtorId] = useState<string | null>(
    null,
  );
  const [historyTarget, setHistoryTarget] = useState<DebtorListItem | null>(
    null,
  );
  const [settingsTarget, setSettingsTarget] = useState<DebtorListItem | null>(
    null,
  );

  const defaultProfileId = useMemo(
    () =>
      profiles.find((profile) => profile.profileType === "NEW")?.id ??
      profiles.find((profile) => profile.isDefault)?.id ??
      profiles[0]?.id ??
      "",
    [profiles],
  );

  const fetchDebtors = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const [debtorsResponse, profilesResponse] = await Promise.all([
        apiClient.getDebtors({
          page: 1,
          pageSize: 20,
          search: search.trim() || undefined,
          profileId: profileId || undefined,
          paymentStatus,
        }),
        apiClient.getRules(),
      ]);

      setResponse(debtorsResponse);
      setProfiles(profilesResponse);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError, "Nao foi possivel carregar clientes."));
    } finally {
      setLoading(false);
    }
  }, [apiClient, paymentStatus, profileId, search]);

  useEffect(() => {
    void fetchDebtors();
  }, [fetchDebtors]);

  useEffect(() => {
    if (clientModalMode === "create" && defaultProfileId) {
      setClientForm((current) =>
        current.collectionProfileId
          ? current
          : { ...current, collectionProfileId: defaultProfileId },
      );
    }
  }, [clientModalMode, defaultProfileId]);

  function updateClientForm<Field extends keyof ClientForm>(
    field: Field,
    value: ClientForm[Field],
  ): void {
    setClientForm((current) => ({ ...current, [field]: value }));
  }

  function openCreateClientModal(): void {
    setError(null);
    setSuccess(null);
    setEditingDebtor(null);
    setClientForm({
      ...emptyClientForm,
      collectionProfileId: defaultProfileId,
    });
    setClientModalMode("create");
  }

  function openEditClientModal(debtor: DebtorListItem): void {
    setError(null);
    setSuccess(null);
    setOpenActionDebtorId(null);
    setEditingDebtor(debtor);
    setClientForm(buildClientForm(debtor, defaultProfileId));
    setClientModalMode("edit");
  }

  function closeClientModal(): void {
    setClientModalMode(null);
    setEditingDebtor(null);
    setClientForm(emptyClientForm);
    setSavingClient(false);
  }

  function openChargeModal(debtor: DebtorListItem): void {
    setError(null);
    setSuccess(null);
    setOpenActionDebtorId(null);
    setChargeTarget(debtor);
    setChargeForm(emptyChargeForm);
  }

  function closeChargeModal(): void {
    setChargeTarget(null);
    setChargeForm(emptyChargeForm);
    setSavingCharge(false);
  }

  async function submitClientForm(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSavingClient(true);
    setError(null);
    setSuccess(null);

    try {
      if (!clientForm.collectionProfileId) {
        throw new Error("Selecione um perfil de pagador.");
      }

      const payload: CreateDebtorInput = {
        name: clientForm.name.trim(),
        document: normalizeRequiredDebtorDocument(clientForm.document),
        phone_number: normalizeWhatsAppNumber(clientForm.whatsapp),
        email: clientForm.email.trim() || null,
        whatsappOptIn: clientForm.whatsappOptIn,
        collectionProfileId: clientForm.collectionProfileId,
      };

      if (clientModalMode === "edit" && editingDebtor) {
        await apiClient.updateDebtor(editingDebtor.debtorId, payload);
        setSuccess(`Cliente ${payload.name} atualizado.`);
      } else {
        await apiClient.createDebtor(payload);
        setSuccess(`Cliente ${payload.name} cadastrado.`);
      }

      closeClientModal();
      await fetchDebtors();
    } catch (submitError: unknown) {
      setError(getErrorMessage(submitError, "Nao foi possivel salvar cliente."));
    } finally {
      setSavingClient(false);
    }
  }

  async function submitChargeForm(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSavingCharge(true);
    setError(null);
    setSuccess(null);

    try {
      if (!chargeTarget) {
        throw new Error("Cliente nao selecionado.");
      }

      const amount = Number(chargeForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Informe um valor valido.");
      }

      if (!chargeForm.dueDate) {
        throw new Error("Informe a data de vencimento.");
      }

      await apiClient.createDebtorInvoice(chargeTarget.debtorId, {
        original_amount: amount,
        due_date: chargeForm.dueDate,
        billing_type: chargeForm.billingType,
      });

      setSuccess(`Cobranca criada para ${chargeTarget.name}.`);
      closeChargeModal();
      await fetchDebtors();
    } catch (submitError: unknown) {
      setError(
        getErrorMessage(submitError, "Nao foi possivel criar a cobranca."),
      );
    } finally {
      setSavingCharge(false);
    }
  }

  function navigateToOpenInvoices(debtor: DebtorListItem): void {
    setOpenActionDebtorId(null);
    router.push(`/cobrancas?debtorId=${debtor.debtorId}&status=PENDING`);
  }

  const debtors = response.data;
  const summary = response.summary;
  const clientModalTitle =
    clientModalMode === "edit" ? "Editar cliente" : "Novo cliente";

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex flex-col gap-5 p-4 lg:p-8">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          </div>

          <button
            type="button"
            onClick={openCreateClientModal}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 xl:w-auto"
          >
            <Plus size={17} />
            Novo cliente
          </button>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
            <span>{success}</span>
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-500">
                Clientes cadastrados
              </p>
              <Users size={18} className="text-slate-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {summary.totalDebtors}
            </p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-500">Em aberto</p>
              <ReceiptText size={18} className="text-amber-500" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatCurrency(summary.openInvoiceAmount)}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {summary.openInvoiceCount} cobrancas
            </p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-500">Pagas</p>
              <CheckCircle2 size={18} className="text-emerald-600" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatCurrency(summary.paidInvoiceAmount)}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {summary.paidInvoiceCount} pagas
            </p>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_13rem_13rem]">
            <label className="relative block">
              <span className="sr-only">Buscar clientes</span>
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={17}
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome, CPF/CNPJ, WhatsApp ou e-mail"
                className="h-10 w-full rounded-md border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label>
              <span className="sr-only">Filtrar por perfil</span>
              <select
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              >
                <option value="">Todos os perfis</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="sr-only">Filtrar por cobrancas</span>
              <select
                value={paymentStatus}
                onChange={(event) =>
                  setPaymentStatus(
                    event.target.value as DebtorPaymentStatusFilter,
                  )
                }
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              >
                <option value="all">Todos</option>
                <option value="open">Com aberto</option>
                <option value="no_open">Sem aberto</option>
                <option value="paid">Com pagas</option>
              </select>
            </label>
          </div>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={18} />
              Carregando clientes
            </div>
          ) : debtors.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center">
              <UserRound size={34} className="text-slate-300" />
              <h2 className="mt-3 font-semibold text-slate-900">
                Nenhum cliente encontrado
              </h2>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Contato</th>
                    <th className="px-4 py-3">Perfil</th>
                    <th className="px-4 py-3">Em aberto</th>
                    <th className="px-4 py-3">Pagas</th>
                    <th className="px-4 py-3 text-right">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {debtors.map((debtor) => (
                    <tr key={debtor.debtorId} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">
                          {debtor.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {debtor.document}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">
                          {formatWhatsAppNumber(debtor.phone_number)}
                        </p>
                        <p className="mt-1 max-w-52 truncate text-xs text-slate-500">
                          {debtor.email ?? "E-mail opcional"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                          {debtor.collectionProfile.name}
                        </span>
                        <p className="mt-1 text-xs text-slate-500">
                          {profileTypeLabel(debtor.collectionProfile)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">
                          {debtor.openInvoicesCount} cobrancas
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatCurrency(debtor.openInvoicesAmount)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">
                          {debtor.paidInvoicesCount} pagas
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatCurrency(debtor.paidInvoicesAmount)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDateTime(debtor.lastPaymentAt)}
                        </p>
                      </td>
                      <td className="relative px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-label={`Abrir acoes do cliente ${debtor.name}`}
                          onClick={() =>
                            setOpenActionDebtorId((current) =>
                              current === debtor.debtorId
                                ? null
                                : debtor.debtorId,
                            )
                          }
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                        >
                          <MoreVertical size={17} />
                        </button>

                        {openActionDebtorId === debtor.debtorId && (
                          <div
                            role="menu"
                            className="absolute right-4 z-20 mt-2 w-56 rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openEditClientModal(debtor)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <Pencil size={15} />
                              Editar cliente
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openChargeModal(debtor)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <Plus size={15} />
                              Nova cobranca
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => navigateToOpenInvoices(debtor)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <ReceiptText size={15} />
                              Ver cobrancas em aberto
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenActionDebtorId(null);
                                setHistoryTarget(debtor);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <History size={15} />
                              Historico de pagamentos
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenActionDebtorId(null);
                                setSettingsTarget(debtor);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              <Settings2 size={15} />
                              Configurar perfil/cobranca
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {clientModalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">
                  {clientModalTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeClientModal}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitClientForm}>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Nome
                  </span>
                  <input
                    required
                    type="text"
                    value={clientForm.name}
                    onChange={(event) =>
                      updateClientForm("name", event.target.value)
                    }
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    CPF/CNPJ
                  </span>
                  <input
                    required
                    type="text"
                    inputMode="numeric"
                    value={clientForm.document}
                    onChange={(event) =>
                      updateClientForm("document", event.target.value)
                    }
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    WhatsApp
                  </span>
                  <input
                    required
                    type="tel"
                    value={clientForm.whatsapp}
                    onChange={(event) =>
                      updateClientForm("whatsapp", event.target.value)
                    }
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    E-mail
                  </span>
                  <input
                    type="email"
                    value={clientForm.email}
                    onChange={(event) =>
                      updateClientForm("email", event.target.value)
                    }
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Perfil de pagador
                  </span>
                  <select
                    required
                    value={clientForm.collectionProfileId}
                    onChange={(event) =>
                      updateClientForm("collectionProfileId", event.target.value)
                    }
                    className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={clientForm.whatsappOptIn}
                    onChange={(event) =>
                      updateClientForm("whatsappOptIn", event.target.checked)
                    }
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm font-medium text-slate-700">
                    Cliente autorizou mensagens pelo WhatsApp oficial
                  </span>
                </label>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeClientModal}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingClient}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingClient && <Loader2 className="animate-spin" size={16} />}
                  Salvar cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {chargeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">
                  Nova cobranca
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {chargeTarget.name}
                </p>
              </div>
              <button
                type="button"
                onClick={closeChargeModal}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fechar modal de cobranca"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitChargeForm}>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Forma de pagamento
                  </span>
                  <select
                    value={chargeForm.billingType}
                    onChange={(event) =>
                      setChargeForm((current) => ({
                        ...current,
                        billingType: event.target.value as BillingMethod,
                      }))
                    }
                    className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="PIX">PIX</option>
                    <option value="BOLETO">Boleto</option>
                    <option value="BOLIX">Bolix</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Valor
                  </span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={chargeForm.amount}
                    onChange={(event) =>
                      setChargeForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Data de vencimento
                  </span>
                  <input
                    required
                    type="date"
                    value={chargeForm.dueDate}
                    onChange={(event) =>
                      setChargeForm((current) => ({
                        ...current,
                        dueDate: event.target.value,
                      }))
                    }
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeChargeModal}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingCharge}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingCharge && <Loader2 className="animate-spin" size={16} />}
                  Salvar cobranca
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyTarget && (
        <DebtorPaymentHistoryModal
          debtorId={historyTarget.debtorId}
          debtorName={historyTarget.name}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {settingsTarget && (
        <DebtorSettingsModal
          debtorId={settingsTarget.debtorId}
          debtorName={settingsTarget.name}
          onClose={() => setSettingsTarget(null)}
          onSaved={fetchDebtors}
        />
      )}
    </main>
  );
}
