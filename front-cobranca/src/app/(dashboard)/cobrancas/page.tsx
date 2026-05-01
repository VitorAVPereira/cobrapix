"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { DebtorSettingsModal } from "@/components/features/DebtorSettingsModal";
import { InvoiceTable } from "@/components/features/InvoiceTable";
import { UploadCSV } from "@/components/features/UploadCSV";
import type {
  ParsedDebtor,
  PaymentMethod,
} from "@/components/features/UploadCSV";
import type { BillingSettings } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import {
  formatWhatsAppNumber,
  normalizeWhatsAppNumber,
} from "@/lib/whatsapp-number";

interface ApiErrorData {
  details?: string[];
  message?: string;
}

interface ManualChargeForm {
  customerName: string;
  email: string;
  whatsapp: string;
  amount: string;
  dueDate: string;
  billingType: PaymentMethod;
  recurring: boolean;
  dueDay: string;
}

const initialManualChargeForm: ManualChargeForm = {
  customerName: "",
  email: "",
  whatsapp: "",
  amount: "",
  dueDate: "",
  billingType: "PIX",
  recurring: false,
  dueDay: "10",
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

export default function CobrancasPage() {
  const apiClient = useApiClient();
  const [debtors, setDebtors] = useState<ParsedDebtor[]>([]);
  const [selectedDebtor, setSelectedDebtor] = useState<ParsedDebtor | null>(null);
  const [invoiceTargetDebtor, setInvoiceTargetDebtor] =
    useState<ParsedDebtor | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadingCSV, setIsUploadingCSV] = useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isRunningSelected, setIsRunningSelected] = useState(false);
  const [billingSettings, setBillingSettings] =
    useState<BillingSettings | null>(null);
  const [manualForm, setManualForm] = useState<ManualChargeForm>(
    initialManualChargeForm,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const fetchInvoices = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const data = await apiClient.getInvoices();
      setDebtors(isParsedDebtorArray(data) ? data : []);
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel carregar as cobrancas."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    async function fetchBillingSettings(): Promise<void> {
      try {
        const settings = await apiClient.getBillingSettings();
        setBillingSettings(settings);
      } catch {
        setBillingSettings(null);
      }
    }

    void fetchBillingSettings();
  }, [apiClient]);

  const filteredDebtors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return debtors;
    }

    return debtors.filter((debtor) => {
      const formattedPhoneNumber = formatWhatsAppNumber(debtor.phone_number);
      const searchableFields = [
        debtor.name,
        debtor.document || "",
        debtor.phone_number,
        formattedPhoneNumber,
        formattedPhoneNumber.replace(/\D/g, ""),
        debtor.email || "",
      ];

      return searchableFields.some((field) =>
        field.toLowerCase().includes(query),
      );
    });
  }, [debtors, searchQuery]);

  async function handleUploadSuccess(
    importedDebtors: ParsedDebtor[],
  ): Promise<void> {
    setImportError(null);

    try {
      await apiClient.importInvoices(importedDebtors);
      setIsUploadingCSV(false);
      await fetchInvoices();
    } catch (error: unknown) {
      setImportError(
        getErrorMessage(error, "Nao foi possivel importar a planilha."),
      );
    }
  }

  async function handleRunSelectedInvoices(invoiceIds: string[]): Promise<void> {
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsRunningSelected(true);

    try {
      const result = await apiClient.runSelectedBilling(invoiceIds);
      await fetchInvoices();
      setSuccessMsg(result.message);
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel iniciar as cobrancas."),
      );
    } finally {
      setIsRunningSelected(false);
    }
  }

  function updateManualForm<Field extends keyof ManualChargeForm>(
    field: Field,
    value: ManualChargeForm[Field],
  ): void {
    setManualForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  function closeManualModal(): void {
    setIsModalOpen(false);
    setInvoiceTargetDebtor(null);
    setManualForm(initialManualChargeForm);
  }

  function openDebtorSettings(debtor: ParsedDebtor): void {
    if (!debtor.debtorId) {
      setErrorMsg("Nao foi possivel identificar o devedor desta cobranca.");
      return;
    }

    setSelectedDebtor(debtor);
  }

  function openInvoiceModal(debtor: ParsedDebtor): void {
    if (!debtor.debtorId) {
      setErrorMsg("Nao foi possivel identificar o devedor desta cobranca.");
      return;
    }

    setInvoiceTargetDebtor(debtor);
    setManualForm({
      ...initialManualChargeForm,
      billingType: debtor.billing_type ?? "PIX",
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
    const phoneNumber = normalizeWhatsAppNumber(manualForm.whatsapp);

    try {
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

      if (invoiceTargetDebtor?.debtorId) {
        await apiClient.createDebtorInvoice(invoiceTargetDebtor.debtorId, {
          original_amount: amount,
          due_date: manualForm.recurring ? undefined : manualForm.dueDate,
          billing_type: manualForm.billingType,
          recurring: manualForm.recurring,
          due_day: manualForm.recurring ? dueDay : undefined,
        });
      } else {
        await apiClient.createInvoice({
          name: manualForm.customerName.trim(),
          email: manualForm.email.trim(),
          phone_number: phoneNumber,
          original_amount: amount,
          due_date: manualForm.recurring ? undefined : manualForm.dueDate,
          billing_type: manualForm.billingType,
          recurring: manualForm.recurring,
          due_day: manualForm.recurring ? dueDay : undefined,
        });
      }

      closeManualModal();
      await fetchInvoices();
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error, "Nao foi possivel salvar a fatura."));
    } finally {
      setIsSavingInvoice(false);
    }
  }

  const paymentMethods: PaymentMethod[] = ["PIX", "BOLETO", "BOLIX"];
  const modalTitle = invoiceTargetDebtor
    ? `Nova fatura para ${invoiceTargetDebtor.name}`
    : "Adicionar cobrança manual";

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Gestão de Cobranças
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Gira os devedores, adicione novas faturas ou importe listas em
              lote.
            </p>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative w-full lg:w-80">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={18}
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Pesquisar por nome, CPF ou WhatsApp..."
                className="h-11 w-full rounded-md border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setImportError(null);
                setIsUploadingCSV(true);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900"
            >
              <FileUp size={17} />
              Importar CSV
            </button>

            <button
              type="button"
              onClick={() => {
                setInvoiceTargetDebtor(null);
                setManualForm(initialManualChargeForm);
                setIsModalOpen(true);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-emerald-700"
            >
              <Plus size={17} />
              Adicionar Manual
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

        {isUploadingCSV ? (
          <section className="rounded-md border border-slate-200 bg-white p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-slate-900">
                  Importar cobranças por CSV
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Envie uma planilha para cadastrar cobranças em lote.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setImportError(null);
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

            <UploadCSV
              onUploadSuccess={(importedDebtors) => {
                void handleUploadSuccess(importedDebtors);
              }}
            />
          </section>
        ) : (
          <section className="flex flex-col gap-4">
            {isLoading ? (
              <div className="flex min-h-80 flex-col items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                <Loader2 className="mb-3 animate-spin" size={34} />
                <p className="text-sm">Carregando cobranças...</p>
              </div>
            ) : debtors.length > 0 ? (
              <>
                <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                  <span>
                    <strong className="font-semibold text-slate-900">
                      {filteredDebtors.length}
                    </strong>{" "}
                    de {debtors.length} cobranças
                  </span>
                </div>

                <InvoiceTable
                  data={filteredDebtors}
                  onConfigureDebtor={openDebtorSettings}
                  onAddInvoice={openInvoiceModal}
                  onRunSelectedInvoices={(invoiceIds) => {
                    void handleRunSelectedInvoices(invoiceIds);
                  }}
                  isRunningSelected={isRunningSelected}
                />

                {searchQuery && filteredDebtors.length === 0 && (
                  <div className="rounded-md border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500">
                    Nenhum devedor encontrado para &quot;{searchQuery}&quot;.
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                  <FileSpreadsheet size={28} />
                </div>
                <h2 className="font-semibold text-slate-900">
                  Nenhuma cobrança cadastrada
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                  Importe um CSV ou adicione uma fatura manualmente para começar
                  a operação de cobrança.
                </p>
              </div>
            )}
          </section>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 transition-all duration-200">
          <div className="w-full max-w-lg rounded-md bg-white shadow-xl transition-all duration-200">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">
                  {modalTitle}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {invoiceTargetDebtor
                    ? "Preencha os dados da nova fatura deste devedor."
                    : "Preencha os dados principais da nova fatura."}
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

            <form onSubmit={handleManualSubmit}>
              <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
                {!invoiceTargetDebtor && (
                  <>
                    <label className="flex flex-col gap-1.5 sm:col-span-2">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Nome do Devedor
                      </span>
                      <input
                        required
                        type="text"
                        value={manualForm.customerName}
                        onChange={(event) =>
                          updateManualForm("customerName", event.target.value)
                        }
                        className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5 sm:col-span-2">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Email
                      </span>
                      <input
                        required
                        type="email"
                        value={manualForm.email}
                        onChange={(event) =>
                          updateManualForm("email", event.target.value)
                        }
                        className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        WhatsApp (pais + DDD)
                      </span>
                      <input
                        required
                        type="tel"
                        value={manualForm.whatsapp}
                        placeholder="+55 (11) 99999-9999"
                        onChange={(event) =>
                          updateManualForm("whatsapp", event.target.value)
                        }
                        className="h-11 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      />
                    </label>
                  </>
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
                      const tariff = billingSettings?.tariffs[method];
                      const label =
                        method === "BOLETO"
                          ? "Boleto"
                          : method === "BOLIX"
                            ? "Bolix"
                            : "PIX";

                      return (
                        <option key={method} value={method}>
                          {tariff
                            ? `${label} - ${tariff.combinedLabel}`
                            : label}
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
                  {isSavingInvoice && <Loader2 size={16} className="animate-spin" />}
                  Salvar Cobrança
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
        />
      )}
    </main>
  );
}
