// The public payment page: exactly one path segment after "/pagar/". It needs
// no session; the backend alone decides whether the signed token is valid.
const PUBLIC_PAYMENT_PATH = /^\/pagar\/[^/]+$/;
// Cifra+ Checkout: the product page (/c/<slug>), the order page
// (/c/pedido/<token>) and its refund request are open to any visitor.
const PUBLIC_CHECKOUT_PATH = /^\/c\/(?:pedido\/[^/]+(?:\/reembolso)?|[^/]+)$/;

export function isPublicPaymentPath(pathname: string | null | undefined): boolean {
  return (
    typeof pathname === "string" &&
    (PUBLIC_PAYMENT_PATH.test(pathname) || PUBLIC_CHECKOUT_PATH.test(pathname))
  );
}
