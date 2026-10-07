"use client";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

type Brand = "visa" | "mastercard" | "elo" | "amex";
type Option = {
  installments: number;
  totalCents: number;
  installmentValueCents: number;
  efiFeeCents: number;
};
type Quote = {
  quoteId: string;
  validUntil: string;
  payeeCode: string;
  environment: "production" | "sandbox";
  options: Option[];
  amounts: {
    principalCents: number;
    discountCents: number;
    lateFineCents: number;
    lateInterestCents: number;
    baseDebtCents: number;
  };
};
const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 p-2 text-slate-950";
function Field({
  label,
  name,
  pattern,
  maxLength,
  type = "text",
  autoComplete = "off",
}: {
  label: string;
  name: string;
  pattern?: string;
  maxLength?: number;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block text-sm text-slate-700">
      {label}
      <input
        required
        name={name}
        type={type}
        pattern={pattern}
        maxLength={maxLength}
        autoComplete={autoComplete}
        className={inputClass}
      />
    </label>
  );
}
export default function CardCheckout({
  signedToken,
  onRefresh,
}: {
  signedToken: string;
  onRefresh: () => void;
}) {
  const [brand, setBrand] = useState<Brand>("visa");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [installments, setInstallments] = useState(1);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const selected = quote?.options.find((o) => o.installments === installments);
  async function request<T>(
    action: string,
    body: unknown,
    key?: string,
  ): Promise<T> {
    const response = await fetch(
      `${API}/payments/public/${encodeURIComponent(signedToken)}/card/${action}`,
      {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.message === "string"
          ? data.message
          : "Não foi possível continuar. Atualize a situação da cobrança.",
      );
    return data as T;
  }
  async function simulate() {
    if (submitting.current || blocked) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setQuote(null);
    try {
      const data = await request<Quote>("quote", { brand });
      setQuote(data);
      setInstallments(data.options[0].installments);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Não foi possível simular.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quote || !selected || submitting.current || blocked) return;
    if (Date.parse(quote.validUntil) <= Date.now()) {
      setQuote(null);
      setMessage("A simulação expirou. Confira os valores novamente.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const fields = new FormData(form);
    const text = (name: string) => String(fields.get(name) ?? "").trim();
    let sent = false;
    try {
      // Card data goes directly to Efí in the browser, never to our API or storage.
      const { default: EfiPay } = await import("payment-token-efi");
      const response = await EfiPay.CreditCard.setAccount(quote.payeeCode)
        .setEnvironment(quote.environment)
        .setCreditCardData({
          brand,
          number: text("cardNumber").replace(/\s/g, ""),
          cvv: text("cvv"),
          expirationMonth: text("month"),
          expirationYear: text("year"),
          holderName: text("holderName"),
          holderDocument: text("cpf"),
          reuse: false,
        })
        .getPaymentToken();
      if (!("payment_token" in response))
        throw new Error("Confira os dados do cartão e tente novamente.");
      const body = {
        quoteId: quote.quoteId,
        installments,
        paymentToken: response.payment_token,
        customer: {
          name: text("holderName"),
          cpf: text("cpf"),
          email: text("email"),
          phone_number: text("phone"),
          ...(text("birth") ? { birth: text("birth") } : {}),
        },
        billingAddress: {
          street: text("street"),
          number: text("number"),
          neighborhood: text("neighborhood"),
          city: text("city"),
          state: text("state").toUpperCase(),
          zipcode: text("zipcode"),
        },
      };
      form.reset();
      sent = true;
      const outcome = await request<{ state: string; canRetry: boolean }>(
        "pay",
        body,
        crypto.randomUUID(),
      );
      if (outcome.canRetry) {
        setQuote(null);
        setMessage(
          "O pagamento não foi autorizado. Faça uma nova simulação para tentar novamente.",
        );
      } else {
        setBlocked(true);
        setMessage(
          outcome.state === "PAID"
            ? "Pagamento confirmado."
            : "Pagamento enviado. Aguarde a confirmação antes de tentar novamente.",
        );
        onRefresh();
      }
    } catch (error) {
      if (sent) {
        setBlocked(true);
        setMessage(
          "A confirmação não chegou. Atualize a situação e aguarde a verificação antes de tentar pagar novamente.",
        );
        onRefresh();
      } else
        setMessage(
          error instanceof Error
            ? error.message
            : "Não foi possível validar o cartão.",
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {message && (
        <p
          role="status"
          className="rounded-md bg-sky-50 p-3 text-sm text-sky-900"
        >
          {message}
        </p>
      )}
      {!blocked && (
        <>
          <label className="block text-sm font-medium">
            Bandeira
            <select
              disabled={busy}
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value as Brand);
                setQuote(null);
              }}
              className={inputClass}
            >
              {(["visa", "mastercard", "elo", "amex"] as Brand[]).map((b) => (
                <option key={b} value={b}>
                  {b === "amex"
                    ? "American Express"
                    : b.charAt(0).toUpperCase() + b.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void simulate()}
            className="rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Aguarde…" : "Simular pagamento"}
          </button>
          {quote && selected && (
            <form onSubmit={(e) => void pay(e)} className="space-y-4">
              <label className="block text-sm font-medium">
                Parcelamento
                <select
                  disabled={busy}
                  value={installments}
                  onChange={(e) => setInstallments(Number(e.target.value))}
                  className={inputClass}
                >
                  {quote.options.map((o) => (
                    <option key={o.installments} value={o.installments}>
                      {o.installments}x de {money(o.installmentValueCents)} —
                      total {money(o.totalCents)}
                    </option>
                  ))}
                </select>
              </label>
              <dl className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 text-sm">
                <dt>Principal</dt>
                <dd>{money(quote.amounts.principalCents)}</dd>
                <dt>Desconto</dt>
                <dd>− {money(quote.amounts.discountCents)}</dd>
                <dt>Multa</dt>
                <dd>{money(quote.amounts.lateFineCents)}</dd>
                <dt>Juros por atraso</dt>
                <dd>{money(quote.amounts.lateInterestCents)}</dd>
                <dt>Custo do cartão Efí</dt>
                <dd>{money(selected.efiFeeCents)}</dd>
                <dt className="font-bold">Total a pagar</dt>
                <dd className="font-bold">{money(selected.totalCents)}</dd>
              </dl>
              <p className="text-xs text-slate-600">
                O custo do cartão inclui a tarifa Efí e os encargos do
                parcelamento escolhido.
              </p>
              <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 font-semibold">
                  Dados do titular e endereço de cobrança
                </legend>
                <Field
                  name="holderName"
                  label="Nome completo do titular"
                  autoComplete="cc-name"
                />
                <Field
                  name="cpf"
                  label="CPF do titular (somente números)"
                  pattern="[0-9]{11}"
                  maxLength={11}
                />
                <Field
                  name="email"
                  label="E-mail"
                  type="email"
                  autoComplete="email"
                />
                <Field
                  name="phone"
                  label="Telefone com DDD (somente números)"
                  pattern="[0-9]{10,11}"
                  maxLength={11}
                />
                <Field name="birth" label="Data de nascimento" type="date" />
                <Field
                  name="zipcode"
                  label="CEP (somente números)"
                  pattern="[0-9]{8}"
                  maxLength={8}
                  autoComplete="postal-code"
                />
                <Field name="street" label="Rua" autoComplete="address-line1" />
                <Field name="number" label="Número" />
                <Field name="neighborhood" label="Bairro" />
                <Field
                  name="city"
                  label="Cidade"
                  autoComplete="address-level2"
                />
                <Field
                  name="state"
                  label="UF"
                  pattern="[A-Za-z]{2}"
                  maxLength={2}
                  autoComplete="address-level1"
                />
                <Field
                  name="cardNumber"
                  label="Número do cartão"
                  pattern="[0-9 ]{13,23}"
                  maxLength={23}
                  autoComplete="cc-number"
                />
                <Field
                  name="month"
                  label="Mês de validade (MM)"
                  pattern="0[1-9]|1[0-2]"
                  maxLength={2}
                  autoComplete="cc-exp-month"
                />
                <Field
                  name="year"
                  label="Ano de validade (AAAA)"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  autoComplete="cc-exp-year"
                />
                <Field
                  name="cvv"
                  label="Código de segurança"
                  pattern="[0-9]{3,4}"
                  maxLength={4}
                  type="password"
                  autoComplete="cc-csc"
                />
              </fieldset>
              <button
                disabled={busy}
                type="submit"
                className="w-full rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-50"
              >
                {busy
                  ? "Processando…"
                  : `Confirmar pagamento de ${money(selected.totalCents)}`}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
