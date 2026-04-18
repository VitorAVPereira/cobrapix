/**
 * Cliente HTTP para API Nest
 * Wrapper em torno de fetch com autenticação automática
 */

import { auth } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface ApiError extends Error {
  status?: number;
  data?: any;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
  }

  private async getAuthHeader(): Promise<string | null> {
    const session = await auth();
    // @ts-ignore
    return session?.access_token || null;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const token = await this.getAuthHeader();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      ...options,
      headers,
    };

    const response = await fetch(url, config);

    if (!response.ok) {
      const error: ApiError = new Error(
        `API Error: ${response.status} ${response.statusText}`
      );
      error.status = response.status;
      try {
        error.data = await response.json();
      } catch {
        error.data = await response.text();
      }
      throw error;
    }

    // Retorna null para respostas 204
    if (response.status === 204) {
      return null as T;
    }

    return response.json();
  }

  // Auth
  async login(email: string, password: string) {
    return this.fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async logout() {
    return this.fetch("/auth/logout", {
      method: "POST",
    });
  }

  async getSession() {
    return this.fetch("/auth/session", {
      method: "POST",
    });
  }

  // Invoices
  async getInvoices() {
    return this.fetch("/invoices");
  }

  async importInvoices(data: any[]) {
    return this.fetch("/invoices/import", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // WhatsApp
  async createWhatsappInstance() {
    return this.fetch("/whatsapp/instance", {
      method: "POST",
    });
  }

  async getWhatsappStatus() {
    return this.fetch("/whatsapp/status");
  }

  async disconnectWhatsapp() {
    return this.fetch("/whatsapp/disconnect", {
      method: "POST",
    });
  }

  // Billing
  async runBilling() {
    return this.fetch("/billing/run", {
      method: "POST",
    });
  }

  // Health
  async getHealth() {
    return this.fetch("/health");
  }
}

export const apiClient = new ApiClient();
