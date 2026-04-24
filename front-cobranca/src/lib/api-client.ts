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

interface BillingResponse {
  success: boolean;
  summary: {
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  };
  message: string;
}

export interface BillingSettings {
  collectionReminderDays: number[];
}

interface WhatsAppInstanceResponse {
  qrCode: string | null;
  instanceName: string;
  pairingCode?: string | null;
  state?: string;
  dbStatus?: string;
}

interface WhatsAppStatusResponse {
  state?: string;
  dbStatus?: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  slug: string;
  content: string;
  isActive: boolean;
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
  async getInvoices(): Promise<unknown> {
    return this.fetch("/invoices");
  }

  async importInvoices(data: ReadonlyArray<unknown>): Promise<unknown> {
    return this.fetch("/invoices/import", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // WhatsApp
  async createWhatsappInstance(): Promise<WhatsAppInstanceResponse> {
    return this.fetch<WhatsAppInstanceResponse>("/whatsapp/instance", {
      method: "POST",
    });
  }

  async getWhatsappStatus(): Promise<WhatsAppStatusResponse> {
    return this.fetch<WhatsAppStatusResponse>("/whatsapp/status");
  }

  async disconnectWhatsapp(): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>("/whatsapp/disconnect", {
      method: "POST",
    });
  }

  // Billing
  async runBilling(): Promise<BillingResponse> {
    return this.fetch<BillingResponse>("/billing/run", {
      method: "POST",
    });
  }

  async getBillingSettings(): Promise<BillingSettings> {
    return this.fetch<BillingSettings>("/billing/settings");
  }

  async updateBillingSettings(data: BillingSettings): Promise<BillingSettings> {
    return this.fetch<BillingSettings>("/billing/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    });
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
