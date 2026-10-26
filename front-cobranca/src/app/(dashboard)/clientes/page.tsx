"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  ReceiptText,
  Repeat,
  Search,
  Settings2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { DebtorPaymentHistoryModal } from "@/components/features/DebtorPaymentHistoryModal";
import { DebtorSettingsModal } from "@/components/features/DebtorSettingsModal";
import { DebtorActionsMenu } from "@/components/features/debtors/DebtorActionsMenu";
import { RecurringChargeModal } from "@/components/features/invoices/RecurringChargeModal";
import type {
  BillingMethod,
  BillingSettings,
  CollectionRuleProfile,
  CreateDebtorInput,
  DebtorListItem,
  DebtorListResponse,
  DebtorPaymentStatusFilter,
} from "@/lib/api-client";
import {
  formatDebtorDocument,
  normalizeRequiredDebtorDocument,
} from "@/lib/debtor-document";
import { TablePagination } from "@/components/ui/TablePagination";
import { useApiClient } from "@/lib/use-api-client";
import { LateTermsFields } from "@/components/features/LateTermsFields";
import {
  SendNowFields,
  initialSendNow,
  sendNowPayload,
  sendNowProblem,
  type SendNowValue,
} from "@/components/features/SendNowFields";
import {
  EMPTY_LATE_TERMS,
  isIndividualDocument,
  lateTermsFormFromValues,
  parseLateTermsForm,
  type LateTermsFormValues,
} from "@/lib/late-terms";
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
  lateTerms: LateTermsFormValues;
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
  billingType: "BOLIX",
  lateTerms: EMPTY_LATE_TERMS,
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

interface ClientListQuery {
  search: string;
  profileId: string;
  paymentStatus: DebtorPaymentStatusFilter;
  page: number;
  pageSize: number;
}

const PAYMENT_STATUSES: DebtorPaymentStatusFilter[] = ["all", "open", "no_open", "paid"];

/** Filters live in the URL: a reload or the back button returns to the same list. */
function readClientQuery(params: URLSearchParams): ClientListQuery {
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  const status = params.get("paymentStatus") as DebtorPaymentStatusFilter;
  return {
    search: params.get("search") ?? "",
    profileId: params.get("profileId") ?? "",
    paymentStatus: PAYMENT_STATUSES.includes(status) ? status : "all",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: [20, 50, 100].includes(pageSize) ? pageSize : 20,
  };
}

function writeClientQuery(query: ClientListQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.profileId) params.set("profileId", query.profileId);
  if (query.paymentStatus !== "all") params.set("paymentStatus", query.paymentStatus);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 20) params.set("pageSize", String(query.pageSize));
  const value = params.toString();
  return value ? `?${value}` : "";
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

function ClientesContent() {
  const apiClient = useApiClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // "Cadastrar novo cliente" in Cobranças arrives with ?novo=1.
  const opensCreate = searchParams.get("novo") === "1";
  const query = useMemo(
    () => readClientQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [response, setResponse] = useState<DebtorListResponse>(emptyResponse);
  const [profiles, setProfiles] = useState<CollectionRuleProfile[]>([]);
  const [searchInput, setSearchInput] = useState(query.search);
  const [listError, setListError] = useState<string | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingClient, setSavingClient] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clientModalMode, setClientModalMode] = useState<"create" | "edit" | null>(
    () => (opensCreate ? "create" : null),
  );
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
  const [editingDebtor, setEditingDebtor] = useState<DebtorListItem | null>(
    null,
  );
  const [chargeTarget, setChargeTarget] = useState<DebtorListItem | null>(null);
  // "Nova cobrança" first asks: one-off (chargeTarget) or recurring (recurringTarget).
  const [chargeKindTarget, setChargeKindTarget] =
    useState<DebtorListItem | null>(null);
  const [recurringTarget, setRecurringTarget] =
    useState<DebtorListItem | null>(null);
  const [billingSettings, setBillingSettings] =
    useState<BillingSettings | null>(null);
  const [chargeForm, setChargeForm] = useState<ChargeForm>(emptyChargeForm);
  const [sendNow, setSendNow] = useState<SendNowValue>(() =>
    initialSendNow(undefined),
  );
  // Company "primeira cobrança" setting: the starting answer of "Enviar cobrança agora".
  const [companySendsNow, setCompanySendsNow] = useState<boolean | undefined>();
  // Company defaults for fine, interest and days after due.
  const [companyLateTerms, setCompanyLateTerms] =
    useState<LateTermsFormValues>(EMPTY_LATE_TERMS);
  // Row whose actions menu is open, with the button it is anchored to.
  const [openAction, setOpenAction] = useState<{
    debtorId: string;
    anchor: HTMLButtonElement;
  } | null>(null);
  const closeActions = useCallback(() => setOpenAction(null), []);
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

  const hasFilters = Boolean(
    query.search || query.profileId || query.paymentStatus !== "all",
  );

  const updateQuery = useCallback(
    (patch: Partial<ClientListQuery>): void => {
      // Any filter change starts again from the first page.
      const next = { ...query, page: 1, ...patch };
      router.replace(`${pathname}${writeClientQuery(next)}`, { scroll: false });
    },
    [pathname, query, router],
  );

  function clearFilters(): void {
    setSearchInput("");
    updateQuery({ search: "", profileId: "", paymentStatus: "all" });
  }

  // The search reaches the URL (and the API) once the user stops typing.
  useEffect(() => {
    if (searchInput.trim() === query.search) return;
    const timer = window.setTimeout(
      () => updateQuery({ search: searchInput.trim() }),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [query.search, searchInput, updateQuery]);

  const fetchDebtors = useCallback(async (): Promise<void> => {
    // A slower answer for a previous filter must not replace the current list.
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);

    try {
      const debtorsResponse = await apiClient.getDebtors(
        {
          page: query.page,
          pageSize: query.pageSize,
          search: query.search || undefined,
          profileId: query.profileId || undefined,
          paymentStatus: query.paymentStatus,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResponse(debtorsResponse);
      setListError(null);
      // A new list (reload, filter or page) never keeps a menu of the old one.
      setOpenAction(null);
    } catch {
      if (controller.signal.aborted) return;
      setListError("Não foi possível carregar os clientes.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [apiClient, query]);

  useEffect(() => {
    void fetchDebtors();
  }, [fetchDebtors]);

  // A saved link or a shorter list can point past the last page.
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(response.total / query.pageSize));
    if (!loading && query.page > lastPage) updateQuery({ page: lastPage });
  }, [loading, query.page, query.pageSize, response.total, updateQuery]);

  useEffect(() => () => listRequest.current?.abort(), []);

  // Profiles change rarely: loaded once, not on every filter.
  useEffect(() => {
    let active = true;
    apiClient
      .getRules()
      .then((rules) => {
        if (active) setProfiles(rules);
      })
      .catch(() => {
        // Without profiles the filter shows only "Todos os perfis".
      });
    return () => {
      active = false;
    };
  }, [apiClient]);

  // A reload after saving must not open the form again.
  useEffect(() => {
    if (opensCreate) router.replace(`${pathname}${writeClientQuery(query)}`, { scroll: false });
  }, [opensCreate, pathname, query, router]);

  useEffect(() => {
    let active = true;
    async function loadCompanyLateTerms(): Promise<void> {
      try {
        const settings = await apiClient.getBillingSettings();
        if (!active) return;
        setBillingSettings(settings);
        setCompanySendsNow(settings.autoGenerateFirstCharge);
        setCompanyLateTerms(
          lateTermsFormFromValues({
            fine: settings.lateFinePercentage ?? 0,
            interest: settings.lateInterestMonthlyPercentage ?? 0,
            days: settings.paymentDaysAfterDue ?? 30,
          }),
        );
      } catch {
        // Without defaults the fields stay empty and the server applies them.
      }
    }
    void loadCompanyLateTerms();
    return () => {
      active = false;
    };
  }, [apiClient]);

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
    setOpenAction(null);
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

  function openChargeKind(debtor: DebtorListItem): void {
    setError(null);
    setSuccess(null);
    setOpenAction(null);
    setChargeKindTarget(debtor);
  }

  function openChargeModal(debtor: DebtorListItem): void {
    setChargeKindTarget(null);
    setChargeTarget(debtor);
    setChargeForm({ ...emptyChargeForm, lateTerms: companyLateTerms });
    setSendNow(initialSendNow(companySendsNow));
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
      setError(getErrorMessage(submitError, "Não foi possível salvar o cliente."));
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
        throw new Error("Cliente não selecionado.");
      }

      const amount = Number(chargeForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Informe um valor válido.");
      }

      if (!chargeForm.dueDate) {
        throw new Error("Informe a data de vencimento.");
      }

      const sendProblem = sendNowProblem(sendNow);
      if (sendProblem) throw new Error(sendProblem);

      const parsedLateTerms = parseLateTermsForm(chargeForm.lateTerms);
      if ("error" in parsedLateTerms) {
        throw new Error(parsedLateTerms.error);
      }

      await apiClient.createDebtorInvoice(chargeTarget.debtorId, {
        original_amount: amount,
        due_date: chargeForm.dueDate,
        billing_type: chargeForm.billingType,
        late_fine_percentage: parsedLateTerms.terms.fine,
        late_interest_monthly_percentage: parsedLateTerms.terms.interest,
        payment_days_after_due: parsedLateTerms.terms.days,
        ...sendNowPayload(sendNow),
      });

      setSuccess(`Cobrança criada para ${chargeTarget.name}.`);
      closeChargeModal();
      await fetchDebtors();
    } catch (submitError: unknown) {
      setError(
        getErrorMessage(submitError, "Não foi possível criar a cobrança."),
      );
    } finally {
      setSavingCharge(false);
    }
  }

  function navigateToOpenInvoices(debtor: DebtorListItem): void {
    setOpenAction(null);
    router.push(`/cobrancas?debtorId=${debtor.debtorId}&status=PENDING`);
  }

  const debtors = response.data;
  const summary = response.summary;
  const count = (value: number) => value.toLocaleString("pt-BR");
  // Only a debtor still listed keeps its menu (reload, filter, pagination).
  const actionDebtor = openAction
    ? (debtors.find((debtor) => debtor.debtorId === openAction.debtorId) ?? null)
    : null;
  const clientModalTitle =
    clientModalMode === "edit" ? "Editar cliente" : "Novo cliente";

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Clientes</h1>
            <p className="mt-1 text-sm text-slate-500">
              Cadastre clientes e acompanhe o que cada um tem em aberto e já pagou.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateClientModal}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            <Plus size={17} />
            Novo cliente
          </button>
        </header>

        {error && !clientModalMode && !chargeTarget && (
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

        <section
          aria-label="Resumo dos clientes"
          className="grid gap-3 sm:grid-cols-3"
        >
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-500">
                {hasFilters ? "Clientes encontrados" : "Clientes cadastrados"}
              </p>
              <Users size={18} className="text-slate-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {count(summary.totalDebtors)}
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
              {count(summary.openInvoiceCount)}{" "}
              {summary.openInvoiceCount === 1 ? "cobrança" : "cobranças"}
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
              {count(summary.paidInvoiceCount)}{" "}
              {summary.paidInvoiceCount === 1 ? "cobrança" : "cobranças"}
            </p>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_13rem_13rem]">
            <label className="relative block md:col-span-2 lg:col-span-1">
              <span className="sr-only">Buscar clientes</span>
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={17}
              />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Buscar por nome, CPF/CNPJ, WhatsApp ou e-mail"
                className="h-10 w-full rounded-md border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label>
              <span className="sr-only">Filtrar por perfil</span>
              <select
                value={query.profileId}
                onChange={(event) => updateQuery({ profileId: event.target.value })}
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
              <span className="sr-only">Filtrar por cobranças</span>
              <select
                value={query.paymentStatus}
                onChange={(event) =>
                  updateQuery({
                    paymentStatus: event.target.value as DebtorPaymentStatusFilter,
                  })
                }
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              >
                <option value="all">Todos</option>
                <option value="open">Com cobranças em aberto</option>
                <option value="no_open">Sem cobranças em aberto</option>
                <option value="paid">Com cobranças pagas</option>
              </select>
            </label>
          </div>

          {listError ? (
            <div
              role="alert"
              className="flex min-h-64 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-rose-700"
            >
              <AlertCircle size={28} aria-hidden="true" />
              <p>{listError}</p>
              <button
                type="button"
                onClick={() => void fetchDebtors()}
                className="rounded-md border border-rose-200 bg-white px-3 py-1.5 font-semibold hover:bg-rose-50"
              >
                Tentar de novo
              </button>
            </div>
          ) : loading && debtors.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={18} />
              Carregando clientes
            </div>
          ) : debtors.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center">
              <UserRound size={34} className="text-slate-300" />
              <h2 className="mt-3 font-semibold text-slate-900">
                {hasFilters ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
              </h2>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Limpar filtros
                </button>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  Cadastre o primeiro cliente para criar cobranças.
                </p>
              )}
            </div>
          ) : (
            <div
              aria-busy={loading}
              className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}
            >
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Contato</th>
                      <th className="px-4 py-3">Perfil</th>
                      <th className="px-4 py-3">Em aberto</th>
                      <th className="px-4 py-3">Pagas</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {debtors.map((debtor) => (
                      <tr key={debtor.debtorId} className="align-top hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{debtor.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                            {formatDebtorDocument(debtor.document || null)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">
                            {formatWhatsAppNumber(debtor.phone_number)}
                          </p>
                          <p className="mt-0.5 max-w-52 truncate text-xs text-slate-500">
                            {debtor.email ?? "Sem e-mail"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                            {debtor.collectionProfile.name}
                          </span>
                          <p className="mt-1 text-xs text-slate-500">
                            {profileTypeLabel(debtor.collectionProfile)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900 tabular-nums">
                            {formatCurrency(debtor.openInvoicesAmount)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {count(debtor.openInvoicesCount)}{" "}
                            {debtor.openInvoicesCount === 1 ? "cobrança" : "cobranças"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900 tabular-nums">
                            {formatCurrency(debtor.paidInvoicesAmount)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {count(debtor.paidInvoicesCount)}{" "}
                            {debtor.paidInvoicesCount === 1 ? "paga" : "pagas"}
                            {debtor.lastPaymentAt &&
                              ` · última em ${formatDateTime(debtor.lastPaymentAt)}`}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            aria-label={`Abrir ações do cliente ${debtor.name}`}
                            aria-haspopup="menu"
                            aria-expanded={openAction?.debtorId === debtor.debtorId}
                            onClick={(event) => {
                              const anchor = event.currentTarget;
                              setOpenAction((current) =>
                                current?.debtorId === debtor.debtorId
                                  ? null
                                  : { debtorId: debtor.debtorId, anchor },
                              );
                            }}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                          >
                            <MoreVertical size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={query.page}
                pageSize={query.pageSize}
                total={response.total}
                pageSizeLabel="Clientes por página"
                onChange={(next) => updateQuery(next)}
              />
            </div>
          )}
        </section>
      </div>

      <DebtorActionsMenu
        open={Boolean(actionDebtor)}
        anchor={openAction?.anchor ?? null}
        onClose={closeActions}
        label={actionDebtor ? `Ações do cliente ${actionDebtor.name}` : "Ações do cliente"}
        actions={
          actionDebtor
            ? [
                {
                  id: "edit",
                  label: "Editar cliente",
                  icon: <Pencil size={15} />,
                  onSelect: () => openEditClientModal(actionDebtor),
                },
                {
                  id: "charge",
                  label: "Nova cobrança",
                  icon: <Plus size={15} />,
                  onSelect: () => openChargeKind(actionDebtor),
                },
                {
                  id: "open-invoices",
                  label: "Ver cobranças em aberto",
                  icon: <ReceiptText size={15} />,
                  onSelect: () => navigateToOpenInvoices(actionDebtor),
                },
                {
                  id: "history",
                  label: "Histórico de pagamentos",
                  icon: <History size={15} />,
                  onSelect: () => setHistoryTarget(actionDebtor),
                },
                {
                  id: "settings",
                  label: "Configurar perfil e cobrança",
                  icon: <Settings2 size={15} />,
                  onSelect: () => setSettingsTarget(actionDebtor),
                },
              ]
            : []
        }
      />

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
                {error && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                  >
                    <AlertCircle className="mt-0.5 shrink-0" size={16} />
                    {error}
                  </p>
                )}
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

      {chargeKindTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="charge-kind-title"
            className="w-full max-w-md rounded-md bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="charge-kind-title" className="font-semibold text-slate-900">
                  Nova cobrança
                </h2>
                <p className="mt-1 text-sm text-slate-500">{chargeKindTarget.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setChargeKindTarget(null)}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-3 p-5">
              <button
                type="button"
                onClick={() => openChargeModal(chargeKindTarget)}
                className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                <ReceiptText className="mt-0.5 shrink-0 text-emerald-600" size={18} />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">Avulsa</span>
                  <span className="block text-xs text-slate-500">Uma cobrança com um vencimento.</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecurringTarget(chargeKindTarget);
                  setChargeKindTarget(null);
                }}
                className="flex items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                <Repeat className="mt-0.5 shrink-0 text-emerald-600" size={18} />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">Recorrente</span>
                  <span className="block text-xs text-slate-500">
                    Repete toda semana, todo mês ou em outra periodicidade.
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {recurringTarget && (
        <RecurringChargeModal
          initialClient={{
            debtorId: recurringTarget.debtorId,
            name: recurringTarget.name,
            document: recurringTarget.document,
            phone_number: recurringTarget.phone_number,
            email: recurringTarget.email,
          }}
          settings={billingSettings}
          onClose={() => setRecurringTarget(null)}
          onCreated={async (client) => {
            setRecurringTarget(null);
            setSuccess(`Cobrança recorrente criada para ${client.name}.`);
            await fetchDebtors();
          }}
        />
      )}

      {chargeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">
                  Nova cobrança
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {chargeTarget.name}
                </p>
              </div>
              <button
                type="button"
                onClick={closeChargeModal}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fechar modal de cobrança"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitChargeForm}>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                {error && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                  >
                    <AlertCircle className="mt-0.5 shrink-0" size={16} />
                    {error}
                  </p>
                )}
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

                <fieldset className="sm:col-span-2">
                  <legend className="mb-2 text-sm font-semibold text-slate-800">
                    Multa, juros e prazo após o vencimento{" "}
                    <span className="font-normal text-slate-500">
                      (opcional)
                    </span>
                  </legend>
                  <LateTermsFields
                    idPrefix="debtor-charge-late-terms"
                    values={chargeForm.lateTerms}
                    disabled={savingCharge}
                    onChange={(values) =>
                      setChargeForm((current) => ({
                        ...current,
                        lateTerms: values,
                      }))
                    }
                    placeholders={{
                      fine: "Padrão da empresa",
                      interest: "Padrão da empresa",
                      days: "Padrão da empresa",
                    }}
                    individualDebtor={isIndividualDocument(
                      chargeTarget?.document,
                    )}
                  />
                </fieldset>
                <div className="sm:col-span-2">
                  <SendNowFields
                    value={sendNow}
                    onChange={setSendNow}
                    disabled={savingCharge}
                  />
                </div>
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
                  Salvar cobrança
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

export default function ClientesPage() {
  return (
    <Suspense fallback={null}>
      <ClientesContent />
    </Suspense>
  );
}
