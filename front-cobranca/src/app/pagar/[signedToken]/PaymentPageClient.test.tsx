import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentPageClient from "./PaymentPageClient";
import type { LoadedPayment, PublicPaymentData } from "./load-payment";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

const PIX = `00020101021226830014BR.GOV.BCB.PIX2561qrcodes.example/v2/${"a".repeat(120)}5204000053039865802BR6304ABCD`;
const LINE = "00190.00009 01234.567893 00000.000000 1 99990000015000";

function payment(data: Partial<PublicPaymentData> = {}): LoadedPayment {
  return {
    kind: "ok",
    data: {
      invoiceId: "invoice-1",
      companyName: "Empresa Teste",
      debtorName: "Maria Silva",
      amount: 150.5,
      dueDate: "2026-05-30T00:00:00.000Z",
      billingType: "BOLIX",
      state: "PAYABLE",
      canPay: true,
      paidAt: null,
      pixCopyPaste: PIX,
      boletoLine: LINE,
      boletoLink: "https://boleto.example/1",
      boletoPdf: "https://boleto.example/1.pdf",
      expiresAt: null,
      ...data,
    },
  };
}

const closedInstruments = {
  canPay: false,
  pixCopyPaste: null,
  boletoLine: null,
  boletoLink: null,
  boletoPdf: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

function mockClipboard(writeText = jest.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

it("offers every instrument of a payable charge and copies codes whole", async () => {
  const user = userEvent.setup();
  const writeText = mockClipboard();
  render(<PaymentPageClient payment={payment()} />);
  expect(screen.getByRole("heading", { name: "Pagamento de cobrança" })).toBeInTheDocument();
  expect(screen.getByText("Boleto com Pix")).toBeInTheDocument();
  // Calendar due date, not shifted to the previous day by the time zone.
  expect(screen.getByText(/vencimento em 30\/05\/2026/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /Copiar Pix copia e cola/ }));
  expect(writeText).toHaveBeenLastCalledWith(PIX);
  expect(await screen.findByText("Copiar Pix copia e cola: copiado")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Copiar linha digitável/ }));
  expect(writeText).toHaveBeenLastCalledWith(LINE);
  expect(screen.getByText(PIX)).toBeInTheDocument();

  const boleto = screen.getByRole("link", { name: /Abrir boleto/ });
  expect(boleto).toHaveAttribute("href", "https://boleto.example/1");
  expect(boleto).toHaveAttribute("target", "_blank");
  expect(boleto.getAttribute("rel")).toContain("noreferrer");
  expect(boleto).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(screen.getByRole("link", { name: /Abrir PDF/ })).toHaveAttribute("href", "https://boleto.example/1.pdf");
});

it("tells the payer how to copy by hand when the clipboard is blocked", async () => {
  const user = userEvent.setup();
  mockClipboard(jest.fn().mockRejectedValue(new Error("denied")));
  render(<PaymentPageClient payment={payment()} />);
  await user.click(screen.getByRole("button", { name: /Copiar linha digitável/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("copie manualmente");
});

it.each(["javascript:alert(1)", "http://boleto.example/1", "data:text/html,x", "/cobrancas", "not a url"])(
  "never renders the unexpected link %s",
  (href) => {
    render(<PaymentPageClient payment={payment({ boletoLink: href, boletoPdf: href })} />);
    expect(screen.queryByRole("link")).toBeNull();
  },
);

it.each([
  ["PAID", "Pagamento confirmado", "Não é necessário pagar novamente"],
  ["CANCELED", "Cobrança cancelada", "fale com Empresa Teste"],
  ["EXPIRED", "Prazo de pagamento encerrado", "receber uma nova cobrança"],
  ["UNAVAILABLE", "Pagamento indisponível no momento", "ainda não estão disponíveis"],
] as const)("shows only the status for %s", (state, title, message) => {
  render(<PaymentPageClient payment={payment({ state, ...closedInstruments })} />);
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(message);
  expect(screen.queryByRole("button", { name: /Copiar/ })).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
});

it("shows the confirmation time of a paid charge in Brasília", () => {
  render(
    <PaymentPageClient
      payment={payment({ state: "PAID", paidAt: "2026-05-29T18:00:00.000Z", ...closedInstruments })}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Confirmado em 29/05/2026, 15:00");
});

it("never offers instruments the backend did not confirm as payable", () => {
  // Defensive: instruments present, but the server did not allow payment.
  render(<PaymentPageClient payment={payment({ state: "PAID", canPay: false })} />);
  render(<PaymentPageClient payment={payment({ state: "PAYABLE", canPay: false })} />);
  expect(screen.queryByRole("button", { name: /Copiar/ })).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByText(PIX)).toBeNull();
});

it("drops the instruments once a refresh reports the charge paid", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<PaymentPageClient payment={payment()} />);
  await user.click(screen.getByRole("button", { name: "Atualizar situação" }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  rerender(<PaymentPageClient payment={payment({ state: "PAID", ...closedInstruments })} />);
  expect(screen.getByRole("heading", { name: "Pagamento confirmado" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Copiar/ })).toBeNull();
  expect(screen.queryByText(PIX)).toBeNull();
});

it("reads the state again when the page returns from the browser history", () => {
  render(<PaymentPageClient payment={payment()} />);
  act(() => {
    const event = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(event, "persisted", { value: true });
    window.dispatchEvent(event);
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  fireEvent(window, new Event("pageshow"));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it("shows a refused link without any charge detail", () => {
  render(<PaymentPageClient payment={{ kind: "invalid" }} />);
  expect(screen.getByRole("heading", { name: "Link indisponível" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Link de pagamento inválido ou expirado.");
  expect(screen.queryByText(/Maria|Empresa|R\$/)).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it("never presents an unreachable API as a paid or canceled charge", async () => {
  const user = userEvent.setup();
  render(<PaymentPageClient payment={{ kind: "unavailable" }} />);
  expect(screen.getByRole("heading", { name: "Não foi possível carregar esta cobrança agora" })).toBeInTheDocument();
  expect(screen.queryByText(/confirmado|cancelada|encerrado/i)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Atualizar situação" }));
  expect(mockRefresh).toHaveBeenCalled();
});

it("has no way into the product dashboard", () => {
  render(<PaymentPageClient payment={payment()} />);
  for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).toMatch(/^https:\/\//);
  expect(screen.queryByRole("navigation")).toBeNull();
});
