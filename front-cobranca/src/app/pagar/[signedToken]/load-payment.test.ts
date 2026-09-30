/** @jest-environment node */
import { loadPayment, parsePublicPayment } from "./load-payment";

const body = {
  invoiceId: "invoice-1",
  companyName: "Empresa Teste",
  debtorName: "Maria Silva",
  amount: 150.5,
  dueDate: "2026-05-30T00:00:00.000Z",
  billingType: "BOLIX",
  state: "PAYABLE",
  canPay: true,
  paidAt: null,
  pixCopyPaste: "000201bolix",
  boletoLine: "0019",
  boletoLink: "https://boleto.example/1",
  boletoPdf: null,
  expiresAt: null,
};

function respond(status: number, json: unknown = body) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => json });
}

afterEach(() => {
  jest.useRealTimers();
});

it("reads the public endpoint without cache or credentials", async () => {
  const fetcher = respond(200);
  await expect(loadPayment("pay.load/..", fetcher as unknown as typeof fetch)).resolves.toEqual({
    kind: "ok",
    data: body,
  });
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(/\/payments\/public\/pay\.load%2F\.\.$/);
  expect(init.cache).toBe("no-store");
  expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
});

it.each([400, 404])("treats %s as a refused link", async (status) => {
  await expect(loadPayment("t", respond(status) as unknown as typeof fetch)).resolves.toEqual({ kind: "invalid" });
});

it.each([429, 500, 502, 503])("treats %s as a temporary unavailability", async (status) => {
  await expect(loadPayment("t", respond(status) as unknown as typeof fetch)).resolves.toEqual({
    kind: "unavailable",
  });
});

it("treats a network failure or malformed answer as unavailable", async () => {
  await expect(
    loadPayment("t", jest.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch),
  ).resolves.toEqual({ kind: "unavailable" });
  await expect(loadPayment("t", respond(200, { state: "PAID" }) as unknown as typeof fetch)).resolves.toEqual({
    kind: "unavailable",
  });
  await expect(
    loadPayment("t", respond(200, { ...body, state: "HACKED" }) as unknown as typeof fetch),
  ).resolves.toEqual({ kind: "unavailable" });
});

it("gives up on a slow API instead of hanging the page", async () => {
  jest.useFakeTimers();
  const fetcher = jest.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
  );
  const pending = loadPayment("t", fetcher as unknown as typeof fetch);
  jest.advanceTimersByTime(8_000);
  await expect(pending).resolves.toEqual({ kind: "unavailable" });
});

it("drops instruments the server did not allow to be paid", () => {
  expect(parsePublicPayment({ ...body, state: "PAID", canPay: false })).toMatchObject({
    state: "PAID",
    canPay: false,
    pixCopyPaste: null,
    boletoLine: null,
    boletoLink: null,
  });
  expect(parsePublicPayment({ ...body, canPay: false })).toMatchObject({ canPay: false, pixCopyPaste: null });
});

it("keeps links working against an API published before the state field", () => {
  const legacy: Record<string, unknown> = { ...body };
  delete legacy.state;
  delete legacy.canPay;
  delete legacy.paidAt;
  expect(parsePublicPayment(legacy)).toMatchObject({ state: "PAYABLE", canPay: true, boletoLine: "0019" });
});
