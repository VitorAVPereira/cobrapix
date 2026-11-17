import { isPublicPaymentPath } from "../public-routes";

describe("rotas públicas de pagamento", () => {
  it.each([
    "/pagar/token",
    "/c/porquim-anual-ab12",
    "/c/pedido/token",
    "/c/pedido/token/reembolso",
    "/c/oferta/token",
    // The buyer manages a subscription from the e-mail link, without a session.
    "/c/assinatura/token",
  ])("%s abre sem login", (path) => {
    expect(isPublicPaymentPath(path)).toBe(true);
  });

  it.each(["/c/assinatura/token/outra", "/c/pedido/token/outra", "/checkout/vendas", "/pagar"])(
    "%s não é pública",
    (path) => {
      expect(isPublicPaymentPath(path)).toBe(false);
    },
  );
});
