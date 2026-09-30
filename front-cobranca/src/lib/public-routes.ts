// The public payment page: exactly one path segment after "/pagar/". It needs
// no session; the backend alone decides whether the signed token is valid.
const PUBLIC_PAYMENT_PATH = /^\/pagar\/[^/]+$/;

export function isPublicPaymentPath(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && PUBLIC_PAYMENT_PATH.test(pathname);
}
