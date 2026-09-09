import {
  ApiClient,
  type AdminClient,
  type CreateAdminClientInput,
  type UpdateAdminClientInput,
} from "../api-client";

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

global.fetch = mockFetch;

function createAdminClientFixture(): AdminClient {
  return {
    id: "company-1",
    corporateName: "Empresa Certificada",
    document: "12345678000190",
    email: "financeiro@empresa.com",
    phoneNumber: "11999999999",
    status: "ACTIVE",
    enabledBillingMethods: ["PIX"],
    preferredBillingMethod: "PIX",
    onTimeSplitPercentageBps: 350,
    overdueSplitPercentageBps: 1200,
    gatewayStatus: "ACTIVE",
    whatsappStatus: "PENDING",
    firstUser: {
      id: "user-1",
      email: "admin@empresa.com",
      name: "Admin Empresa",
      role: "COMPANY_ADMIN",
    },
    efi: {
      configured: true,
      status: "ACTIVE",
      environment: "homologation",
    },
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
  };
}

function createAdminClientInput(): CreateAdminClientInput {
  return {
    company: {
      corporateName: "Empresa Certificada",
      document: "12345678000190",
      email: "financeiro@empresa.com",
      phoneNumber: "11999999999",
      status: "ACTIVE",
    },
    firstUser: {
      name: "Admin Empresa",
      email: "admin@empresa.com",
    },
    billing: {
      enabledBillingMethods: ["PIX"],
      preferredBillingMethod: "PIX",
      onTimeSplitPercentageBps: 350,
      overdueSplitPercentageBps: 1200,
    },
    efi: {
      corporateName: "Empresa Certificada",
      cnpj: "12345678000190",
      email: "financeiro@empresa.com",
      phoneNumber: "11999999999",
      legalRepresentative: "Responsavel Legal",
      legalRepresentativeCpf: "12345678900",
      legalRepresentativeBirthDate: "1990-01-01",
      postalCode: "01001000",
      street: "Rua Teste",
      number: "123",
      district: "Centro",
      city: "Sao Paulo",
      state: "SP",
      bankName: "Banco Teste",
      bankAgency: "0001",
      bankAccount: "12345",
      bankAccountDigit: "6",
      bankAccountType: "CHECKING",
      environment: "homologation",
      efiClientId: "client-id",
      efiClientSecret: "client-secret",
      efiPayeeCode: "payee-code",
      efiAccountNumber: "12345",
      efiAccountDigit: "6",
      efiPixKey: "pix@empresa.com",
      efiCertificatePath: "/tmp/certificado.p12",
      efiCertificatePassword: "senha-certificado",
      efiCertificateBase64: "Y2VydGlmaWNhZG8=",
      gatewayStatus: "ACTIVE",
    },
  };
}

describe("ApiClient admin clients", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => createAdminClientFixture(),
    } as Response);
  });

  it("sends admin client Efi certificate base64 and password without certificate path", async () => {
    const apiClient = new ApiClient("http://api.test", "token");

    await apiClient.createAdminClient(createAdminClientInput());

    const request = mockFetch.mock.calls[0];
    expect(request).toBeDefined();

    const body = request?.[1]?.body;
    expect(typeof body).toBe("string");

    const payload = JSON.parse(body as string) as CreateAdminClientInput;
    expect(payload.efi?.efiCertificatePath).toBe("");
    expect(payload.efi?.efiCertificateBase64).toBe("Y2VydGlmaWNhZG8=");
    expect(payload.efi?.efiCertificatePassword).toBe("senha-certificado");
  });

  it("returns the generated temporary password when creating a client", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        client: createAdminClientFixture(),
        temporaryPassword: "TempSenha1",
      }),
    } as Response);
    const apiClient = new ApiClient("http://api.test", "token");

    const result = await apiClient.createAdminClient(createAdminClientInput());

    expect(result.client.id).toBe("company-1");
    expect(result.temporaryPassword).toBe("TempSenha1");
  });

  it("updates an admin client using PUT and normalizes Efi certificate base64", async () => {
    const apiClient = new ApiClient("http://api.test", "token");
    const input: UpdateAdminClientInput = {
      company: {
        corporateName: "Empresa Editada",
      },
      efi: {
        efiCertificatePath: "/tmp/certificado-antigo.p12",
        efiCertificateBase64: "Y2VydA==",
      },
    };

    await apiClient.updateAdminClient("company-1", input);

    const request = mockFetch.mock.calls[0];
    expect(request?.[0]).toBe("http://api.test/admin/clients/company-1");
    expect(request?.[1]?.method).toBe("PUT");

    const body = request?.[1]?.body;
    expect(typeof body).toBe("string");

    const payload = JSON.parse(body as string) as UpdateAdminClientInput;
    expect(payload.company?.corporateName).toBe("Empresa Editada");
    expect(payload.efi?.efiCertificatePath).toBe("");
    expect(payload.efi?.efiCertificateBase64).toBe("Y2VydA==");
  });

  it("fetches admin client analytics with filled query params only", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        period: {
          key: "custom",
          startDate: "2026-06-01T00:00:00.000Z",
          endDate: "2026-07-01T00:00:00.000Z",
        },
        totals: {
          totalChargedAmount: 100,
          activeChargesCount: 1,
          overduePendingChargesCount: 0,
          canceledChargesCount: 0,
          pendingTotalAmount: 100,
          overduePendingAmount: 0,
          whatsappSentCount: 2,
          whatsappCostAmount: 0.66,
          emailSentCount: 1,
          emailCostAmount: 0,
          averageTicketAmount: 100,
          recoveredChargesCount: 0,
          recoveredAmount: 0,
        },
        clients: [],
        pagination: { page: 1, pageSize: 50, total: 0 },
      }),
    } as Response);
    const apiClient = new ApiClient("http://api.test", "token");

    await apiClient.getAdminClientAnalytics({
      period: "custom",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      search: "alpha",
      page: 1,
      pageSize: 25,
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/admin/clients/analytics?period=custom&startDate=2026-06-01&endDate=2026-06-30&search=alpha&page=1&pageSize=25",
    );
  });
});
