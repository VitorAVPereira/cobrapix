"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PaginationState, Updater } from "@tanstack/react-table";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  Send,
  X,
} from "lucide-react";
import { DebtorPaymentHistoryModal } from "@/components/features/DebtorPaymentHistoryModal";
import { DebtorSettingsModal } from "@/components/features/DebtorSettingsModal";
import {
  InvoiceTable,
  type InvoiceRowAction,
} from "@/components/features/InvoiceTable";
import { PaymentFeeConfirmation } from "@/components/features/PaymentFeeConfirmation";
import { UploadCSV } from "@/components/features/UploadCSV";
import type {
  ParsedDebtor,
  PaymentMethod,
} from "@/components/features/UploadCSV";
import type {
  BillingSettings,
  PaymentFeeQuote,
  CollectionChannel,
  CreatePaymentResponse,
  DebtorOption,
  ImportClientReview,
  ImportDecision,
  InvoiceListSort,
  InvoicePaymentStatusResponse,
  SelectedBillingContactInput,
} from "@/lib/api-client";
import {
  INVOICE_BILLING_OPTIONS,
  INVOICE_SORT_OPTIONS,
  INVOICE_STATUS_OPTIONS,
  InvoiceFilters,
  type InvoiceFilterValues,
} from "@/components/features/invoices/InvoiceFilters";
import { ClientPicker } from "@/components/features/invoices/ClientPicker";
import { ImportReview } from "@/components/features/invoices/ImportReview";
import { ImportSummary } from "@/components/features/invoices/ImportSummary";
import { errorCode } from "@/lib/disbursements";
import { formatBillingMethodRateLabel } from "@/lib/billing-fees";
import { useApiClient } from "@/lib/use-api-client";
import { useFinancialActivation } from "@/components/features/financial-activation-context";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp-number";
import { LateTermsFields } from "@/components/features/LateTermsFields";
import {
  EMPTY_LATE_TERMS,
  isIndividualDocument,
  lateTermsFormFromValues,
  parseLateTermsForm,
  type LateTermsFormValues,
} from "@/lib/late-terms";

interface ApiErrorData {
  details?: string[];
  message?: string;
}

interface ManualChargeForm {
  amount: string;
  dueDate: string;
  billingType: PaymentMethod;
  recurring: boolean;
  dueDay: string;
  studentName: string;
  studentEnrollment: string;
  studentGroup: string;
  lateTerms: LateTermsFormValues;
}

interface RunningInvoiceAction {
  invoiceId: string;
  action: InvoiceRowAction;
}

type SendBillingMode = "selected" | "resend";

interface SendBillingModalState {
  mode: SendBillingMode;
  invoiceIds: string[];
  invoice: ParsedDebtor | null;
}

interface SendBillingForm {
  email: boolean;
  whatsapp: boolean;
  emailAddress: string;
  whatsappNumber: string;
  whatsappOptIn: boolean;
}

const initialManualChargeForm: ManualChargeForm = {
  amount: "",
  dueDate: "",
  billingType: "BOLIX",
  recurring: false,
  dueDay: "10",
  studentName: "",
  studentEnrollment: "",
  studentGroup: "",
  lateTerms: EMPTY_LATE_TERMS,
};

const initialSendBillingForm: SendBillingForm = {
  email: false,
  whatsapp: true,
  emailAddress: "",
  whatsappNumber: "",
  whatsappOptIn: false,
};

function isParsedDebtorArray(data: unknown): data is ParsedDebtor[] {
  return (
    Array.isArray(data) &&
    data.every((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const debtor = item as Partial<ParsedDebtor>;

      return (
        typeof debtor.name === "string" &&
        typeof debtor.phone_number === "string" &&
        typeof debtor.original_amount === "number" &&
        typeof debtor.due_date === "string"
      );
    })
  );
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

    if (data?.message) {
      return data.message;
    }
  }

  return fallback;
}

interface InvoiceListQuery extends Omit<InvoiceFilterValues, "search"> {
  search: string;
  page: number;
  pageSize: number;
  debtorId?: string;
}

const PAGE_SIZES = [20, 50, 100];

/** Filters live in the URL: a reload or the back button returns to the same list. */
function readListQuery(params: URLSearchParams): InvoiceListQuery {
  const pick = <T extends string>(value: string | null, options: { value: T }[], fallback: T): T =>
    options.find((option) => option.value === value)?.value ?? fallback;
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  return {
    search: params.get("search") ?? "",
    status: pick(params.get("status"), INVOICE_STATUS_OPTIONS, ""),
    billingType: pick(params.get("billingType"), INVOICE_BILLING_OPTIONS, ""),
    sort: pick<InvoiceListSort>(params.get("sort"), INVOICE_SORT_OPTIONS, "createdAt_desc"),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
    debtorId: params.get("debtorId") ?? undefined,
  };
}

function writeListQuery(query: InvoiceListQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status) params.set("status", query.status);
  if (query.billingType) params.set("billingType", query.billingType);
  if (query.sort !== "createdAt_desc") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 20) params.set("pageSize", String(query.pageSize));
  if (query.debtorId) params.set("debtorId", query.debtorId);
  const value = params.toString();
  return value ? `?${value}` : "";
}

function getInvoiceId(invoice: ParsedDebtor): string | null {
  return invoice.invoiceId ?? invoice.id ?? null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getPaymentMethodLabel(method: PaymentMethod): string {
  if (method === "CREDIT_CARD") return "Cartão de crédito";
  if (method === "BOLIX") {
    return "Bolix";
  }

  if (method === "BOLETO") {
    return "Boleto";
  }

  return "Pix";
}

function getInvoiceStatusLabel(status: string): string {
  if (status === "PAID") {
    return "Pago";
  }

  if (status === "CANCELED") {
    return "Cancelado";
  }

  if (status === "PENDING") {
    return "Pendente";
  }

  return status;
}

function formatDateBR(dateString: string): string {
  if (!dateString) {
    return "";
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function buildPaymentCreatedMessage(
  invoice: ParsedDebtor,
  response: CreatePaymentResponse,
): string {
  const method = getPaymentMethodLabel(response.billingType);
  const reference =
    response.txid ??
    response.chargeId ??
    response.gatewayId ??
    response.invoiceId;
  const availableData = [
    response.pixCopyPaste ? "Pix copia e cola disponivel" : null,
    response.boletoLink || response.boletoCode ? "boleto disponivel" : null,
  ].filter((item): item is string => Boolean(item));
  const details =
    availableData.length > 0 ? ` ${availableData.join(" e ")}.` : "";

  return `Cobrança ${method} gerada para ${invoice.name}. Referencia ${reference}.${details}`;
}

function buildPaymentStatusMessage(
  invoice: ParsedDebtor,
  response: InvoicePaymentStatusResponse,
): string {
  const status = getInvoiceStatusLabel(response.status);
  const dueDate = formatDateBR(response.dueDate);
  const gatewayReference =
    response.txid ??
    response.chargeId ??
    response.gatewayId ??
    "sem referencia";
  const paymentData = [
    response.pixCopyPaste || response.pixPayload ? "Pix gerado" : null,
    response.boletoLink || response.boletoCode || response.boletoPdf
      ? "boleto gerado"
      : null,
  ].filter((item): item is string => Boolean(item));
  const paymentSummary =
    paymentData.length > 0 ? paymentData.join(" e ") : "sem cobrança gerada";

  return [
    `Status de ${invoice.name}: ${status}.`,
    `Vencimento ${dueDate}.`,
    `Gateway Efí: ${gatewayReference}; ${paymentSummary}.`,
  ].join(" ");
}

function CobrancasContent() {
  const { canIssue } = useFinancialActivation();
  const apiClient = useApiClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = useMemo(
    () => readListQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [debtors, setDebtors] = useState<ParsedDebtor[]>([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState(query.search);
  const [listError, setListError] = useState<string | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const pagination: PaginationState = {
    pageIndex: query.page - 1,
    pageSize: query.pageSize,
  };

  const updateQuery = useCallback(
    (patch: Partial<InvoiceListQuery>): void => {
      // Any filter change starts again from the first page.
      const next = { ...query, page: 1, ...patch };
      router.replace(`${pathname}${writeListQuery(next)}`, { scroll: false });
    },
    [pathname, query, router],
  );

  function changePagination(updater: Updater<PaginationState>): void {
    const next = typeof updater === "function" ? updater(pagination) : updater;
    updateQuery({ page: next.pageIndex + 1, pageSize: next.pageSize });
  }

  const hasFilters = Boolean(
    query.search || query.status || query.billingType || query.debtorId,
  );

  function clearFilters(): void {
    setSearchInput("");
    updateQuery({ search: "", status: "", billingType: "", debtorId: undefined });
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
  const [selectedDebtor, setSelectedDebtor] = useState<ParsedDebtor | null>(
    null,
  );
  const [historyTargetDebtor, setHistoryTargetDebtor] =
    useState<ParsedDebtor | null>(null);
  const [invoiceTargetDebtor, setInvoiceTargetDebtor] =
    useState<ParsedDebtor | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadingCSV, setIsUploadingCSV] = useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isRunningSelected, setIsRunningSelected] = useState(false);
  const [runningInvoiceAction, setRunningInvoiceAction] =
    useState<RunningInvoiceAction | null>(null);
  const [feePreview, setFeePreview] = useState<{
    invoice: ParsedDebtor;
    quote: PaymentFeeQuote;
    replacing: boolean;
  } | null>(null);
  const [sendBillingModal, setSendBillingModal] =
    useState<SendBillingModalState | null>(null);
  const [sendBillingForm, setSendBillingForm] = useState<SendBillingForm>(
    initialSendBillingForm,
  );
  const [billingSettings, setBillingSettings] =
    useState<BillingSettings | null>(null);
  const [manualForm, setManualForm] = useState<ManualChargeForm>(
    initialManualChargeForm,
  );
  const [pickedClient, setPickedClient] = useState<DebtorOption | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // Import in steps: analysis, review of the clients that need a decision, summary.
  const [importRows, setImportRows] = useState<ParsedDebtor[] | null>(null);
  const [importClients, setImportClients] = useState<ImportClientReview[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ImportClientReview[] | null>(null);
  const [importDecisions, setImportDecisions] = useState<ImportDecision[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importConsent, setImportConsent] = useState(false);

  const fetchInvoices = useCallback(async (): Promise<void> => {
    // A slower answer for a previous filter must not replace the current list.
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setIsLoading(true);

    try {
      const result = await apiClient.getInvoices(
        {
          page: query.page,
          pageSize: query.pageSize,
          search: query.search || undefined,
          status: query.status || undefined,
          billingType: query.billingType || undefined,
          sort: query.sort,
          debtorId: query.debtorId,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const invoices = result.data;
      setDebtors(isParsedDebtorArray(invoices) ? invoices : []);
      setTotal(result.total);
      setListError(null);
    } catch {
      if (controller.signal.aborted) return;
      setListError("Não foi possível carregar as cobranças.");
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [apiClient, query]);

  useEffect(() => () => listRequest.current?.abort(), []);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  // A saved link or a shorter list can point past the last page.
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(total / query.pageSize));
    if (!isLoading && query.page > lastPage) updateQuery({ page: lastPage });
  }, [isLoading, query.page, query.pageSize, total, updateQuery]);

  useEffect(() => {
    async function fetchBillingSettings(): Promise<void> {
      try {
        const settings = await apiClient.getBillingSettings();
        setBillingSettings(settings);
        setManualForm((current) => {
          const enabled: PaymentMethod[] = settings.enabledBillingMethods.filter((method) => method !== "BOLETO");
          if (enabled.includes(current.billingType)) return current;
          return { ...current, billingType: enabled.includes(settings.preferredBillingMethod) ? settings.preferredBillingMethod : enabled[0] ?? "BOLIX" };
        });
      } catch {
        setBillingSettings(null);
      }
    }

    void fetchBillingSettings();
  }, [apiClient]);

  const isEducationSegment = billingSettings?.businessSegment === "EDUCATION";

  function resetImport(): void {
    setImportRows(null);
    setImportClients([]);
    setReviewQueue(null);
    setImportDecisions(null);
    setImportConsent(false);
  }

  async function analyzeImport(rows: ParsedDebtor[]): Promise<void> {
    setIsImporting(true);
    try {
      const { clients } = await apiClient.previewInvoiceImport(rows);
      const queue = clients.filter(
        (client) => client.kind !== "NEW" && client.kind !== "SAME",
      );
      setImportRows(rows);
      setImportClients(clients);
      setImportDecisions(queue.length === 0 ? [] : null);
      setReviewQueue(queue.length > 0 ? queue : null);
    } catch (error: unknown) {
      resetImport();
      setImportError(
        getErrorMessage(error, "Não foi possível analisar a planilha."),
      );
    } finally {
      setIsImporting(false);
    }
  }

  async function handleUploadSuccess(
    importedDebtors: ParsedDebtor[],
  ): Promise<void> {
    setImportError(null);
    await analyzeImport(importedDebtors);
  }

  /** A replacement WhatsApp for a new client whose number belongs to someone else. */
  async function validateImportPhone(
    client: ImportClientReview,
    phone: string,
  ): Promise<string | null> {
    if (!importRows) return "Envie a planilha de novo.";
    let normalized: string;
    try {
      normalized = normalizeWhatsAppNumber(phone);
    } catch {
      return "Informe um WhatsApp válido, com DDD.";
    }
    if (
      importClients.some(
        (other) =>
          other.document !== client.document &&
          other.csv.phone.replace(/\D/g, "") === normalized.replace(/\D/g, ""),
      )
    ) {
      return "Este WhatsApp já está em outra linha da planilha.";
    }
    const rows = importRows.map((row, index) =>
      client.rows.includes(index) ? { ...row, phone_number: normalized } : row,
    );
    try {
      const { clients } = await apiClient.previewInvoiceImport(
        client.rows.map((index) => rows[index]),
      );
      const [checked] = clients;
      if (checked?.kind !== "NEW") {
        return checked?.phoneOwner
          ? `Este WhatsApp também já é de ${checked.phoneOwner.name}.`
          : "Não foi possível usar este WhatsApp.";
      }
      setImportRows(rows);
      setImportClients((current) =>
        current.map((item) =>
          item.document === client.document
            ? { ...client, kind: "NEW", phoneOwner: null, csv: { ...client.csv, phone: normalized } }
            : item,
        ),
      );
      return null;
    } catch (error: unknown) {
      return getErrorMessage(error, "Não foi possível verificar este WhatsApp.");
    }
  }

  async function confirmImport(): Promise<void> {
    if (!importRows || !importDecisions) return;
    setIsImporting(true);
    setImportError(null);
    try {
      const rows = importConsent
        ? importRows.map((row) => ({ ...row, whatsapp_opt_in: true }))
        : importRows;
      const result = await apiClient.importInvoices(rows, importDecisions);
      resetImport();
      setIsUploadingCSV(false);
      setErrorMsg(null);
      setSuccessMsg(
        result.skipped.length > 0
          ? `${result.count} cobranças importadas. Ficaram de fora as cobranças de: ${result.skipped
              .map((client) => client.name)
              .join(", ")}.`
          : `${result.count} cobranças importadas.`,
      );
      await fetchInvoices();
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code === "IMPORT_CHANGED" || code === "IMPORT_NEEDS_REVIEW") {
        setImportError(getErrorMessage(error, "Revise a importação de novo."));
        await analyzeImport(importRows);
      } else {
        setImportError(
          getErrorMessage(error, "Não foi possível importar a planilha."),
        );
      }
    } finally {
      setIsImporting(false);
    }
  }

  function openSelectedSendModal(invoiceIds: string[]): void {
    if (invoiceIds.length === 0) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setSendBillingForm(initialSendBillingForm);
    setSendBillingModal({
      mode: "selected",
      invoiceIds,
      invoice: null,
    });
  }

  function openResendModal(invoice: ParsedDebtor): void {
    const invoiceId = getInvoiceId(invoice);

    if (!invoiceId) {
      setSuccessMsg(null);
      setErrorMsg("Nao foi possivel identificar a fatura desta cobranca.");
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setSendBillingForm({
      email: false,
      whatsapp: true,
      emailAddress: invoice.email ?? "",
      whatsappNumber: invoice.phone_number,
      whatsappOptIn: invoice.whatsapp_opt_in ?? false,
    });
    setSendBillingModal({
      mode: "resend",
      invoiceIds: [invoiceId],
      invoice,
    });
  }

  function closeSendBillingModal(): void {
    setSendBillingModal(null);
    setSendBillingForm(initialSendBillingForm);
  }

  function updateSendBillingForm<Field extends keyof SendBillingForm>(
    field: Field,
    value: SendBillingForm[Field],
  ): void {
    setSendBillingForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function submitSendBillingModal(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!canIssue || !sendBillingModal) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    const channels: CollectionChannel[] = [];
    if (sendBillingForm.email) {
      channels.push("EMAIL");
    }
    if (sendBillingForm.whatsapp) {
      channels.push("WHATSAPP");
    }

    if (channels.length === 0) {
      setErrorMsg("Selecione e-mail, WhatsApp ou os dois canais.");
      return;
    }

    const contacts: SelectedBillingContactInput[] = [];

    if (sendBillingModal.invoice) {
      const invoiceId = sendBillingModal.invoiceIds[0];
      if (!invoiceId) {
        setErrorMsg("Nao foi possivel identificar a fatura desta cobranca.");
        return;
      }

      const contact: SelectedBillingContactInput = { invoiceId };

      if (sendBillingForm.email) {
        const emailAddress = sendBillingForm.emailAddress.trim();
        if (!emailAddress || !isValidEmail(emailAddress)) {
          setErrorMsg("Informe um e-mail valido para enviar a cobranca.");
          return;
        }
        contact.email = emailAddress;
      }

      if (sendBillingForm.whatsapp) {
        try {
          contact.phoneNumber = normalizeWhatsAppNumber(
            sendBillingForm.whatsappNumber,
          );
        } catch (error: unknown) {
          setErrorMsg(
            getErrorMessage(error, "Informe um WhatsApp valido para envio."),
          );
          return;
        }

        if (!sendBillingForm.whatsappOptIn) {
          setErrorMsg(
            "Confirme que o cliente autorizou mensagens pelo WhatsApp oficial.",
          );
          return;
        }

        contact.whatsappOptIn = true;
      }

      contacts.push(contact);
    }

    if (sendBillingModal.mode === "selected") {
      setIsRunningSelected(true);
    } else {
      const invoiceId = sendBillingModal.invoiceIds[0];
      if (invoiceId) {
        setRunningInvoiceAction({ invoiceId, action: "resend" });
      }
    }

    try {
      const result = await apiClient.runSelectedBilling({
        invoiceIds: sendBillingModal.invoiceIds,
        channels,
        contacts,
      });
      await fetchInvoices();
      const targetName = sendBillingModal.invoice?.name;
      setSuccessMsg(
        targetName
          ? `Reenvio iniciado para ${targetName}. ${result.message}`
          : result.message,
      );
      closeSendBillingModal();
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel iniciar as cobrancas."),
      );
    } finally {
      setIsRunningSelected(false);
      setRunningInvoiceAction(null);
    }
  }

  async function handleGeneratePayment(invoice: ParsedDebtor): Promise<void> {
    if (!canIssue) {
      setErrorMsg("Conclua a ativação financeira antes de emitir cobranças.");
      return;
    }
    const invoiceId = getInvoiceId(invoice);

    if (!invoiceId) {
      setSuccessMsg(null);
      setErrorMsg("Nao foi possivel identificar a fatura desta cobranca.");
      return;
    }

    const billingType =
      invoice.payment?.method ?? invoice.billing_type ?? "PIX";
    setErrorMsg(null);
    setSuccessMsg(null);
    setRunningInvoiceAction({ invoiceId, action: "generate" });

    try {
      const amount = Number(invoice.original_amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("O valor da cobrança é inválido para emissão.");
      }
      const quote = await apiClient.getPaymentFeeQuote(
        billingType,
        Math.round(amount * 100),
      );
      const expiresAt = invoice.payment?.expiresAt;
      const replacing = Boolean(
        invoice.payment?.generated &&
        expiresAt &&
        new Date(expiresAt).getTime() < Date.now(),
      );
      setFeePreview({ invoice, quote, replacing });
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error, "Nao foi possivel gerar a cobranca."));
    } finally {
      setRunningInvoiceAction(null);
    }
  }

  async function confirmPayment(newDueDate?: string): Promise<void> {
    if (!feePreview || !canIssue) return;
    const invoice = feePreview.invoice;
    const invoiceId = getInvoiceId(invoice);
    if (!invoiceId) return;
    setRunningInvoiceAction({ invoiceId, action: "generate" });
    setFeePreview(null);
    try {
      const response = newDueDate
        ? await apiClient.replaceExpiredPayment(invoiceId, newDueDate)
        : await apiClient.createPayment({
            invoiceId,
            billingType: feePreview.quote.billingMethod,
          });
      await fetchInvoices();
      setSuccessMsg(buildPaymentCreatedMessage(invoice, response));
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Não foi possível emitir a cobrança."),
      );
    } finally {
      setRunningInvoiceAction(null);
    }
  }

  async function handleCheckPaymentStatus(
    invoice: ParsedDebtor,
  ): Promise<void> {
    const invoiceId = getInvoiceId(invoice);

    if (!invoiceId) {
      setSuccessMsg(null);
      setErrorMsg("Nao foi possivel identificar a fatura desta cobranca.");
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setRunningInvoiceAction({ invoiceId, action: "status" });

    try {
      const response = await apiClient.getInvoicePaymentStatus(invoiceId);
      setSuccessMsg(buildPaymentStatusMessage(invoice, response));
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel consultar o status."),
      );
    } finally {
      setRunningInvoiceAction(null);
    }
  }

  async function handleCancelInvoice(invoice: ParsedDebtor): Promise<void> {
    const invoiceId = getInvoiceId(invoice);

    if (!invoiceId) {
      setSuccessMsg(null);
      setErrorMsg("Nao foi possivel identificar a fatura desta cobranca.");
      return;
    }

    const confirmed = window.confirm(
      `Cancelar a cobranca de ${invoice.name}? Esta acao impede novos envios e novas geracoes para esta fatura.`,
    );

    if (!confirmed) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setRunningInvoiceAction({ invoiceId, action: "cancel" });

    try {
      await apiClient.cancelInvoice(invoiceId);
      await fetchInvoices();
      setSuccessMsg(`Cobranca de ${invoice.name} cancelada com sucesso.`);
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel cancelar a cobranca."),
      );
    } finally {
      setRunningInvoiceAction(null);
    }
  }

  function updateManualForm<Field extends keyof ManualChargeForm>(
    field: Field,
    value: ManualChargeForm[Field],
  ): void {
    setManualForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  // New charges start with the company defaults (Configurações → Cobrança).
  function companyLateTerms(): LateTermsFormValues {
    return billingSettings
      ? lateTermsFormFromValues({
          fine: billingSettings.lateFinePercentage ?? 0,
          interest: billingSettings.lateInterestMonthlyPercentage ?? 0,
          days: billingSettings.paymentDaysAfterDue ?? 30,
        })
      : EMPTY_LATE_TERMS;
  }

  function openNewChargeModal(): void {
    setInvoiceTargetDebtor(null);
    setPickedClient(null);
    setManualForm({ ...initialManualChargeForm, lateTerms: companyLateTerms() });
    setIsModalOpen(true);
  }

  function closeManualModal(): void {
    setIsModalOpen(false);
    setInvoiceTargetDebtor(null);
    setPickedClient(null);
    setManualForm(initialManualChargeForm);
  }

  function openDebtorSettings(debtor: ParsedDebtor): void {
    if (!debtor.debtorId) {
      setErrorMsg("Nao foi possivel identificar o devedor desta cobranca.");
      return;
    }

    setSelectedDebtor(debtor);
  }

  function openPaymentHistory(debtor: ParsedDebtor): void {
    if (!debtor.debtorId) {
      setErrorMsg("Nao foi possivel identificar o devedor desta cobranca.");
      return;
    }

    setHistoryTargetDebtor(debtor);
  }

  function openInvoiceModal(debtor: ParsedDebtor): void {
    if (!debtor.debtorId) {
      setErrorMsg("Nao foi possivel identificar o devedor desta cobranca.");
      return;
    }

    setInvoiceTargetDebtor(debtor);
    const enabledMethods: PaymentMethod[] = billingSettings?.enabledBillingMethods.filter((method) => method !== "BOLETO") ?? ["BOLIX"];
    const currentBillingType = debtor.billing_type === "BOLETO" ? "BOLIX" : debtor.billing_type ?? "BOLIX";
    const billingType = enabledMethods.includes(currentBillingType)
      ? currentBillingType
      : (enabledMethods[0] ?? "BOLIX");
    setManualForm({
      ...initialManualChargeForm,
      billingType,
      lateTerms: companyLateTerms(),
    });
    setIsModalOpen(true);
  }

  async function handleManualSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setErrorMsg(null);
    setIsSavingInvoice(true);

    const amount = Number(manualForm.amount);
    const dueDay = Number(manualForm.dueDay);

    try {
      const debtorId = invoiceTargetDebtor?.debtorId ?? pickedClient?.debtorId;
      if (!debtorId) {
        throw new Error("Escolha o cliente da cobrança.");
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Informe um valor de fatura valido.");
      }

      if (
        manualForm.recurring &&
        (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
      ) {
        throw new Error("Informe um dia de vencimento entre 1 e 31.");
      }

      if (!manualForm.recurring && !manualForm.dueDate) {
        throw new Error("Informe a data de vencimento.");
      }

      // Optional: an empty field uses the company default, zero means none.
      const parsedLateTerms = parseLateTermsForm(manualForm.lateTerms);
      if ("error" in parsedLateTerms) {
        throw new Error(parsedLateTerms.error);
      }
      const lateTerms = {
        late_fine_percentage: parsedLateTerms.terms.fine,
        late_interest_monthly_percentage: parsedLateTerms.terms.interest,
        payment_days_after_due: parsedLateTerms.terms.days,
      };

      await apiClient.createDebtorInvoice(debtorId, {
        original_amount: amount,
        due_date: manualForm.recurring ? undefined : manualForm.dueDate,
        billing_type: manualForm.billingType,
        recurring: manualForm.recurring,
        due_day: manualForm.recurring ? dueDay : undefined,
        ...lateTerms,
        ...(isEducationSegment
          ? {
              studentName: manualForm.studentName.trim() || undefined,
              studentEnrollment:
                manualForm.studentEnrollment.trim() || undefined,
              studentGroup: manualForm.studentGroup.trim() || undefined,
            }
          : {}),
      });

      closeManualModal();
      await fetchInvoices();
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error, "Nao foi possivel salvar a fatura."));
    } finally {
      setIsSavingInvoice(false);
    }
  }

  const paymentMethods: PaymentMethod[] = billingSettings?.enabledBillingMethods
    .length
    ? billingSettings.enabledBillingMethods.filter((method) => method !== "BOLETO")
    : ["BOLIX"];
  const modalTitle = invoiceTargetDebtor
    ? `Nova cobrança para ${invoiceTargetDebtor.name}`
    : "Nova cobrança";
  const sendBillingTitle =
    sendBillingModal?.mode === "resend"
      ? `Reenviar cobrança para ${sendBillingModal.invoice?.name ?? "devedor"}`
      : "Enviar cobranças selecionadas";
  const sendBillingCount = sendBillingModal?.invoiceIds.length ?? 0;
  const isSendingBilling =
    isRunningSelected || runningInvoiceAction?.action === "resend";

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Cobranças
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Acompanhe, filtre e envie as cobranças da empresa.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                setImportError(null);
                setIsUploadingCSV(true);
              }}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <FileUp size={17} />
              Importar planilha
            </button>

            <button
              type="button"
              onClick={openNewChargeModal}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              <Plus size={17} />
              Nova cobrança
            </button>
          </div>
        </header>

        {errorMsg && (
          <div className="flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
            <span>{successMsg}</span>
          </div>
        )}

        {query.debtorId && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            Mostrando as cobranças de um cliente.
            <button
              type="button"
              onClick={() => updateQuery({ debtorId: undefined })}
              className="font-semibold underline underline-offset-2"
            >
              Ver todas
            </button>
          </div>
        )}

        {isUploadingCSV ? (
          <section className="rounded-md border border-slate-200 bg-white p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-slate-900">
                  Importar cobranças por planilha
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Cada linha é ligada ao cliente com o mesmo CPF/CNPJ; quem não existe é cadastrado. Divergências com o cadastro são revisadas antes de importar.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setImportError(null);
                  resetImport();
                  setIsUploadingCSV(false);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900"
              >
                <ArrowLeft size={17} />
                Voltar para a lista
              </button>
            </div>

            {importError && (
              <div className="mb-4 flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 shrink-0" size={18} />
                <span>{importError}</span>
              </div>
            )}

            {importRows && importDecisions ? (
              <ImportSummary
                rows={importRows.length}
                clients={importClients}
                decisions={importDecisions}
                busy={isImporting}
                whatsappConsent={importConsent}
                onWhatsappConsentChange={setImportConsent}
                onConfirm={() => void confirmImport()}
                onCancel={resetImport}
              />
            ) : isImporting ? (
              <p className="flex items-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 size={18} className="animate-spin" />
                Analisando a planilha
              </p>
            ) : (
              <UploadCSV
                showEducationFields={isEducationSegment}
                onUploadSuccess={(importedDebtors) => {
                  void handleUploadSuccess(importedDebtors);
                }}
              />
            )}
          </section>
        ) : (
          <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <InvoiceFilters
              values={{ ...query, search: searchInput }}
              searchPlaceholder={
                isEducationSegment
                  ? "Buscar por responsável, aluno, CPF/CNPJ ou WhatsApp"
                  : "Buscar por nome, CPF/CNPJ, WhatsApp ou e-mail"
              }
              onSearchChange={setSearchInput}
              onChange={updateQuery}
            />

            {listError ? (
              <div
                role="alert"
                className="flex min-h-64 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-rose-700"
              >
                <AlertCircle size={28} aria-hidden="true" />
                <p>{listError}</p>
                <button
                  type="button"
                  onClick={() => void fetchInvoices()}
                  className="rounded-md border border-rose-200 bg-white px-3 py-1.5 font-semibold hover:bg-rose-50"
                >
                  Tentar de novo
                </button>
              </div>
            ) : debtors.length === 0 && isLoading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="animate-spin" size={18} />
                Carregando cobranças
              </div>
            ) : debtors.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center">
                <FileSpreadsheet size={34} className="text-slate-300" aria-hidden="true" />
                {hasFilters ? (
                  <>
                    <h2 className="mt-3 font-semibold text-slate-900">
                      Nenhuma cobrança encontrada
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Ajuste a busca ou os filtros.
                    </p>
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Limpar filtros
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="mt-3 font-semibold text-slate-900">
                      Nenhuma cobrança cadastrada
                    </h2>
                    <p className="mt-1 max-w-md text-sm text-slate-500">
                      Importe uma planilha ou crie uma cobrança para um cliente
                      cadastrado.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div
                aria-busy={isLoading}
                className={isLoading ? "opacity-60 transition-opacity" : "transition-opacity"}
              >
                <InvoiceTable
                  canIssue={canIssue}
                  data={debtors}
                  pageCount={Math.ceil(total / pagination.pageSize)}
                  total={total}
                  pagination={pagination}
                  onPaginationChange={changePagination}
                  sort={query.sort}
                  onSortChange={(sort) => updateQuery({ sort })}
                  onConfigureDebtor={openDebtorSettings}
                  onAddInvoice={openInvoiceModal}
                  onRunSelectedInvoices={(invoiceIds) => {
                    openSelectedSendModal(invoiceIds);
                  }}
                  isRunningSelected={isRunningSelected}
                  onGeneratePayment={(invoice) => {
                    void handleGeneratePayment(invoice);
                  }}
                  onResendInvoice={(invoice) => {
                    openResendModal(invoice);
                  }}
                  onCheckPaymentStatus={(invoice) => {
                    void handleCheckPaymentStatus(invoice);
                  }}
                  onCancelInvoice={(invoice) => {
                    void handleCancelInvoice(invoice);
                  }}
                  onViewPaymentHistory={openPaymentHistory}
                  runningInvoiceAction={runningInvoiceAction}
                  showEducationFields={isEducationSegment}
                />
              </div>
            )}
          </section>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 transition-all duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-charge-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md bg-white shadow-xl transition-all duration-200"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="new-charge-title" className="font-semibold text-slate-900">
                  {modalTitle}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {invoiceTargetDebtor
                    ? "Preencha os dados da nova cobrança deste cliente."
                    : "Escolha um cliente cadastrado e preencha os dados da cobrança."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeManualModal}
                className="rounded-md p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} noValidate={!pickedClient && !invoiceTargetDebtor}>
              <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
                {errorMsg && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2"
                  >
                    <AlertCircle className="mt-0.5 shrink-0" size={16} />
                    {errorMsg}
                  </p>
                )}
                {!invoiceTargetDebtor && (
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className="text-xs font-semibold uppercase text-slate-500">
                      Cliente
                    </span>
                    <ClientPicker value={pickedClient} onChange={setPickedClient} />
                  </div>
                )}

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Forma de Pagamento
                  </span>
                  <select
                    required
                    value={manualForm.billingType}
                    onChange={(event) =>
                      updateManualForm(
                        "billingType",
                        event.target.value as PaymentMethod,
                      )
                    }
                    className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    {paymentMethods.map((method) => {
                      return (
                        <option key={method} value={method}>
                          {formatBillingMethodRateLabel(
                            method,
                            billingSettings,
                          )}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Valor (R$)
                  </span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={manualForm.amount}
                    onChange={(event) =>
                      updateManualForm("amount", event.target.value)
                    }
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                {isEducationSegment && (
                  <>
                    <label className="flex flex-col gap-1.5 sm:col-span-2">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Nome do Aluno
                      </span>
                      <input
                        type="text"
                        value={manualForm.studentName}
                        onChange={(event) =>
                          updateManualForm("studentName", event.target.value)
                        }
                        className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Matricula
                      </span>
                      <input
                        type="text"
                        value={manualForm.studentEnrollment}
                        onChange={(event) =>
                          updateManualForm(
                            "studentEnrollment",
                            event.target.value,
                          )
                        }
                        className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Turma/Curso
                      </span>
                      <input
                        type="text"
                        value={manualForm.studentGroup}
                        onChange={(event) =>
                          updateManualForm("studentGroup", event.target.value)
                        }
                        className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>
                  </>
                )}

                <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={manualForm.recurring}
                    onChange={(event) =>
                      updateManualForm("recurring", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm font-medium text-slate-700">
                    Cobrança recorrente mensal
                  </span>
                </label>

                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    {manualForm.recurring
                      ? "Dia de Vencimento"
                      : "Data de Vencimento"}
                  </span>
                  <input
                    required
                    type={manualForm.recurring ? "number" : "date"}
                    min={manualForm.recurring ? "1" : undefined}
                    max={manualForm.recurring ? "31" : undefined}
                    value={
                      manualForm.recurring
                        ? manualForm.dueDay
                        : manualForm.dueDate
                    }
                    onChange={(event) =>
                      updateManualForm(
                        manualForm.recurring ? "dueDay" : "dueDate",
                        event.target.value,
                      )
                    }
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
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
                    idPrefix="manual-charge-late-terms"
                    values={manualForm.lateTerms}
                    onChange={(values) => updateManualForm("lateTerms", values)}
                    disabled={isSavingInvoice}
                    placeholders={{
                      fine: "Padrão da empresa",
                      interest: "Padrão da empresa",
                      days: "Padrão da empresa",
                    }}
                    individualDebtor={isIndividualDocument(
                      invoiceTargetDebtor?.document ?? pickedClient?.document ?? "",
                    )}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Vem com o padrão de Configurações → Cobrança. Campo vazio
                    usa o padrão; 0 significa sem multa, sem juros ou sem
                    pagamento após o vencimento.
                  </p>
                </fieldset>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeManualModal}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingInvoice}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingInvoice && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  Salvar Cobrança
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reviewQueue && (
        <ImportReview
          clients={reviewQueue}
          onValidatePhone={validateImportPhone}
          onComplete={(decisions) => {
            setReviewQueue(null);
            setImportDecisions(decisions);
          }}
          onCancel={resetImport}
        />
      )}

      {feePreview && (
        <PaymentFeeConfirmation
          quote={feePreview.quote}
          replacing={feePreview.replacing}
          busy={Boolean(runningInvoiceAction)}
          onCancel={() => setFeePreview(null)}
          onConfirm={confirmPayment}
        />
      )}
      {sendBillingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 transition-all duration-200">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md bg-white shadow-xl transition-all duration-200">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">
                  {sendBillingTitle}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {sendBillingModal.invoice
                    ? "Escolha os canais e atualize os contatos antes do envio."
                    : `${sendBillingCount} cobrança${
                        sendBillingCount === 1 ? "" : "s"
                      } será${sendBillingCount === 1 ? "" : "o"} enfileirada${
                        sendBillingCount === 1 ? "" : "s"
                      } com os contatos cadastrados.`}
                </p>
              </div>

              <button
                type="button"
                onClick={closeSendBillingModal}
                disabled={isSendingBilling}
                className="rounded-md p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Fechar modal de envio"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitSendBillingModal}>
              <div className="space-y-5 px-5 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Canais de envio
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="flex min-h-16 items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 transition hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={sendBillingForm.email}
                        onChange={(event) =>
                          updateSendBillingForm("email", event.target.checked)
                        }
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="flex min-w-0 items-start gap-2 text-sm font-medium text-slate-700">
                        <Mail
                          size={17}
                          className="mt-0.5 shrink-0 text-slate-500"
                        />
                        <span>E-mail</span>
                      </span>
                    </label>

                    <label className="flex min-h-16 items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 transition hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={sendBillingForm.whatsapp}
                        onChange={(event) =>
                          updateSendBillingForm(
                            "whatsapp",
                            event.target.checked,
                          )
                        }
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="flex min-w-0 items-start gap-2 text-sm font-medium text-slate-700">
                        <MessageCircle
                          size={17}
                          className="mt-0.5 shrink-0 text-emerald-600"
                        />
                        <span>WhatsApp</span>
                      </span>
                    </label>
                  </div>
                </div>

                {sendBillingModal.invoice ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {sendBillingForm.email && (
                      <label className="flex flex-col gap-1.5 sm:col-span-2">
                        <span className="text-xs font-semibold uppercase text-slate-500">
                          E-mail do devedor
                        </span>
                        <input
                          required
                          type="email"
                          value={sendBillingForm.emailAddress}
                          onChange={(event) =>
                            updateSendBillingForm(
                              "emailAddress",
                              event.target.value,
                            )
                          }
                          placeholder="financeiro@cliente.com"
                          className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                        />
                      </label>
                    )}

                    {sendBillingForm.whatsapp && (
                      <>
                        <label className="flex flex-col gap-1.5 sm:col-span-2">
                          <span className="text-xs font-semibold uppercase text-slate-500">
                            WhatsApp do devedor
                          </span>
                          <input
                            required
                            type="tel"
                            value={sendBillingForm.whatsappNumber}
                            onChange={(event) =>
                              updateSendBillingForm(
                                "whatsappNumber",
                                event.target.value,
                              )
                            }
                            placeholder="+55 (11) 99999-9999"
                            className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                          />
                        </label>

                        <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={sendBillingForm.whatsappOptIn}
                            onChange={(event) =>
                              updateSendBillingForm(
                                "whatsappOptIn",
                                event.target.checked,
                              )
                            }
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm font-medium text-slate-700">
                            Cliente autorizou mensagens de cobrança pelo
                            WhatsApp oficial
                          </span>
                        </label>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    Para envio em lote, use os contatos já cadastrados em cada
                    devedor. Para corrigir um contato específico, use Reenviar
                    na linha da cobrança.
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeSendBillingModal}
                  disabled={!canIssue || isSendingBilling}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSendingBilling}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSendingBilling ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                  Enviar cobrança
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedDebtor?.debtorId && (
        <DebtorSettingsModal
          debtorId={selectedDebtor.debtorId}
          debtorName={selectedDebtor.name}
          onClose={() => setSelectedDebtor(null)}
          onSaved={fetchInvoices}
        />
      )}

      {historyTargetDebtor?.debtorId && (
        <DebtorPaymentHistoryModal
          debtorId={historyTargetDebtor.debtorId}
          debtorName={historyTargetDebtor.name}
          onClose={() => setHistoryTargetDebtor(null)}
        />
      )}
    </main>
  );
}

export default function CobrancasPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-full bg-slate-50">
          <div className="mx-auto flex min-h-80 items-center justify-center p-4 text-sm text-slate-500 lg:p-8">
            <Loader2 className="mr-2 animate-spin" size={18} />
            Carregando cobrancas
          </div>
        </main>
      }
    >
      <CobrancasContent />
    </Suspense>
  );
}
