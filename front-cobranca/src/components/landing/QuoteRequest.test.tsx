import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuoteDialog } from "./QuoteRequest";

const fetchMock = jest.fn();

function fillRequired() {
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: " Maria Silva " } });
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "maria@empresa.com.br" } });
  fireEvent.change(screen.getByLabelText("Celular com DDD"), {
    target: { value: "(11) 98888-7777" },
  });
}

describe("QuoteDialog", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("envia o pedido sem os campos opcionais vazios e mostra a confirmação", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    render(<QuoteDialog />);
    fillRequired();

    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido", hidden: true }));

    await screen.findByText("Recebemos seu pedido. Nossa equipe entra em contato em breve.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/contact\/quote-request$/);
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Maria Silva",
      email: "maria@empresa.com.br",
      phone: "(11) 98888-7777",
    });
  });

  it("avisa como os dados são usados e leva à política de privacidade em outra aba", () => {
    render(<QuoteDialog />);

    const link = screen.getByRole("link", { name: "Política de privacidade", hidden: true });
    expect(link).toHaveAttribute("href", "/privacidade");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/Usamos seus dados só para responder a este pedido/)).toBeInTheDocument();
  });

  it("avisa quando há pedidos demais e mantém o formulário", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    render(<QuoteDialog />);
    fillRequired();

    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido", hidden: true }));

    await waitFor(() =>
      expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent(
        "Recebemos muitos pedidos deste endereço.",
      ),
    );
    expect(screen.getByLabelText("Nome")).toHaveValue(" Maria Silva ");
  });

  it("oferece o WhatsApp quando o envio falha", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<QuoteDialog />);
    fillRequired();

    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido", hidden: true }));

    expect(
      await screen.findByRole("link", { name: "Abrir WhatsApp", hidden: true }),
    ).toHaveAttribute("href", expect.stringContaining("https://wa.me/"));
  });
});
