// The public payment page: exactly one path segment after "/pagar/". It needs
// no session; the backend alone decides whether the signed token is valid.
const PUBLIC_PAYMENT_PATH = /^\/pagar\/[^/]+$/;
// Cifra+ Checkout: the product page (/c/<slug>) and the order page
// (/c/pedido/<token>) are open to any visitor, like the payment link.
const PUBLIC_CHECKOUT_PATH = /^\/c\/(?:pedido\/)?[^/]+$/;

export function isPublicPaymentPath(pathname: string | null | undefined): boolean {
  return (
    typeof pathname === "string" &&
    (PUBLIC_PAYMENT_PATH.test(pathname) || PUBLIC_CHECKOUT_PATH.test(pathname))
  );
}
