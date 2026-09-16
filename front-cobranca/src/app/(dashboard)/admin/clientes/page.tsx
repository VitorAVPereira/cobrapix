"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import {
  Building2,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import {
  AdminClient,
  BillingMethod,
  BusinessSegment,
  CompanyStatus,
  CreateAdminClientInput,
  MessagingLimitTier,
  UpdateAdminClientInput,
  WhatsappStatus,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const billingMethods: BillingMethod[] = ["PIX", "BOLIX"];
const statusOptions: CompanyStatus[] = ["ACTIVE", "INACTIVE", "SUSPENDED"];
const businessSegmentOptions: BusinessSegment[] = ["GENERAL", "EDUCATION"];
const whatsappStatusOptions: WhatsappStatus[] = [
  "CONNECTED",
  "DISCONNECTED",
  "PENDING",
];
const messagingLimitTierOptions: MessagingLimitTier[] = [
  "TIER_50",
  "TIER_250",
  "TIER_1K",
  "TIER_10K",
  "TIER_100K",
  "TIER_UNLIMITED",
];

interface ClientFormState {
  corporateName: string;
  document: string;
  email: string;
  phoneNumber: string;
  status: CompanyStatus;
  gatewayProvider: string;
  gatewayStatus: string;
  userName: string;
  userEmail: string;
  enabledBillingMethods: BillingMethod[];
  preferredBillingMethod: BillingMethod;
  maxDiscountsPerDebtor: string;
  discountTriggerDay: string;
  collectionReminderDays: string;
  autoGenerateFirstCharge: boolean;
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: string;
  autoDiscountPercentage: string;
  businessSegment: BusinessSegment;
  paymentNotificationEnabled: boolean;
  paymentNotificationEmails: string;
  whatsappStatus: WhatsappStatus;
  metaPhoneNumberId: string;
  metaBusinessAccountId: string;
  metaAccessToken: string;
  metaBusinessPhoneNumber: string;
  metaDefaultLanguage: string;
  messagingLimitTier: MessagingLimitTier | "";
  resendApiKey: string;
  resendWebhookSecret: string;
  resendFromEmail: string;
  erpApiKey: string;
  erpWebhookUrl: string;
  erpEnabledEvents: string;
  efiEnvironment: "homologation" | "production";
  efiGatewayStatus: "PENDING" | "ACTIVE" | "REJECTED" | "DISABLED";
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
  gatewayProvider: "EFI",
  gatewayStatus: "PENDING",
  userName: "",
  userEmail: "",
  enabledBillingMethods: ["PIX", "BOLIX"],
  preferredBillingMethod: "BOLIX",
  maxDiscountsPerDebtor: "1",
  discountTriggerDay: "15",
  collectionReminderDays: "0",
  autoGenerateFirstCharge: true,
  autoDiscountEnabled: false,
  autoDiscountDaysAfterDue: "",
  autoDiscountPercentage: "",
  businessSegment: "GENERAL",
  paymentNotificationEnabled: true,
  paymentNotificationEmails: "",
  whatsappStatus: "PENDING",
  metaPhoneNumberId: "",
  metaBusinessAccountId: "",
  metaAccessToken: "",
  metaBusinessPhoneNumber: "",
  metaDefaultLanguage: "pt_BR",
  messagingLimitTier: "",
  resendApiKey: "",
  resendWebhookSecret: "",
  resendFromEmail: "",
  erpApiKey: "",
  erpWebhookUrl: "",
  erpEnabledEvents: "",
  efiEnvironment: "homologation",
  efiGatewayStatus: "ACTIVE",
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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}




function methodLabel(method: BillingMethod): string {
  if (method === "BOLETO") return "Boleto";
  if (method === "BOLIX") return "Bolix";
  return "Pix";
}

function joinNumberList(values: number[] | undefined): string {
  return values?.join(", ") ?? "";
}

function parseNumberList(value: string): number[] {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item));
}

function parseEmailList(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeDateInput(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function displayValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Vazio";
  if (typeof value === "boolean") return value ? "Sim" : "Nao";
  return String(value);
}

interface ConfirmationChange {
  label: string;
  current: string;
  next: string;
  sensitive: boolean;
}

interface TemporaryAccessNotice {
  password: string;
  warnings: string[];
}

export default function AdminClientsPage() {
  const apiClient = useApiClient();
  const { data: session } = useSession();
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [form, setForm] = useState<ClientFormState>(initialForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temporaryAccess, setTemporaryAccess] =
    useState<TemporaryAccessNotice | null>(null);
  const [editingClient, setEditingClient] = useState<AdminClient | null>(null);
  const [pendingPayload, setPendingPayload] =
    useState<UpdateAdminClientInput | null>(null);
  const [pendingChanges, setPendingChanges] = useState<ConfirmationChange[]>(
    [],
  );

  const isPlatformAdmin = session?.user.role === "PLATFORM_ADMIN";
  const isEditing = Boolean(editingClient);
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

  function clientToForm(client: AdminClient): ClientFormState {
    return {
      ...initialForm,
      corporateName: client.corporateName,
      document: client.document,
      email: client.email,
      phoneNumber: client.phoneNumber,
      status: client.status,
      gatewayProvider: client.gatewayProvider ?? "EFI",
      gatewayStatus: client.gatewayStatus,
      enabledBillingMethods: client.enabledBillingMethods,
      preferredBillingMethod: client.preferredBillingMethod,
      maxDiscountsPerDebtor: String(client.maxDiscountsPerDebtor ?? 1),
      discountTriggerDay: String(client.discountTriggerDay ?? 15),
      collectionReminderDays: joinNumberList(client.collectionReminderDays ?? [0]),
      autoGenerateFirstCharge: client.autoGenerateFirstCharge ?? true,
      autoDiscountEnabled: client.autoDiscountEnabled ?? false,
      autoDiscountDaysAfterDue:
        client.autoDiscountDaysAfterDue === null ||
        client.autoDiscountDaysAfterDue === undefined
          ? ""
          : String(client.autoDiscountDaysAfterDue),
      autoDiscountPercentage:
        client.autoDiscountPercentage === null ||
        client.autoDiscountPercentage === undefined
          ? ""
          : String(client.autoDiscountPercentage),
      businessSegment: client.businessSegment ?? "GENERAL",
      paymentNotificationEnabled: client.paymentNotificationEnabled ?? true,
      paymentNotificationEmails: client.paymentNotificationEmails?.join("\n") ?? "",
      whatsappStatus: (client.whatsappStatus as WhatsappStatus) ?? "PENDING",
      metaPhoneNumberId: client.metaPhoneNumberId ?? "",
      metaBusinessAccountId: client.metaBusinessAccountId ?? "",
      metaBusinessPhoneNumber: client.metaBusinessPhoneNumber ?? "",
      metaDefaultLanguage: client.metaDefaultLanguage ?? "pt_BR",
      messagingLimitTier: client.messagingLimitTier ?? "",
      resendWebhookSecret: "",
      resendFromEmail: client.resendFromEmail ?? "",
      erpWebhookUrl: client.erpWebhookUrl ?? "",
      erpEnabledEvents: client.erpEnabledEvents?.join("\n") ?? "",
      efiEnvironment:
        client.efi.environment === "production" ? "production" : "homologation",
      efiGatewayStatus:
        client.efi.status === "PENDING" ||
        client.efi.status === "ACTIVE" ||
        client.efi.status === "REJECTED" ||
        client.efi.status === "DISABLED"
          ? client.efi.status
          : "PENDING",
      efiPayeeCode: client.efi.payeeCode ?? "",
      efiAccountNumber: client.efi.accountNumber ?? "",
      efiAccountDigit: client.efi.accountDigit ?? "",
      efiPixKey: client.efi.pixKey ?? "",
      legalRepresentative: client.legalRepresentative ?? "",
      legalRepresentativeCpf: client.legalRepresentativeCpf ?? "",
      legalRepresentativeBirthDate: normalizeDateInput(
        client.legalRepresentativeBirthDate,
      ),
      postalCode: client.addressPostalCode ?? "",
      street: client.addressStreet ?? "",
      number: client.addressNumber ?? "",
      district: client.addressDistrict ?? "",
      city: client.addressCity ?? "",
      state: client.addressState ?? "SP",
      bankName: client.bankName ?? "",
      bankAgency: client.bankAgency ?? "",
      bankAccount: client.bankAccount ?? "",
    };
  }

  function startEdit(client: AdminClient): void {
    setEditingClient(client);
    setPendingPayload(null);
    setPendingChanges([]);
    setError(null);
    setMessage(null);
    setForm(clientToForm(client));
  }

  function resetToCreateMode(): void {
    setEditingClient(null);
    setPendingPayload(null);
    setPendingChanges([]);
    setForm(initialForm);
    setError(null);
    setMessage(null);
  }

  function buildUpdatePayload(): UpdateAdminClientInput {
    const payload: UpdateAdminClientInput = {
      company: {
        corporateName: form.corporateName,
        document: form.document,
        email: form.email,
        phoneNumber: form.phoneNumber,
        status: form.status,
        gatewayProvider: form.gatewayProvider,
        legalRepresentative: form.legalRepresentative,
        legalRepresentativeCpf: form.legalRepresentativeCpf,
        legalRepresentativeBirthDate: form.legalRepresentativeBirthDate || null,
        addressPostalCode: form.postalCode,
        addressStreet: form.street,
        addressNumber: form.number,
        addressDistrict: form.district,
        addressCity: form.city,
        addressState: form.state,
        bankName: form.bankName,
        bankAgency: form.bankAgency,
        bankAccount: form.bankAccount,
      },
      billing: {
        enabledBillingMethods: form.enabledBillingMethods,
        preferredBillingMethod: form.preferredBillingMethod,
        maxDiscountsPerDebtor: parseIntInput(form.maxDiscountsPerDebtor, 1),
        discountTriggerDay: parseIntInput(form.discountTriggerDay, 15),
        collectionReminderDays: parseNumberList(form.collectionReminderDays),
        autoGenerateFirstCharge: form.autoGenerateFirstCharge,
        autoDiscountEnabled: form.autoDiscountEnabled,
        autoDiscountDaysAfterDue: parseOptionalNumber(
          form.autoDiscountDaysAfterDue,
        ),
        autoDiscountPercentage: parseOptionalNumber(form.autoDiscountPercentage),
      },
      notifications: {
        businessSegment: form.businessSegment,
        paymentNotificationEnabled: form.paymentNotificationEnabled,
        paymentNotificationEmails: parseEmailList(form.paymentNotificationEmails),
      },
      integrations: {
        erpWebhookUrl: form.erpWebhookUrl || null,
        erpEnabledEvents: parseEmailList(form.erpEnabledEvents),
      },
    };

    if (form.erpApiKey.trim()) {
      payload.integrations = {
        ...payload.integrations,
        erpApiKey: form.erpApiKey,
      };
    }
    return payload;
  }

  function buildConfirmationChanges(client: AdminClient): ConfirmationChange[] {
    const changes: ConfirmationChange[] = [];
    const addChange = (
      label: string,
      current: string | number | boolean | null | undefined,
      next: string | number | boolean | null | undefined,
      sensitive = false,
    ): void => {
      const currentText = displayValue(current);
      const nextText = displayValue(next);
      if (currentText !== nextText) {
        changes.push({ label, current: currentText, next: nextText, sensitive });
      }
    };
    const addSecretChange = (
      label: string,
      hasCurrent: boolean | undefined,
      next: string,
    ): void => {
      if (!next.trim()) return;
      changes.push({
        label,
        current: hasCurrent ? "Protegido" : "Vazio",
        next,
        sensitive: true,
      });
    };

    addChange("Razao social", client.corporateName, form.corporateName);
    addChange("CNPJ", client.document, form.document);
    addChange("E-mail empresa", client.email, form.email);
    addChange("Telefone", client.phoneNumber, form.phoneNumber);
    addChange("Status", client.status, form.status);
    addChange(
      "Metodos liberados",
      client.enabledBillingMethods.map(methodLabel).join(", "),
      form.enabledBillingMethods.map(methodLabel).join(", "),
    );
    addChange(
      "Metodo preferido",
      methodLabel(client.preferredBillingMethod),
      methodLabel(form.preferredBillingMethod),
    );
    addChange(
      "Emails de notificacao",
      client.paymentNotificationEmails?.join(", ") ?? "",
      parseEmailList(form.paymentNotificationEmails).join(", "),
    );
    addChange("Status WhatsApp", client.whatsappStatus, form.whatsappStatus);
    addChange("Responsavel legal", client.legalRepresentative, form.legalRepresentative);
    addChange("CPF responsavel", client.legalRepresentativeCpf, form.legalRepresentativeCpf);
    addChange("CEP", client.addressPostalCode, form.postalCode);
    addChange("Rua", client.addressStreet, form.street);
    addChange("Numero", client.addressNumber, form.number);
    addChange("Bairro", client.addressDistrict, form.district);
    addChange("Cidade", client.addressCity, form.city);
    addChange("UF", client.addressState, form.state);
    addChange("Banco", client.bankName, form.bankName);
    addChange("Agencia", client.bankAgency, form.bankAgency);
    addChange("Conta bancaria", client.bankAccount, form.bankAccount);
    addSecretChange("ERP API key", client.hasErpApiKey, form.erpApiKey);

    return changes;
  }

  function prepareUpdateConfirmation(): void {
    if (!editingClient) return;

    const payload = buildUpdatePayload();
    const changes = buildConfirmationChanges(editingClient);

    if (changes.length === 0) {
      setError("Nenhuma alteracao foi identificada.");
      return;
    }

    setError(null);
    setPendingPayload(payload);
    setPendingChanges(changes);
  }

  async function confirmUpdate(): Promise<void> {
    if (!editingClient || !pendingPayload) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      await apiClient.updateAdminClient(editingClient.id, pendingPayload);
      setMessage("Cliente atualizado.");
      resetToCreateMode();
      await loadClients();
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError, "Nao foi possivel atualizar cliente."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (editingClient) {
      prepareUpdateConfirmation();
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
      },
      billing: {
        enabledBillingMethods: form.enabledBillingMethods,
        preferredBillingMethod: form.preferredBillingMethod,
      },
    };

    if (
      form.erpApiKey.trim() ||
      form.erpWebhookUrl.trim() ||
      form.erpEnabledEvents.trim()
    ) {
      payload.integrations = {
        erpWebhookUrl: form.erpWebhookUrl || null,
        erpEnabledEvents: parseEmailList(form.erpEnabledEvents),
      };

      if (form.erpApiKey.trim()) {
        payload.integrations.erpApiKey = form.erpApiKey;
      }
    }

    try {
      const result = await apiClient.createAdminClient(payload);
      setForm(initialForm);
      setMessage("Cliente cadastrado.");
      setTemporaryAccess({
        password: result.temporaryPassword,
        warnings: result.integrationWarnings,
      });
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
      setMessage("Senha redefinida.");
      setTemporaryAccess({
        password: result.temporaryPassword,
        warnings: [],
      });
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
              Clientes Cifra+
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

        {temporaryAccess && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold">Senha temporaria: {temporaryAccess.password}</p>
                <p className="mt-1 text-xs">
                  Guarde esta senha agora. Ela não será exibida novamente e o usuário deverá trocá-la no primeiro acesso.
                </p>
                {temporaryAccess.warnings.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                    {temporaryAccess.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTemporaryAccess(null)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-amber-100"
                aria-label="Fechar aviso de senha temporaria"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

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
                        <td className="px-4 py-3 text-slate-700"><a href="/admin/payment-fees" className="text-emerald-700 underline">Consultar tarifas</a></td>
                        <td className="px-4 py-3 text-slate-700">
                          <p>{client.status}</p>
                          <p className="text-xs text-slate-500">
                            Efí {client.efi.status ?? "PENDING"} · WhatsApp{" "}
                            {client.whatsappStatus}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              aria-label={`Editar ${client.corporateName}`}
                              onClick={() => startEdit(client)}
                              className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Pencil size={14} />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleResetPassword(client.id)}
                              className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <KeyRound size={14} />
                              Resetar
                            </button>
                          </div>
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
              {isEditing ? (
                <Pencil size={18} className="text-emerald-600" />
              ) : (
                <Plus size={18} className="text-emerald-600" />
              )}
              <h2 className="text-sm font-semibold text-slate-900">
                {isEditing ? "Editar cliente" : "Novo cliente"}
              </h2>
              {isEditing && (
                <button
                  type="button"
                  onClick={resetToCreateMode}
                  className="ml-auto inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <X size={14} />
                  Cancelar edicao
                </button>
              )}
            </div>

            <div className="grid gap-4 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Razao social" value={form.corporateName} onChange={(value) => updateField("corporateName", value)} required />
                <Input label="CNPJ" value={form.document} onChange={(value) => updateField("document", value)} required />
                <Input label="E-mail empresa" type="email" value={form.email} onChange={(value) => updateField("email", value)} required />
                <Input label="Telefone" value={form.phoneNumber} onChange={(value) => updateField("phoneNumber", value)} required />
              </div>

              {!isEditing && (
                <div className="grid gap-3 md:grid-cols-3">
                  <Input label="Nome admin" value={form.userName} onChange={(value) => updateField("userName", value)} required />
                  <Input label="E-mail admin" type="email" value={form.userEmail} onChange={(value) => updateField("userEmail", value)} required />
                  <p className="text-xs leading-5 text-slate-500 md:col-span-2">
                    A senha temporaria sera gerada automaticamente e exibida uma unica vez apos o cadastro.
                  </p>
                </div>
              )}

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
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Input label="Descontos por devedor" value={form.maxDiscountsPerDebtor} onChange={(value) => updateField("maxDiscountsPerDebtor", value)} />
                <Input label="Dia gatilho desconto" value={form.discountTriggerDay} onChange={(value) => updateField("discountTriggerDay", value)} />
                <Input label="Dias da regua" value={form.collectionReminderDays} onChange={(value) => updateField("collectionReminderDays", value)} />
                <Input label="Dias desconto automatico" value={form.autoDiscountDaysAfterDue} onChange={(value) => updateField("autoDiscountDaysAfterDue", value)} />
                <Input label="Percentual desconto automatico" value={form.autoDiscountPercentage} onChange={(value) => updateField("autoDiscountPercentage", value)} />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.autoGenerateFirstCharge}
                    onChange={(event) =>
                      updateField("autoGenerateFirstCharge", event.target.checked)
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  Gerar primeira cobrança
                </label>
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.autoDiscountEnabled}
                    onChange={(event) =>
                      updateField("autoDiscountEnabled", event.target.checked)
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  Desconto automatico
                </label>
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.paymentNotificationEnabled}
                    onChange={(event) =>
                      updateField("paymentNotificationEnabled", event.target.checked)
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  Notificacao de pagamento
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Segmento
                  </span>
                  <select
                    value={form.businessSegment}
                    onChange={(event) =>
                      updateField(
                        "businessSegment",
                        event.target.value as BusinessSegment,
                      )
                    }
                    className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    {businessSegmentOptions.map((segment) => (
                      <option key={segment} value={segment}>
                        {segment}
                      </option>
                    ))}
                  </select>
                </label>
                <Input label="Emails notificacao pagamento" value={form.paymentNotificationEmails} onChange={(value) => updateField("paymentNotificationEmails", value)} />
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
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Status WhatsApp
                  </span>
                  <select
                    value={form.whatsappStatus}
                    onChange={(event) =>
                      updateField(
                        "whatsappStatus",
                        event.target.value as WhatsappStatus,
                      )
                    }
                    className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    {whatsappStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    Limite Meta
                  </span>
                  <select
                    value={form.messagingLimitTier}
                    onChange={(event) =>
                      updateField(
                        "messagingLimitTier",
                        event.target.value as MessagingLimitTier | "",
                      )
                    }
                    className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">Sem tier</option>
                    {messagingLimitTierOptions.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input label="ERP API key" type="password" value={form.erpApiKey} onChange={(value) => updateField("erpApiKey", value)} placeholder={isEditing ? "Mantem chave atual se vazio" : undefined} />
                <Input label="ERP webhook URL" value={form.erpWebhookUrl} onChange={(value) => updateField("erpWebhookUrl", value)} />
                <Input label="Eventos ERP" value={form.erpEnabledEvents} onChange={(value) => updateField("erpEnabledEvents", value)} />
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
                disabled={isSaving}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isEditing ? (
                  <Pencil size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {isSaving
                    ? "Salvando..."
                    : isEditing
                      ? "Salvar alteracoes"
                      : "Cadastrar cliente"}
              </button>
            </div>
          </form>
        </section>
        {pendingPayload && (
          <ConfirmationModal
            changes={pendingChanges}
            isSaving={isSaving}
            onCancel={() => {
              setPendingPayload(null);
              setPendingChanges([]);
            }}
            onConfirm={() => void confirmUpdate()}
          />
        )}
      </div>
    </main>
  );
}
function ConfirmationModal({
  changes,
  isSaving,
  onCancel,
  onConfirm,
}: {
  changes: ConfirmationChange[];
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-md bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Confirmar alteracoes
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            aria-label="Fechar modal"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-5">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Campo</th>
                <th className="px-3 py-2">Atual</th>
                <th className="px-3 py-2">Novo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {changes.map((change) => (
                <tr key={`${change.label}-${change.next}`} className="align-top">
                  <td className="px-3 py-3 font-semibold text-slate-800">
                    {change.label}
                    {change.sensitive && (
                      <span className="ml-2 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                        Sensivel
                      </span>
                    )}
                  </td>
                  <td className="max-w-[220px] break-words px-3 py-3 text-slate-600">
                    {change.current}
                  </td>
                  <td className="max-w-[220px] break-words px-3 py-3 text-slate-900">
                    {change.next}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {isSaving ? "Salvando..." : "Confirmar"}
          </button>
        </div>
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </span>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}
