"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Banknote,
  BriefcaseBusiness,
  CheckCircle2,
  FileCheck2,
  KeyRound,
  Landmark,
  Loader2,
  MapPin,
  Send,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type {
  GatewayAccountInput,
  GatewayAccountStatus,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const initialForm: GatewayAccountInput = {
  corporateName: "",
  cnpj: "",
  email: "",
  phoneNumber: "",
  legalRepresentative: "",
  legalRepresentativeCpf: "",
  legalRepresentativeBirthDate: "",
  postalCode: "",
  street: "",
  number: "",
  district: "",
  city: "",
  state: "",
  bankName: "",
  bankAgency: "",
  bankAccount: "",
  bankAccountDigit: "",
  bankAccountType: "CHECKING",
  environment: "homologation",
  efiClientId: "",
  efiClientSecret: "",
  efiPayeeCode: "",
  efiAccountNumber: "",
  efiAccountDigit: "",
  efiPixKey: "",
  efiCertificatePath: "",
  efiCertificatePassword: "",
  efiCertificateBase64: "",
  gatewayStatus: "ACTIVE",
};

const CERTIFICATE_ACCEPT =
  ".p12,.pfx,.pem,application/x-pkcs12,application/pkcs12,application/octet-stream";

type FormField = {
  name: keyof GatewayAccountInput;
  label: string;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  required?: boolean;
};

const companyFields: FormField[] = [
  {
    name: "corporateName",
    label: "Razao social",
    autoComplete: "organization",
  },
  { name: "cnpj", label: "CNPJ", autoComplete: "off" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "phoneNumber", label: "Telefone comercial", autoComplete: "tel" },
];

const representativeFields: FormField[] = [
  {
    name: "legalRepresentative",
    label: "Nome do Representante Legal",
    autoComplete: "name",
  },
  { name: "legalRepresentativeCpf", label: "CPF", autoComplete: "off" },
  {
    name: "legalRepresentativeBirthDate",
    label: "Data de nascimento",
    type: "date",
  },
];

const addressFields: FormField[] = [
  { name: "postalCode", label: "CEP", autoComplete: "postal-code" },
  { name: "street", label: "Rua", autoComplete: "address-line1" },
  { name: "number", label: "Numero", autoComplete: "address-line2" },
  { name: "district", label: "Bairro" },
  { name: "city", label: "Cidade", autoComplete: "address-level2" },
  {
    name: "state",
    label: "Estado",
    autoComplete: "address-level1",
    maxLength: 2,
  },
];

const bankFields: FormField[] = [
  { name: "bankName", label: "Banco" },
  { name: "bankAgency", label: "Agencia" },
  { name: "bankAccount", label: "Conta" },
  { name: "bankAccountDigit", label: "Digito", required: false },
];

const efiCredentialFields: FormField[] = [
  { name: "efiClientId", label: "Client ID", autoComplete: "off" },
  {
    name: "efiClientSecret",
    label: "Client Secret",
    type: "password",
    autoComplete: "new-password",
  },
  { name: "efiPayeeCode", label: "Codigo do recebedor" },
  { name: "efiAccountNumber", label: "Conta Efi" },
  { name: "efiAccountDigit", label: "Digito da conta", required: false },
  { name: "efiPixKey", label: "Chave Pix" },
  {
    name: "efiCertificatePassword",
    label: "Senha do certificado",
    type: "password",
    autoComplete: "new-password",
  },
];

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "Em analise",
    ACTIVE: "Ativa",
    APPROVED: "Aprovada",
    REJECTED: "Reprovada",
    DISABLED: "Desativada",
  };

  return labels[status] || status;
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

function buildFormFromStatus(
  status: GatewayAccountStatus | null,
): GatewayAccountInput {
  if (!status) {
    return initialForm;
  }

  return {
    corporateName: status.company.corporateName,
    cnpj: status.company.cnpj,
    email: status.company.email,
    phoneNumber: status.company.phoneNumber,
    legalRepresentative: status.legalRepresentative.name || "",
    legalRepresentativeCpf: status.legalRepresentative.cpf || "",
    legalRepresentativeBirthDate: status.legalRepresentative.birthDate || "",
    postalCode: status.address.postalCode || "",
    street: status.address.street || "",
    number: status.address.number || "",
    district: status.address.district || "",
    city: status.address.city || "",
    state: status.address.state || "",
    bankName: status.bank.name || "",
    bankAgency: status.bank.agency || "",
    bankAccount: status.bank.account || "",
    bankAccountDigit: status.bank.accountDigit || "",
    bankAccountType:
      status.bank.accountType === "SAVINGS" ? "SAVINGS" : "CHECKING",
    environment:
      status.environment === "production" ? "production" : "homologation",
    efiClientId: "",
    efiClientSecret: "",
    efiPayeeCode: status.efi.payeeCode || "",
    efiAccountNumber: status.efi.accountNumber || "",
    efiAccountDigit: status.efi.accountDigit || "",
    efiPixKey: status.efi.pixKey || "",
    efiCertificatePath: "",
    efiCertificatePassword: "",
    efiCertificateBase64: "",
    gatewayStatus:
      status.status === "PENDING" ||
      status.status === "REJECTED" ||
      status.status === "DISABLED"
        ? status.status
        : "ACTIVE",
  };
}

export default function PaymentSettingsPage() {
  const apiClient = useApiClient();
  const [form, setForm] = useState<GatewayAccountInput>(initialForm);
  const [accountStatus, setAccountStatus] =
    useState<GatewayAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [readingCertificate, setReadingCertificate] = useState(false);
  const [certificateFileName, setCertificateFileName] = useState<string | null>(
    null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isConfigured = Boolean(accountStatus?.accountId);
  const hasSavedCertificate = Boolean(accountStatus?.efi.hasCertificate);
  const badgeClass = useMemo(() => {
    if (
      accountStatus?.status === "ACTIVE" ||
      accountStatus?.status === "APPROVED"
    ) {
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    }

    if (accountStatus?.status === "REJECTED") {
      return "border-rose-200 bg-rose-50 text-rose-700";
    }

    return "border-amber-200 bg-amber-50 text-amber-700";
  }, [accountStatus?.status]);

  useEffect(() => {
    let cancelled = false;

    async function loadGatewayAccount(): Promise<void> {
      try {
        const data = await apiClient.getGatewayAccount();
        if (cancelled) return;

        setAccountStatus(data);
        setForm(buildFormFromStatus(data));
        setCertificateFileName(null);
      } catch (error: unknown) {
        if (!cancelled) {
          setErrorMsg(
            getErrorMessage(error, "Nao foi possivel carregar os dados."),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadGatewayAccount();

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  function updateField(name: keyof GatewayAccountInput, value: string): void {
    const nextValue = name === "state" ? value.toUpperCase() : value;
    setForm((current) => ({ ...current, [name]: nextValue }));
  }

  async function handleCertificateChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!file) {
      setCertificateFileName(null);
      setForm((current) => ({ ...current, efiCertificateBase64: "" }));
      return;
    }

    setReadingCertificate(true);

    try {
      const certificateBase64 = await readCertificateFileAsBase64(file);
      setCertificateFileName(file.name);
      setForm((current) => ({
        ...current,
        efiCertificateBase64: certificateBase64,
        efiCertificatePath: "",
      }));
    } catch (error: unknown) {
      event.target.value = "";
      setCertificateFileName(null);
      setForm((current) => ({ ...current, efiCertificateBase64: "" }));
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel carregar o certificado."),
      );
    } finally {
      setReadingCertificate(false);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (readingCertificate) {
      setErrorMsg("Aguarde a leitura do certificado antes de salvar.");
      return;
    }

    if (!hasSavedCertificate && !form.efiCertificateBase64) {
      setErrorMsg("Envie o certificado Efi antes de cadastrar a conta.");
      return;
    }

    setSaving(true);

    try {
      const data = await apiClient.createGatewayAccount(form);
      setAccountStatus(data);
      setForm(buildFormFromStatus(data));
      setCertificateFileName(null);
      setSuccessMsg("Conta Efi cadastrada e pronta para emitir cobrancas.");
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error, "Nao foi possivel criar a subconta."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
        <header className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              Configuracoes de Pagamento
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Cadastre os dados fiscais e bancarios da empresa para habilitar a
              sua conta no Efi Bank com split automatico e credenciais de
              emissao para gerarmos cobrancas automatizadas.
            </p>
          </div>

          <div
            className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${badgeClass}`}
          >
            {isConfigured ? (
              <CheckCircle2 size={17} />
            ) : (
              <AlertCircle size={17} />
            )}
            {isConfigured
              ? statusLabel(accountStatus?.status || "PENDING")
              : "Pendente"}
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-80 items-center justify-center rounded-md border border-slate-200 bg-white">
            <Loader2 className="animate-spin text-slate-400" size={34} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
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

            <FormSection
              icon={BriefcaseBusiness}
              title="Dados da Empresa"
              fields={companyFields}
              form={form}
              disabled={isConfigured || saving}
              onChange={updateField}
            />

            <FormSection
              icon={UserRound}
              title="Representante Legal"
              fields={representativeFields}
              form={form}
              disabled={isConfigured || saving}
              onChange={updateField}
            />

            <FormSection
              icon={MapPin}
              title="Endereco"
              fields={addressFields}
              form={form}
              disabled={isConfigured || saving}
              onChange={updateField}
            />

            <FormSection
              icon={Landmark}
              title="Dados Bancarios da Empresa"
              fields={bankFields}
              form={form}
              disabled={isConfigured || saving}
              onChange={updateField}
            />

            <GatewayCredentialsSection
              form={form}
              disabled={isConfigured || saving}
              hasSavedCertificate={hasSavedCertificate}
              readingCertificate={readingCertificate}
              selectedCertificateFileName={certificateFileName}
              onChange={updateField}
              onCertificateChange={handleCertificateChange}
            />

            <footer className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <Banknote
                  className="mt-0.5 shrink-0 text-emerald-600"
                  size={18}
                />
                <span>
                  As chaves e o certificado do gateway ficam apenas no
                  servidor. O painel mostra somente o status da conta.
                </span>
              </div>

              <button
                type="submit"
                disabled={isConfigured || saving || readingCertificate}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {saving || readingCertificate ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Send size={17} />
                )}
                {isConfigured
                  ? "Conta Efi cadastrada"
                  : readingCertificate
                    ? "Lendo certificado"
                    : "Cadastrar Conta Efi"}
              </button>
            </footer>
          </form>
        )}
      </div>
    </main>
  );
}

function GatewayCredentialsSection({
  form,
  disabled,
  hasSavedCertificate,
  readingCertificate,
  selectedCertificateFileName,
  onChange,
  onCertificateChange,
}: {
  form: GatewayAccountInput;
  disabled: boolean;
  hasSavedCertificate: boolean;
  readingCertificate: boolean;
  selectedCertificateFileName: string | null;
  onChange: (name: keyof GatewayAccountInput, value: string) => void;
  onCertificateChange: (
    event: ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
}) {
  const certificateStatusClass =
    hasSavedCertificate || selectedCertificateFileName
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  const certificateStatusText = selectedCertificateFileName
    ? `Novo certificado selecionado: ${selectedCertificateFileName}`
    : hasSavedCertificate
      ? "Certificado Efi salvo"
      : "Nenhum certificado enviado";
  const certificateHelpText = hasSavedCertificate
    ? "O arquivo ja esta protegido no servidor."
    : "Selecione o certificado .p12 ou .pfx emitido no Efi Bank.";

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <KeyRound size={18} />
        </div>
        <h2 className="font-semibold text-slate-950">
          Credenciais Efi Bank
        </h2>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase text-slate-500">
            Ambiente
          </span>
          <select
            required
            value={form.environment}
            disabled={disabled}
            onChange={(event) => onChange("environment", event.target.value)}
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-500"
          >
            <option value="homologation">Homologacao</option>
            <option value="production">Producao</option>
          </select>
        </label>

        {efiCredentialFields.map((field) => {
          const isCertificatePassword =
            field.name === "efiCertificatePassword";

          return (
            <label key={field.name} className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                {field.label}
              </span>
              <input
                required={
                  isCertificatePassword
                    ? !hasSavedCertificate
                    : field.required !== false
                }
                type={field.type || "text"}
                autoComplete={field.autoComplete}
                maxLength={field.maxLength}
                value={form[field.name]}
                disabled={disabled}
                onChange={(event) => onChange(field.name, event.target.value)}
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </label>
          );
        })}

        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-xs font-semibold uppercase text-slate-500">
            Certificado Efi
          </span>
          <input
            required={!hasSavedCertificate}
            type="file"
            accept={CERTIFICATE_ACCEPT}
            disabled={disabled || readingCertificate}
            onChange={(event) => {
              void onCertificateChange(event);
            }}
            className="block h-11 w-full rounded-md border border-slate-300 bg-white text-sm text-slate-900 outline-none transition-colors file:mr-4 file:h-full file:border-0 file:bg-slate-100 file:px-4 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-500"
          />
        </label>

        <div
          className={`flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm ${certificateStatusClass}`}
        >
          {readingCertificate ? (
            <Loader2 className="mt-0.5 shrink-0 animate-spin" size={18} />
          ) : selectedCertificateFileName || hasSavedCertificate ? (
            <FileCheck2 className="mt-0.5 shrink-0" size={18} />
          ) : (
            <Upload className="mt-0.5 shrink-0" size={18} />
          )}
          <div className="min-w-0">
            <p className="break-words font-semibold">
              {readingCertificate ? "Lendo certificado" : certificateStatusText}
            </p>
            <p className="mt-0.5 text-xs leading-5">{certificateHelpText}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FormSection({
  icon: Icon,
  title,
  fields,
  form,
  disabled,
  onChange,
}: {
  icon: LucideIcon;
  title: string;
  fields: FormField[];
  form: GatewayAccountInput;
  disabled: boolean;
  onChange: (name: keyof GatewayAccountInput, value: string) => void;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <Icon size={18} />
        </div>
        <h2 className="font-semibold text-slate-950">{title}</h2>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <label key={field.name} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase text-slate-500">
              {field.label}
            </span>
            <input
              required={field.required !== false}
              type={field.type || "text"}
              autoComplete={field.autoComplete}
              maxLength={field.maxLength}
              value={form[field.name]}
              disabled={disabled}
              onChange={(event) => onChange(field.name, event.target.value)}
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-500"
            />
          </label>
        ))}
      </div>
    </section>
  );
}
