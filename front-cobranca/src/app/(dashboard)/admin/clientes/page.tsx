"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import {
  Building2,
  FileCheck2,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  AdminClient,
  BillingMethod,
  CompanyStatus,
  CreateAdminClientInput,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const billingMethods: BillingMethod[] = ["PIX", "BOLETO", "BOLIX"];
const statusOptions: CompanyStatus[] = ["ACTIVE", "INACTIVE", "SUSPENDED"];

interface ClientFormState {
  corporateName: string;
  document: string;
  email: string;
  phoneNumber: string;
  status: CompanyStatus;
  userName: string;
  userEmail: string;
  userPassword: string;
  enabledBillingMethods: BillingMethod[];
  preferredBillingMethod: BillingMethod;
  onTimeSplitPercentage: string;
  overdueSplitPercentage: string;
  metaPhoneNumberId: string;
  metaBusinessAccountId: string;
  metaAccessToken: string;
  metaBusinessPhoneNumber: string;
  efiClientId: string;
  efiClientSecret: string;
  efiPayeeCode: string;
  efiAccountNumber: string;
  efiAccountDigit: string;
  efiPixKey: string;
  efiCertificatePassword: string;
  efiCertificateBase64: string;
  legalRepresentative: string;
  legalRepresentativeCpf: string;
  legalRepresentativeBirthDate: string;
  postalCode: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  bankAccountDigit: string;
}

const initialForm: ClientFormState = {
  corporateName: "",
  document: "",
  email: "",
  phoneNumber: "",
  status: "ACTIVE",
  userName: "",
  userEmail: "",
  userPassword: "",
  enabledBillingMethods: ["PIX"],
  preferredBillingMethod: "PIX",
  onTimeSplitPercentage: "3.50",
  overdueSplitPercentage: "12.00",
  metaPhoneNumberId: "",
  metaBusinessAccountId: "",
  metaAccessToken: "",
  metaBusinessPhoneNumber: "",
  efiClientId: "",
  efiClientSecret: "",
  efiPayeeCode: "",
  efiAccountNumber: "",
  efiAccountDigit: "",
  efiPixKey: "",
  efiCertificatePassword: "",
  efiCertificateBase64: "",
  legalRepresentative: "",
  legalRepresentativeCpf: "",
  legalRepresentativeBirthDate: "",
  postalCode: "",
  street: "",
  number: "",
  district: "",
  city: "",
  state: "SP",
  bankName: "",
  bankAgency: "",
  bankAccount: "",
  bankAccountDigit: "",
};

const CERTIFICATE_ACCEPT =
  ".p12,.pfx,.pem,application/x-pkcs12,application/pkcs12,application/octet-stream";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function percentToBps(value: string): number {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

function methodLabel(method: BillingMethod): string {
  if (method === "BOLETO") return "Boleto";
  if (method === "BOLIX") return "Bolix";
  return "Pix";
}

function readCertificateFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("Nao foi possivel ler o certificado selecionado."));
    };

    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== "string") {
        reject(new Error("O certificado selecionado nao pode ser lido."));
        return;
      }

      const commaIndex = result.indexOf(",");
      const base64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;

      if (!base64) {
        reject(new Error("O certificado selecionado esta vazio."));
        return;
      }

      resolve(base64);
    };

    reader.readAsDataURL(file);
  });
}

export default function AdminClientsPage() {
  const apiClient = useApiClient();
  const { data: session } = useSession();
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [form, setForm] = useState<ClientFormState>(initialForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReadingCertificate, setIsReadingCertificate] = useState(false);
  const [certificateFileName, setCertificateFileName] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPlatformAdmin = session?.user.role === "PLATFORM_ADMIN";
  const canSubmitEfi = useMemo(
    () => Boolean(form.efiClientId && form.efiClientSecret && form.efiPayeeCode),
    [form.efiClientId, form.efiClientSecret, form.efiPayeeCode],
  );

  const loadClients = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      setClients(await apiClient.getAdminClients());
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError, "Nao foi possivel carregar clientes."));
    } finally {
      setIsLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    if (isPlatformAdmin) {
      void loadClients();
    } else {
      setIsLoading(false);
    }
  }, [isPlatformAdmin, loadClients]);

  function updateField<K extends keyof ClientFormState>(
    field: K,
    value: ClientFormState[K],
  ): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleMethod(method: BillingMethod): void {
    setForm((current) => {
      const enabled = current.enabledBillingMethods.includes(method)
        ? current.enabledBillingMethods.filter((item) => item !== method)
        : [...current.enabledBillingMethods, method];
      const normalized = enabled.length > 0 ? enabled : [method];
      const preferred = normalized.includes(current.preferredBillingMethod)
        ? current.preferredBillingMethod
        : normalized[0];

      return {
        ...current,
        enabledBillingMethods: normalized,
        preferredBillingMethod: preferred,
      };
    });
  }

  async function handleCertificateChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    setError(null);
    setMessage(null);

    if (!file) {
      setCertificateFileName(null);
      setForm((current) => ({ ...current, efiCertificateBase64: "" }));
      return;
    }

    setIsReadingCertificate(true);

    try {
      const certificateBase64 = await readCertificateFileAsBase64(file);
      setCertificateFileName(file.name);
      setForm((current) => ({
        ...current,
        efiCertificateBase64: certificateBase64,
      }));
    } catch (readError: unknown) {
      event.target.value = "";
      setCertificateFileName(null);
      setForm((current) => ({ ...current, efiCertificateBase64: "" }));
      setError(
        getErrorMessage(readError, "Nao foi possivel carregar o certificado."),
      );
    } finally {
      setIsReadingCertificate(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (isReadingCertificate) {
      setError("Aguarde a leitura do certificado antes de cadastrar o cliente.");
      return;
    }

    if (canSubmitEfi && !form.efiCertificateBase64) {
      setError("Envie o certificado Efí antes de cadastrar a conta do cliente.");
      return;
    }

    if (canSubmitEfi && !form.efiCertificatePassword) {
      setError("Informe a senha do certificado Efí.");
      return;
    }

    setIsSaving(true);

    const payload: CreateAdminClientInput = {
      company: {
        corporateName: form.corporateName,
        document: form.document,
        email: form.email,
        phoneNumber: form.phoneNumber,
        status: form.status,
      },
      firstUser: {
        name: form.userName,
        email: form.userEmail,
        password: form.userPassword,
      },
      billing: {
        enabledBillingMethods: form.enabledBillingMethods,
        preferredBillingMethod: form.preferredBillingMethod,
        onTimeSplitPercentageBps: percentToBps(form.onTimeSplitPercentage),
        overdueSplitPercentageBps: percentToBps(form.overdueSplitPercentage),
      },
    };

    if (
      form.metaPhoneNumberId &&
      form.metaBusinessAccountId &&
      form.metaAccessToken
    ) {
      payload.meta = {
        phoneNumberId: form.metaPhoneNumberId,
        businessAccountId: form.metaBusinessAccountId,
        accessToken: form.metaAccessToken,
        businessPhoneNumber: form.metaBusinessPhoneNumber || undefined,
        defaultLanguage: "pt_BR",
      };
    }

    if (canSubmitEfi) {
      payload.efi = {
        corporateName: form.corporateName,
        cnpj: form.document,
        email: form.email,
        phoneNumber: form.phoneNumber,
        legalRepresentative: form.legalRepresentative,
        legalRepresentativeCpf: form.legalRepresentativeCpf,
        legalRepresentativeBirthDate: form.legalRepresentativeBirthDate,
        postalCode: form.postalCode,
        street: form.street,
        number: form.number,
        district: form.district,
        city: form.city,
        state: form.state.toUpperCase(),
        bankName: form.bankName,
        bankAgency: form.bankAgency,
        bankAccount: form.bankAccount,
        bankAccountDigit: form.bankAccountDigit,
        bankAccountType: "CHECKING",
        environment: "homologation",
        efiClientId: form.efiClientId,
        efiClientSecret: form.efiClientSecret,
        efiPayeeCode: form.efiPayeeCode,
        efiAccountNumber: form.efiAccountNumber,
        efiAccountDigit: form.efiAccountDigit,
        efiPixKey: form.efiPixKey,
        efiCertificatePath: "",
        efiCertificatePassword: form.efiCertificatePassword,
        efiCertificateBase64: form.efiCertificateBase64,
        gatewayStatus: "ACTIVE",
      };
    }

    try {
      await apiClient.createAdminClient(payload);
      setForm(initialForm);
      setCertificateFileName(null);
      setMessage("Cliente cadastrado.");
      await loadClients();
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError, "Nao foi possivel cadastrar cliente."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResetPassword(clientId: string): Promise<void> {
    setError(null);
    setMessage(null);

    try {
      const result = await apiClient.resetAdminClientPassword(clientId);
      setMessage(`Senha temporaria: ${result.temporaryPassword}`);
    } catch (resetError: unknown) {
      setError(getErrorMessage(resetError, "Nao foi possivel resetar a senha."));
    }
  }

  if (!isPlatformAdmin) {
    return (
      <main className="min-h-full bg-slate-50 p-6">
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-700">
          Acesso restrito.
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 lg:p-8">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Clientes CobraPix
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Onboarding interno de empresas, acessos, taxas e integrações.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadClients()}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
        </header>

        {(error || message) && (
          <div
            className={`rounded-md border px-4 py-3 text-sm ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {error ?? message}
          </div>
        )}

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
              <Building2 size={18} className="text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                Clientes cadastrados
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Empresa</th>
                    <th className="px-4 py-3">Metodos</th>
                    <th className="px-4 py-3">Taxas</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Acesso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-slate-500">
                        Carregando...
                      </td>
                    </tr>
                  ) : clients.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-slate-500">
                        Nenhum cliente cadastrado.
                      </td>
                    </tr>
                  ) : (
                    clients.map((client) => (
                      <tr key={client.id} className="align-top">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">
                            {client.corporateName}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {client.email}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {client.enabledBillingMethods
                            .map(methodLabel)
                            .join(", ")}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <p>No prazo: {formatBps(client.onTimeSplitPercentageBps)}</p>
                          <p>Recuperada: {formatBps(client.overdueSplitPercentageBps)}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <p>{client.status}</p>
                          <p className="text-xs text-slate-500">
                            Efí {client.efi.status ?? "PENDING"} · WhatsApp{" "}
                            {client.whatsappStatus}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void handleResetPassword(client.id)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            <KeyRound size={14} />
                            Resetar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="rounded-md border border-slate-200 bg-white"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
              <Plus size={18} className="text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                Novo cliente
              </h2>
            </div>

            <div className="grid gap-4 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Razao social" value={form.corporateName} onChange={(value) => updateField("corporateName", value)} required />
                <Input label="CNPJ" value={form.document} onChange={(value) => updateField("document", value)} required />
                <Input label="E-mail empresa" type="email" value={form.email} onChange={(value) => updateField("email", value)} required />
                <Input label="Telefone" value={form.phoneNumber} onChange={(value) => updateField("phoneNumber", value)} required />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Input label="Nome admin" value={form.userName} onChange={(value) => updateField("userName", value)} required />
                <Input label="E-mail admin" type="email" value={form.userEmail} onChange={(value) => updateField("userEmail", value)} required />
                <Input label="Senha temporaria" type="password" value={form.userPassword} onChange={(value) => updateField("userPassword", value)} required />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Status
                  </span>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      updateField("status", event.target.value as CompanyStatus)
                    }
                    className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <Input label="Taxa no prazo (%)" value={form.onTimeSplitPercentage} onChange={(value) => updateField("onTimeSplitPercentage", value)} required />
                <Input label="Taxa recuperada (%)" value={form.overdueSplitPercentage} onChange={(value) => updateField("overdueSplitPercentage", value)} required />
              </div>

              <div className="grid gap-2">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  Metodos liberados
                </span>
                <div className="flex flex-wrap gap-2">
                  {billingMethods.map((method) => (
                    <label
                      key={method}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={form.enabledBillingMethods.includes(method)}
                        onChange={() => toggleMethod(method)}
                        className="h-4 w-4 accent-emerald-600"
                      />
                      {methodLabel(method)}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Meta phone number ID" value={form.metaPhoneNumberId} onChange={(value) => updateField("metaPhoneNumberId", value)} />
                <Input label="Meta business account ID" value={form.metaBusinessAccountId} onChange={(value) => updateField("metaBusinessAccountId", value)} />
                <Input label="Meta token" type="password" value={form.metaAccessToken} onChange={(value) => updateField("metaAccessToken", value)} />
                <Input label="WhatsApp comercial" value={form.metaBusinessPhoneNumber} onChange={(value) => updateField("metaBusinessPhoneNumber", value)} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Efí client ID" value={form.efiClientId} onChange={(value) => updateField("efiClientId", value)} />
                <Input label="Efí client secret" type="password" value={form.efiClientSecret} onChange={(value) => updateField("efiClientSecret", value)} />
                <Input label="Efí payee code" value={form.efiPayeeCode} onChange={(value) => updateField("efiPayeeCode", value)} />
                <Input label="Senha do certificado" type="password" value={form.efiCertificatePassword} onChange={(value) => updateField("efiCertificatePassword", value)} required={canSubmitEfi} />
                <Input label="Chave Pix" value={form.efiPixKey} onChange={(value) => updateField("efiPixKey", value)} />
                <Input label="Conta Efí" value={form.efiAccountNumber} onChange={(value) => updateField("efiAccountNumber", value)} />
                <Input label="Digito conta Efí" value={form.efiAccountDigit} onChange={(value) => updateField("efiAccountDigit", value)} />
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Certificado Efí
                  </span>
                  <input
                    required={canSubmitEfi && !form.efiCertificateBase64}
                    type="file"
                    accept={CERTIFICATE_ACCEPT}
                    disabled={isSaving || isReadingCertificate}
                    onChange={(event) => {
                      void handleCertificateChange(event);
                    }}
                    className="block h-10 w-full rounded-md border border-slate-300 bg-white text-sm text-slate-900 outline-none transition file:mr-4 file:h-full file:border-0 file:bg-slate-100 file:px-4 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </label>

                <CertificateStatus
                  fileName={certificateFileName}
                  isReading={isReadingCertificate}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Responsavel legal" value={form.legalRepresentative} onChange={(value) => updateField("legalRepresentative", value)} />
                <Input label="CPF responsavel" value={form.legalRepresentativeCpf} onChange={(value) => updateField("legalRepresentativeCpf", value)} />
                <Input label="Nascimento" type="date" value={form.legalRepresentativeBirthDate} onChange={(value) => updateField("legalRepresentativeBirthDate", value)} />
                <Input label="CEP" value={form.postalCode} onChange={(value) => updateField("postalCode", value)} />
                <Input label="Rua" value={form.street} onChange={(value) => updateField("street", value)} />
                <Input label="Numero" value={form.number} onChange={(value) => updateField("number", value)} />
                <Input label="Bairro" value={form.district} onChange={(value) => updateField("district", value)} />
                <Input label="Cidade" value={form.city} onChange={(value) => updateField("city", value)} />
                <Input label="UF" value={form.state} onChange={(value) => updateField("state", value)} />
                <Input label="Banco" value={form.bankName} onChange={(value) => updateField("bankName", value)} />
                <Input label="Agencia" value={form.bankAgency} onChange={(value) => updateField("bankAgency", value)} />
                <Input label="Conta bancaria" value={form.bankAccount} onChange={(value) => updateField("bankAccount", value)} />
                <Input label="Digito conta" value={form.bankAccountDigit} onChange={(value) => updateField("bankAccountDigit", value)} />
              </div>

              <button
                type="submit"
                disabled={isSaving || isReadingCertificate}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isReadingCertificate ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {isReadingCertificate
                  ? "Lendo certificado"
                  : isSaving
                    ? "Salvando..."
                    : "Cadastrar cliente"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function CertificateStatus({
  fileName,
  isReading,
}: {
  fileName: string | null;
  isReading: boolean;
}) {
  const hasCertificate = Boolean(fileName);
  const statusClass = hasCertificate
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
  const statusText = fileName
    ? `Novo certificado selecionado: ${fileName}`
    : "Nenhum certificado selecionado";

  return (
    <div
      className={`flex min-h-10 items-start gap-3 rounded-md border p-3 text-sm ${statusClass}`}
    >
      {isReading ? (
        <Loader2 className="mt-0.5 shrink-0 animate-spin" size={17} />
      ) : hasCertificate ? (
        <FileCheck2 className="mt-0.5 shrink-0" size={17} />
      ) : (
        <Upload className="mt-0.5 shrink-0" size={17} />
      )}
      <div className="min-w-0">
        <p className="break-words font-semibold">
          {isReading ? "Lendo certificado" : statusText}
        </p>
        <p className="mt-0.5 text-xs leading-5">
          {hasCertificate
            ? "O arquivo sera enviado protegido para o backend."
            : "Selecione o arquivo .p12 ou .pfx da Efí."}
        </p>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}
