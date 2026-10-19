import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  PaymentNotificationItem,
  PaymentNotificationListResponse,
} from "@/lib/api-client";
import BaixasPage from "../page";

const getPaymentNotifications = jest.fn();
const markPaymentNotificationsAsRead = jest.fn();
const mockApiClient = { getPaymentNotifications, markPaymentNotificationsAsRead };

const replace = jest.fn();
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => mockParams,
  usePathname: () => "/baixas",
}));

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

function notification(overrides: Partial<PaymentNotificationItem> = {}): PaymentNotificationItem {
  return {
    id: "notification-1",
    invoiceId: "invoice-1",
    status: "SENT",
    recipientEmails: ["financeiro@empresa.com"],
    errorMessage: null,
    debtorName: "Ana Souza",
    debtorEmail: null,
    debtorDocument: "52998224725",
    amount: 150.5,
    billingType: "BOLIX",
    dueDate: "2026-10-10T00:00:00.000Z",
    paidAt: "2026-10-18T15:00:00.000Z",
    studentName: null,
    studentEnrollment: null,
    studentGroup: null,
    sentAt: "2026-10-18T15:01:00.000Z",
    readAt: null,
    createdAt: "2026-10-18T15:01:00.000Z",
    summary: {},
    ...overrides,
  };
}

function listResponse(overrides: Partial<PaymentNotificationListResponse> = {}): PaymentNotificationListResponse {
  return {
    data: [
      notification(),
      notification({
        id: "notification-2",
        debtorName: "Bruno Lima",
        debtorDocument: "11144477735",
        status: "FAILED",
        sentAt: null,
        errorMessage: "Endereço recusado.",
        billingType: "PIX",
      }),
      notification({ id: "notification-3", debtorName: "Carla Dias", status: "READ", readAt: "2026-10-18T16:00:00.000Z" }),
    ],
    unreadCount: 57,
    total: 1234,
    page: 1,
    pageSize: 20,
    filteredUnread: 40,
    asOf: "2026-10-18T18:00:00.000Z",
    ...overrides,
  };
}

describe("BaixasPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = new URLSearchParams();
    getPaymentNotifications.mockResolvedValue(listResponse());
  });

  it("shows one compact row per baixa, with the e-mail result apart from reading", async () => {
    render(<BaixasPage />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByText("Ana Souza")).toBeInTheDocument();
    expect(within(rows[1]).getByText("529.982.247-25")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Bolix")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Enviado")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Não enviado")).toHaveAttribute("title", "Endereço recusado.");
    // A read baixa can no longer be selected or marked.
    expect(within(rows[3]).queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("57 novas")).toBeInTheDocument();
    expect(screen.getByText("1.234")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 62")).toBeInTheDocument();
  });

  it("sends the filters of the URL to the API", async () => {
    mockParams = new URLSearchParams(
      "search=Ana&state=email_failed&billingType=BOLETO&period=custom&startDate=2026-09-01&endDate=2026-09-30&page=3&pageSize=50",
    );
    render(<BaixasPage />);

    await waitFor(() =>
      expect(getPaymentNotifications).toHaveBeenCalledWith(
        {
          search: "Ana",
          state: "email_failed",
          billingType: "BOLETO",
          period: "custom",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          page: 3,
          pageSize: 50,
        },
        expect.any(AbortSignal),
      ),
    );
  });

  it("ignores a custom period without a valid range", async () => {
    mockParams = new URLSearchParams("period=custom&startDate=2026-09-30&endDate=2026-09-01");
    render(<BaixasPage />);

    await waitFor(() => expect(getPaymentNotifications).toHaveBeenCalled());
    expect(getPaymentNotifications.mock.calls[0][0]).toEqual(
      expect.objectContaining({ period: undefined, startDate: undefined, endDate: undefined }),
    );
  });

  it("marks the selected baixas as read and keeps them in place", async () => {
    markPaymentNotificationsAsRead.mockResolvedValue({ count: 2 });
    render(<BaixasPage />);
    await screen.findByRole("table");

    await userEvent.click(screen.getByLabelText("Selecionar as não lidas desta página"));
    expect(screen.getByText("2 baixas selecionadas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Marcar como lidas" }));

    expect(markPaymentNotificationsAsRead).toHaveBeenCalledWith({
      ids: ["notification-1", "notification-2"],
    });
    expect(await screen.findByText("2 baixas marcadas como lidas.")).toBeInTheDocument();
    expect(screen.getByText("55 novas")).toBeInTheDocument();
    expect(screen.queryByLabelText("Selecionar Ana Souza")).toBeNull();
    expect(getPaymentNotifications).toHaveBeenCalledTimes(1);
  });

  it("marks every unread baixa of the filter after confirming the amount", async () => {
    mockParams = new URLSearchParams("billingType=PIX");
    markPaymentNotificationsAsRead.mockResolvedValue({ count: 40 });
    render(<BaixasPage />);
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Marcar 40 baixas como lidas?")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Marcar como lidas" }));

    expect(markPaymentNotificationsAsRead).toHaveBeenCalledWith(
      expect.objectContaining({ billingType: "PIX", asOf: "2026-10-18T18:00:00.000Z" }),
    );
    expect(await screen.findByText("40 baixas marcadas como lidas.")).toBeInTheDocument();
    expect(getPaymentNotifications).toHaveBeenCalledTimes(2);
  });

  it("tells a failure apart from an empty list", async () => {
    getPaymentNotifications.mockRejectedValueOnce(new Error("offline"));
    render(<BaixasPage />);

    expect(await screen.findByText("Não foi possível carregar as baixas.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma baixa registrada")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("offers to clear the filters when nothing matches", async () => {
    mockParams = new URLSearchParams("state=unread");
    getPaymentNotifications.mockResolvedValue(listResponse({ data: [], total: 0, filteredUnread: 0 }));
    render(<BaixasPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Limpar filtros" }));
    expect(replace).toHaveBeenCalledWith("/baixas", { scroll: false });
  });

  it("checks custom dates before applying them", async () => {
    render(<BaixasPage />);
    await screen.findByRole("table");

    await userEvent.selectOptions(screen.getByLabelText("Filtrar por data do pagamento"), "custom");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe a data inicial e a final.");

    await userEvent.type(screen.getByLabelText("Pagas de"), "2026-09-01");
    await userEvent.type(screen.getByLabelText("até"), "2026-09-30");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(replace).toHaveBeenCalledWith(
      "/baixas?period=custom&startDate=2026-09-01&endDate=2026-09-30",
      { scroll: false },
    );
  });
});
