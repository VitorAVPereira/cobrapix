/**
 * Cliente HTTP para API Nest.
 * O frontend nao acessa banco diretamente; toda persistencia passa por aqui.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

interface ApiErrorBody {
  message?: string | string[];
}

export interface BillingRunSummary {
  total: number;
  queued: number;
  skipped: number;
}

export interface BillingResponse {
  success: boolean;
  summary: BillingRunSummary;
  message: string;
}

export interface BillingSettings {
  preferredBillingMethod: BillingMethod;
  collectionReminderDays: number[];
  autoGenerateFirstCharge: boolean;
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: number | null;
  autoDiscountPercentage: number | null;
  tariffs: Record<
    BillingMethod,
    {
      method: BillingMethod;
      efiLabel: string;
      platformLabel: string;
      combinedLabel: string;
      efiKind: "percentage" | "fixed";
      efiValue: number;
      platformFixedFee: number;
    }
  >;
}

export interface UpdateBillingSettingsInput {
  preferredBillingMethod: BillingMethod;
  collectionReminderDays: number[];
  autoGenerateFirstCharge: boolean;
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: number | null;
  autoDiscountPercentage: number | null;
}

export type BillingMethod = "PIX" | "BOLETO" | "BOLIX";
export type RecurringInvoiceStatus = "ACTIVE" | "PAUSED";
export type DashboardPeriod = "today" | "7d" | "30d" | "year";

export interface BillingMetrics {
  period: DashboardPeriod;
  activeCharges: number;
  pendingAmount: number;
  recoveredAmount: number;
  recoveryRate: number;
  paidCharges: number;
  overdueCharges: number;
  generatedPayments: number;
  queuedMessages: number;
  sentMessages: number;
}

export interface InvoicePaymentSummary {
  generated: boolean;
  method: BillingMethod;
  pixCopyPaste: string | null;
  boletoLine: string | null;
  boletoUrl: string | null;
  boletoPdf: string | null;
  paymentLink: string | null;
  expiresAt: string | null;
}

export interface InvoiceListItem {
  id: string;
  invoiceId: string;
  name: string;
  phone_number: string;
  email?: string;
  original_amount: number;
  due_date: string;
  status?: string;
  debtorId: string;
  whatsapp_opt_in: boolean;
  gatewayId: string | null;
  pixPayload: string | null;
  billing_type: BillingMethod;
  payment: InvoicePaymentSummary;
  createdAt: string;
  recurrence?: {
    recurrenceId: string;
    period: string;
    dueDay: number;
    status: RecurringInvoiceStatus;
  };
  collectionProfile?: {
    id: string;
    name: string;
    profileType: "NEW" | "GOOD" | "DOUBTFUL" | "BAD";
  } | null;
}

export interface CreateInvoiceInput {
  debtorId?: string;
  name?: string;
  phone_number?: string;
  email?: string;
  whatsappOptIn?: boolean;
  original_amount: number;
  due_date?: string;
  billing_type: BillingMethod;
  recurring?: boolean;
  due_day?: number;
}

export interface RecurringInvoice {
  recurrenceId: string;
  debtor: {
    debtorId: string;
    name: string;
    phone_number: string;
    email?: string;
  };
  amount: number;
  billingType: BillingMethod;
  dueDay: number;
  status: RecurringInvoiceStatus;
  nextDueDate: string | null;
  lastGeneratedPeriod: string | null;
  pendingInvoice: {
    invoiceId: string;
    dueDate: string;
    amount: number;
    status: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateRecurringInvoiceInput {
  amount: number;
  billingType: BillingMethod;
  dueDay: number;
}

export interface DebtorBillingSettings {
  debtorId: string;
  debtorName: string;
  whatsappOptIn: boolean;
  whatsappOptInAt: string | null;
  whatsappOptInSource: string | null;
  useGlobalBillingSettings: boolean;
  customPreferredBillingMethod: BillingMethod | null;
  customCollectionReminderDays: number[];
  customAutoGenerateFirstCharge: boolean | null;
  customAutoDiscountEnabled: boolean | null;
  customAutoDiscountDaysAfterDue: number | null;
  customAutoDiscountPercentage: number | null;
  globalSettings: BillingSettings;
  effectiveSettings: BillingSettings;
  updatedAt: string;
}

export interface UpdateDebtorBillingSettingsInput {
  useGlobalBillingSettings: boolean;
  whatsappOptIn?: boolean;
  preferredBillingMethod?: BillingMethod | null;
  collectionReminderDays?: number[] | null;
  autoGenerateFirstCharge?: boolean | null;
  autoDiscountEnabled?: boolean | null;
  autoDiscountDaysAfterDue?: number | null;
  autoDiscountPercentage?: number | null;
}

export interface ConfigureMetaWhatsappInput {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  businessPhoneNumber?: string;
  defaultLanguage?: string;
}

interface WhatsAppStatusResponse {
  provider?: "META_CLOUD";
  state?: string;
  dbStatus?: string;
  phoneNumberId?: string | null;
  businessAccountId?: string | null;
  businessPhoneNumber?: string | null;
  defaultLanguage?: string;
  webhookUrl?: string;
  templatesRequired?: boolean;
}

export interface WhatsAppUsageResponse {
  tier: string;
  dailyLimit: number;
  dailyUsage: number;
  remaining: number;
  interactions: {
    outbound: number;
    delivered: number;
    read: number;
    inbound: number;
    failed: number;
  };
}

export interface CollectionRuleStep {
  id: string;
  profileId: string;
  stepOrder: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string | null;
  template?: { id: string; name: string } | null;
  delayDays: number;
  sendTimeStart: string | null;
  sendTimeEnd: string | null;
  isActive: boolean;
}

export interface CollectionRuleProfile {
  id: string;
  companyId: string;
  name: string;
  profileType: "NEW" | "GOOD" | "DOUBTFUL" | "BAD";
  isDefault: boolean;
  isActive: boolean;
  daysOverdueMin: number | null;
  daysOverdueMax: number | null;
  steps: CollectionRuleStep[];
  _count?: { debtors: number };
  createdAt: string;
  updatedAt: string;
}

export interface CollectionAttempt {
  id: string;
  channel: "EMAIL" | "WHATSAPP";
  status: string;
  externalMessageId: string | null;
  errorDetails: string | null;
  createdAt: string;
  ruleStep?: {
    stepOrder: number;
    channel: string;
    delayDays: number;
  } | null;
}

export type ConversationStatus = "NEW" | "IN_PROGRESS" | "CLOSED";

export interface WhatsAppConversationItem {
  id: string;
  phoneNumber: string;
  status: ConversationStatus;
  debtorName: string | null;
  debtorId: string | null;
  assignee: { id: string; name: string | null } | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  serviceWindowExpiresAt: string | null;
  lastInboundAt: string | null;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface WhatsAppConversationMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  messageId: string | null;
  status: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  slug: string;
  content: string;
  isActive: boolean;
  metaTemplateName: string | null;
  metaLanguage: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  metaStatus: string;
  metaRejectedReason: string | null;
  lastMetaSyncAt: string | null;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageTemplateSlug =
  | "vencimento-hoje"
  | "pre-vencimento"
  | "atraso-primeiro-aviso"
  | "atraso-recorrente";

export interface SaveMessageTemplateInput {
  name: string;
  slug: MessageTemplateSlug;
  content: string;
  isActive?: boolean;
  metaTemplateName?: string;
  metaLanguage?: string;
  category?: "UTILITY" | "MARKETING" | "AUTHENTICATION";
}

export interface GatewayAccountInput {
  corporateName: string;
  cnpj: string;
  email: string;
  phoneNumber: string;
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
  bankAccountType: "CHECKING" | "SAVINGS";
  environment: "homologation" | "production";
  efiClientId: string;
  efiClientSecret: string;
  efiPayeeCode: string;
  efiAccountNumber: string;
  efiAccountDigit: string;
  efiPixKey: string;
  efiCertificatePath: string;
  efiCertificatePassword: string;
  gatewayStatus: "PENDING" | "ACTIVE" | "REJECTED" | "DISABLED";
}

export interface GatewayAccountStatus {
  provider: string;
  accountId: string | null;
  environment: string | null;
  status: string;
  hasApiKey: boolean;
  company: {
    corporateName: string;
    cnpj: string;
    email: string;
    phoneNumber: string;
  };
  legalRepresentative: {
    name: string | null;
    cpf: string | null;
    birthDate: string | null;
  };
  address: {
    postalCode: string | null;
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
  };
  bank: {
    name: string | null;
    agency: string | null;
    account: string | null;
    accountDigit: string | null;
    accountType: string | null;
    holderName: string | null;
    holderDocument: string | null;
  };
  efi: {
    payeeCode: string | null;
    accountNumber: string | null;
    accountDigit: string | null;
    pixKey: string | null;
    hasCertificate: boolean;
  };
}

class ApiClient {
  private baseUrl: string;
  private token: string | null;

  constructor(baseUrl: string = API_URL, token: string | null = null) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private getAuthHeader(): string | null {
    return this.token;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const token = this.getAuthHeader();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        data = await response.text();
      }

      const errorBody = data as ApiErrorBody;
      const errorMessage =
        errorBody.message ||
        `API Error: ${response.status} ${response.statusText}`;

      const error: ApiError = new Error(
        Array.isArray(errorMessage) ? errorMessage[0] : errorMessage,
      );

      error.status = response.status;
      error.data = data;
      throw error;
    }

    if (response.status === 204) {
      return null as T;
    }

    return response.json() as Promise<T>;
  }

  // Auth
  async login(email: string, password: string): Promise<unknown> {
    return this.fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async logout(): Promise<unknown> {
    return this.fetch("/auth/logout", {
      method: "POST",
    });
  }

  async getSession(): Promise<unknown> {
    return this.fetch("/auth/session", {
      method: "POST",
    });
  }

  // Invoices
  async getInvoices(
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      status?: string;
    } = {},
  ): Promise<{ data: InvoiceListItem[]; total: number; page: number; pageSize: number }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.search) qs.set("search", params.search);
    if (params.status) qs.set("status", params.status);

    const qsStr = qs.toString();
    return this.fetch<{
      data: InvoiceListItem[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/invoices${qsStr ? `?${qsStr}` : ""}`);
  }

  async importInvoices(data: ReadonlyArray<unknown>): Promise<unknown> {
    return this.fetch("/invoices/import", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createInvoice(data: CreateInvoiceInput): Promise<InvoiceListItem> {
    return this.fetch<InvoiceListItem>("/invoices", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createDebtorInvoice(
    debtorId: string,
    data: Omit<
      CreateInvoiceInput,
      "debtorId" | "name" | "phone_number" | "email"
    >,
  ): Promise<InvoiceListItem> {
    return this.fetch<InvoiceListItem>(
      `/invoices/debtors/${debtorId}/invoices`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  async getRecurringInvoices(): Promise<RecurringInvoice[]> {
    return this.fetch<RecurringInvoice[]>("/invoices/recurring");
  }

  async updateRecurringInvoice(
    recurrenceId: string,
    data: UpdateRecurringInvoiceInput,
  ): Promise<RecurringInvoice> {
    return this.fetch<RecurringInvoice>(`/invoices/recurring/${recurrenceId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async pauseRecurringInvoice(recurrenceId: string): Promise<RecurringInvoice> {
    return this.fetch<RecurringInvoice>(
      `/invoices/recurring/${recurrenceId}/pause`,
      { method: "POST" },
    );
  }

  async activateRecurringInvoice(
    recurrenceId: string,
  ): Promise<RecurringInvoice> {
    return this.fetch<RecurringInvoice>(
      `/invoices/recurring/${recurrenceId}/activate`,
      { method: "POST" },
    );
  }

  // WhatsApp
  async configureMetaWhatsapp(
    data: ConfigureMetaWhatsappInput,
  ): Promise<WhatsAppStatusResponse> {
    return this.fetch<WhatsAppStatusResponse>("/whatsapp/meta", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getWhatsappStatus(): Promise<WhatsAppStatusResponse> {
    return this.fetch<WhatsAppStatusResponse>("/whatsapp/status");
  }

  async getWhatsappUsage(): Promise<WhatsAppUsageResponse> {
    return this.fetch<WhatsAppUsageResponse>("/whatsapp/usage");
  }

  async disconnectWhatsapp(): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>("/whatsapp/disconnect", {
      method: "POST",
    });
  }

  // Email
  async getEmailStats(
    period: string = "30d",
  ): Promise<{
    period: string;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    failed: number;
  }> {
    return this.fetch(`/email/stats?period=${period}`);
  }

  // Billing
  async runBilling(): Promise<BillingResponse> {
    return this.fetch<BillingResponse>("/billing/run", {
      method: "POST",
    });
  }

  async runSelectedBilling(invoiceIds: string[]): Promise<BillingResponse> {
    return this.fetch<BillingResponse>("/billing/invoices/run", {
      method: "POST",
      body: JSON.stringify({ invoiceIds }),
    });
  }

  async getBillingMetrics(period: DashboardPeriod): Promise<BillingMetrics> {
    return this.fetch<BillingMetrics>(`/billing/metrics?period=${period}`);
  }

  async getBillingSettings(): Promise<BillingSettings> {
    return this.fetch<BillingSettings>("/billing/settings");
  }

  // Collection Rules
  async getRules(): Promise<CollectionRuleProfile[]> {
    return this.fetch<CollectionRuleProfile[]>("/billing/rules");
  }

  async createRule(data: {
    name: string;
    profileType: "NEW" | "GOOD" | "DOUBTFUL" | "BAD";
    isDefault?: boolean;
    daysOverdueMin?: number;
    daysOverdueMax?: number;
  }): Promise<CollectionRuleProfile> {
    return this.fetch<CollectionRuleProfile>("/billing/rules", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateRule(
    profileId: string,
    data: {
      name?: string;
      profileType?: "NEW" | "GOOD" | "DOUBTFUL" | "BAD";
      isDefault?: boolean;
      daysOverdueMin?: number;
      daysOverdueMax?: number;
    },
  ): Promise<CollectionRuleProfile> {
    return this.fetch<CollectionRuleProfile>(`/billing/rules/${profileId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteRule(profileId: string): Promise<unknown> {
    return this.fetch(`/billing/rules/${profileId}`, {
      method: "DELETE",
    });
  }

  async setRuleSteps(
    profileId: string,
    steps: Array<{
      stepOrder: number;
      channel: "EMAIL" | "WHATSAPP";
      templateId?: string;
      delayDays: number;
      sendTimeStart?: string;
      sendTimeEnd?: string;
    }>,
  ): Promise<CollectionRuleStep[]> {
    return this.fetch<CollectionRuleStep[]>(
      `/billing/rules/${profileId}/steps`,
      {
        method: "PUT",
        body: JSON.stringify({ steps }),
      },
    );
  }

  async classifyDebtors(): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>("/billing/classify-debtors", {
      method: "POST",
    });
  }

  // Inbox WhatsApp
  async getConversations(params: {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{
    data: WhatsAppConversationItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const qsStr = qs.toString();
    return this.fetch<{
      data: WhatsAppConversationItem[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/whatsapp/conversations${qsStr ? `?${qsStr}` : ""}`);
  }

  async getConversationMessages(
    conversationId: string,
  ): Promise<WhatsAppConversationMessage[]> {
    return this.fetch<WhatsAppConversationMessage[]>(
      `/whatsapp/conversations/${conversationId}/messages`,
    );
  }

  async replyToConversation(
    conversationId: string,
    content: string,
  ): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(
      `/whatsapp/conversations/${conversationId}/reply`,
      { method: "POST", body: JSON.stringify({ content }) },
    );
  }

  async updateConversationStatus(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(
      `/whatsapp/conversations/${conversationId}/status`,
      { method: "PUT", body: JSON.stringify({ status }) },
    );
  }

  async updateConversationAssignee(
    conversationId: string,
    assigneeId: string | null,
  ): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(
      `/whatsapp/conversations/${conversationId}/assignee`,
      { method: "PUT", body: JSON.stringify({ assigneeId }) },
    );
  }

  async getInboxUnreadCount(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/whatsapp/unread-count");
  }

  async getInvoiceAttempts(
    invoiceId: string,
  ): Promise<CollectionAttempt[]> {
    return this.fetch<CollectionAttempt[]>(
      `/invoices/${invoiceId}/attempts`,
    );
  }

  async updateBillingSettings(
    data: UpdateBillingSettingsInput,
  ): Promise<BillingSettings> {
    return this.fetch<BillingSettings>("/billing/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getDebtorBillingSettings(
    debtorId: string,
  ): Promise<DebtorBillingSettings> {
    return this.fetch<DebtorBillingSettings>(
      `/invoices/debtors/${debtorId}/settings`,
    );
  }

  async updateDebtorBillingSettings(
    debtorId: string,
    data: UpdateDebtorBillingSettingsInput,
  ): Promise<DebtorBillingSettings> {
    return this.fetch<DebtorBillingSettings>(
      `/invoices/debtors/${debtorId}/settings`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
  }

  // Templates
  async getTemplates(): Promise<MessageTemplate[]> {
    return this.fetch<MessageTemplate[]>("/templates");
  }

  async createTemplate(
    data: SaveMessageTemplateInput,
  ): Promise<MessageTemplate> {
    return this.fetch<MessageTemplate>("/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTemplate(
    id: string,
    data: Partial<SaveMessageTemplateInput>,
  ): Promise<MessageTemplate> {
    return this.fetch<MessageTemplate>(`/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async submitTemplateToMeta(
    id: string,
  ): Promise<{ template: MessageTemplate; meta: unknown }> {
    return this.fetch<{ template: MessageTemplate; meta: unknown }>(
      `/templates/${id}/submit-meta`,
      { method: "POST" },
    );
  }

  // Payment gateway
  async getGatewayAccount(): Promise<GatewayAccountStatus> {
    return this.fetch<GatewayAccountStatus>("/payments/gateway-account");
  }

  async createGatewayAccount(
    data: GatewayAccountInput,
  ): Promise<GatewayAccountStatus> {
    return this.fetch<GatewayAccountStatus>("/payments/gateway-account", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Health
  async getHealth(): Promise<unknown> {
    return this.fetch("/health");
  }
}

export { ApiClient };
export const apiClient = new ApiClient();
