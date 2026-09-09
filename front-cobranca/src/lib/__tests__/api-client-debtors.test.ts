import {
  ApiClient,
  type CreateDebtorInput,
  type UpdateDebtorInput,
} from "../api-client";

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

global.fetch = mockFetch;

const debtorResponse = {
  debtorId: "debtor-1",
  name: "Maria Silva",
  document: "12345678909",
  phone_number: "+5511999999999",
  email: null,
  whatsapp_opt_in: true,
  whatsappOptInAt: "2026-06-01T12:00:00.000Z",
  collectionProfile: {
    id: "profile-new",
    name: "Novo Cliente",
    profileType: "NEW",
  },
  openInvoicesCount: 2,
  openInvoicesAmount: 120,
  paidInvoicesCount: 3,
  paidInvoicesAmount: 300,
  lastInvoiceAt: "2026-06-04T12:00:00.000Z",
  lastPaymentAt: "2026-06-03T12:00:00.000Z",
  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-06-02T12:00:00.000Z",
};

describe("ApiClient debtors", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [debtorResponse],
        total: 1,
        page: 1,
        pageSize: 20,
        summary: {
          totalDebtors: 1,
          openInvoiceAmount: 120,
          openInvoiceCount: 2,
          paidInvoiceAmount: 300,
          paidInvoiceCount: 3,
        },
      }),
    } as Response);
  });

  it("lists debtors with filters in the query string", async () => {
    const apiClient = new ApiClient("http://api.test", "token");

    await apiClient.getDebtors({
      page: 2,
      pageSize: 10,
      search: "Maria",
      profileId: "profile-new",
      paymentStatus: "open",
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/invoices/debtors?page=2&pageSize=10&search=Maria&profileId=profile-new&paymentStatus=open",
    );
  });

  it("creates and updates debtors through debtor endpoints", async () => {
    const apiClient = new ApiClient("http://api.test", "token");
    const input: CreateDebtorInput = {
      name: "Maria Silva",
      document: "12345678909",
      phone_number: "11999999999",
      email: null,
      whatsappOptIn: true,
      collectionProfileId: "profile-new",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => debtorResponse,
    } as Response);
    await apiClient.createDebtor(input);

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/invoices/debtors",
    );
    expect(mockFetch.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(mockFetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));

    const updateInput: UpdateDebtorInput = {
      name: "Maria Editada",
      email: "maria@email.com",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...debtorResponse, name: "Maria Editada" }),
    } as Response);
    await apiClient.updateDebtor("debtor-1", updateInput);

    expect(mockFetch.mock.calls[1]?.[0]).toBe(
      "http://api.test/invoices/debtors/debtor-1",
    );
    expect(mockFetch.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(mockFetch.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify(updateInput),
    );
  });

  it("includes debtorId in invoice list queries", async () => {
    const apiClient = new ApiClient("http://api.test", "token");

    await apiClient.getInvoices({
      page: 1,
      pageSize: 20,
      status: "PENDING",
      debtorId: "debtor-1",
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/invoices?page=1&pageSize=20&status=PENDING&debtorId=debtor-1",
    );
  });
});
