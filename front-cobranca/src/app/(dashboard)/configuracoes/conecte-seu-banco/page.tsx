"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Banknote,
  BriefcaseBusiness,
  CheckCircle2,
  Landmark,
  Loader2,
  MapPin,
  Send,
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
  gatewayStatus: "ACTIVE",
};

type FormField = {
  name: keyof GatewayAccountInput;
  label: string;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  required?: boolean;
};

const companyFields: FormField[] = [
  { name: "corporateName", label: "Razao social", autoComplete: "organization" },
  { name: "cnpj", label: "CNPJ", autoComplete: "off" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "phoneNumber", label: "Telefone comercial", autoComplete: "tel" },
];

const representativeFields: FormField[] = [
  { name: "legalRepresentative", label: "Nome do dono", autoComplete: "name" },
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

const efiFields: FormField[] = [
  { name: "efiClientId", label: "Client ID Efi" },
  { name: "efiClientSecret", label: "Client Secret Efi", type: "password" },
  { name: "efiPayeeCode", label: "Payee code" },
  { name: "efiAccountNumber", label: "Conta Efi" },
  { name: "efiAccountDigit", label: "Digito Efi", required: false },
  { name: "efiPixKey", label: "Chave Pix" },
  { name: "efiCertificatePath", label: "Caminho do certificado .p12" },
  {
    name: "efiCertificatePassword",
    label: "Senha do certificado",
    type: "password",
    required: false,
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isConfigured = Boolean(accountStatus?.accountId);
  const badgeClass = useMemo(() => {
    if (accountStatus?.status === "ACTIVE" || accountStatus?.status === "APPROVED") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    }

    if (accountStatus?.status === "REJECTED") {
      return "bg-rose-50 text-rose-700 border-rose-200";
    }

    return "bg-amber-50 text-amber-700 border-amber-200";
  }, [accountStatus?.status]);

  useEffect(() => {
    let cancelled = false;

    async function loadGatewayAccount(): Promise<void> {
      try {
        const data = await apiClient.getGatewayAccount();
        if (cancelled) return;

        setAccountStatus(data);
        setForm(buildFormFromStatus(data));
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setSaving(true);

    try {
      const data = await apiClient.createGatewayAccount(form);
      setAccountStatus(data);
      setForm(buildFormFromStatus(data));
      setSuccessMsg("Conta Efi cadastrada e pronta para emitir cobrancas.");
    } catch (error: unknown) {
      setErrorMsg(
        getErrorMessage(error, "Nao foi possivel criar a subconta."),
      );
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
              Cadastre os dados fiscais e bancarios da clinica para habilitar a
              conta Efi, split automatico e credenciais de emissao para receber
              cobrancas pelo backend.
            </p>
          </div>

          <div
            className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${badgeClass}`}
          >
            {isConfigured ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
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
              title="Dados Bancarios da Clinica"
              fields={bankFields}
              form={form}
              disabled={isConfigured || saving}
              onChange={updateField}
            />

            <FormSection
              icon={Banknote}
              title="Credenciais Efi"
              fields={efiFields}
              form={form}
              disabled={isConfigured || saving}
              onChange={updateField}
            />

            <footer className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <Banknote className="mt-0.5 shrink-0 text-emerald-600" size={18} />
                <span>
                  As chaves do gateway ficam apenas no backend. O painel mostra
                  somente o status da conta Efi.
                </span>
              </div>

              <button
                type="submit"
                disabled={isConfigured || saving}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {saving ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Send size={17} />
                )}
                {isConfigured ? "Conta Efi cadastrada" : "Cadastrar Efi"}
              </button>
            </footer>
          </form>
        )}
      </div>
    </main>
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
