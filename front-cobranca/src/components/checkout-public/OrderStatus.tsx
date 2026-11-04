"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, Loader2 } from "lucide-react";
import {
  CheckoutPublicError,
  formatBRL,
  getCheckoutOrder,
  openAccess,
  type PublicCheckoutOrder,
} from "@/lib/checkout-public";
import { CheckoutShell } from "./CheckoutShell";

const FAST_POLL_MS = 3_000;
const SLOW_POLL_MS = 10_000;
const FAST_WINDOW_MS = 5 * 60_000;
const REDIRECT_DELAY_MS = 3_000;

function remaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Only the Efí PNG data URL is shown as an image.
function qrSource(value: string | null): string | null {
  return value?.startsWith("data:image/png;base64,") ? value : null;
}

type Loaded = { kind: "loading" } | { kind: "ok"; order: PublicCheckoutOrder } | { kind: "missing" } | { kind: "error" };

export function OrderStatus({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const order = loaded.kind === "ok" ? loaded.order : null;
  const finished = order !== null && order.status !== "PENDING";

  useEffect(() => {
    // Polls until the order is paid, expired or failed; slower after 5 minutes.
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let stopped = false;
    const load = () => {
      controller = new AbortController();
      getCheckoutOrder(token, controller.signal)
        .then((result) => {
          if (stopped) return;
          setLoaded({ kind: "ok", order: result });
          if (result.status === "PENDING")
            timer = setTimeout(load, Date.now() - started < FAST_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS);
        })
        .catch((caught: unknown) => {
          if (stopped) return;
          if (caught instanceof CheckoutPublicError && caught.status === 404) setLoaded({ kind: "missing" });
          // A failed poll keeps what is on screen and tries again.
          else {
            setLoaded((current) => (current.kind === "ok" ? current : { kind: "error" }));
            timer = setTimeout(load, SLOW_POLL_MS);
          }
        });
    };
    load();
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(timer);
    };
  }, [token]);

  useEffect(() => {
    if (finished) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [finished]);

  const redirectUrl = order?.status === "PAID" ? order.redirectUrl : null;
  useEffect(() => {
    if (!redirectUrl) return;
    const timer = setTimeout(() => openAccess(redirectUrl), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [redirectUrl]);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (loaded.kind !== "ok")
    return (
      <CheckoutShell page={null}>
        {loaded.kind === "loading" ? (
          <p className="flex items-center justify-center gap-2 py-20 text-slate-500">
            <Loader2 size={18} className="animate-spin" /> Carregando seu pedido…
          </p>
        ) : (
          <p role="alert" className="rounded-lg bg-white p-6 text-center text-slate-700 shadow-sm">
            {loaded.kind === "missing" ? "Pedido não encontrado." : "Não foi possível carregar o pedido. Tente de novo."}
          </p>
        )}
      </CheckoutShell>
    );

  const current = loaded.order;
  const color = current.page?.primaryColor ?? "#0F766E";
  const qr = qrSource(current.pix?.qrCodeImage ?? null);
  return (
    <CheckoutShell page={current.page}>
      <section className="space-y-4 rounded-lg bg-white p-5 text-center shadow-sm">
        {current.status === "PAID" ? (
          <>
            <CheckCircle2 size={44} className="mx-auto text-emerald-600" />
            <h1 className="text-xl font-semibold text-slate-900">Pagamento confirmado</h1>
            <p className="text-sm text-slate-600">O acesso também foi enviado para o seu e-mail.</p>
            {current.redirectUrl && <p className="text-sm text-slate-500">Levando você ao seu acesso…</p>}
            <ul className="space-y-2 text-left text-sm">
              {current.items.map((line) => (
                <li key={`${line.kind}-${line.name}`} className="rounded-md bg-slate-50 p-3">
                  {line.accessUrl ? (
                    <a href={line.accessUrl} className="font-semibold underline" style={{ color }}>
                      Acessar {line.name}
                    </a>
                  ) : (
                    <span className="font-semibold text-slate-800">{line.name}</span>
                  )}
                  {line.accessInstructions && <p className="mt-1 whitespace-pre-line text-slate-600">{line.accessInstructions}</p>}
                </li>
              ))}
            </ul>
          </>
        ) : current.status === "PENDING" && current.processing ? (
          <p className="flex items-center justify-center gap-2 py-8 text-slate-600">
            <Loader2 size={18} className="animate-spin" /> Gerando seu Pix…
          </p>
        ) : current.status === "PENDING" && current.pix ? (
          <>
            <h1 className="text-lg font-semibold text-slate-900">Pague {formatBRL(current.totalCents)} com Pix</h1>
            <p className="text-sm text-slate-600">
              Expira em <span className="font-mono font-semibold" data-testid="countdown">{remaining(current.expiresAt, now)}</span>
            </p>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element -- data URL from the Efí
              <img src={qr} alt="QR Code do Pix" className="mx-auto h-56 w-56" />
            )}
            {current.pix.copyPaste && (
              <div className="space-y-2">
                <p className="break-all rounded-md bg-slate-50 p-3 text-left font-mono text-xs text-slate-700">{current.pix.copyPaste}</p>
                <button
                  type="button"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-md font-semibold text-white"
                  style={{ backgroundColor: color }}
                  onClick={() => void copy(current.pix?.copyPaste ?? "")}
                >
                  <Copy size={18} /> {copied ? "Código copiado" : "Copiar código Pix"}
                </button>
              </div>
            )}
            <p className="text-xs text-slate-500">A confirmação aparece aqui sozinha depois do pagamento.</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-slate-900">
              {current.status === "FAILED" ? "Não foi possível gerar o Pix" : "Este Pix expirou"}
            </h1>
            <p className="text-sm text-slate-600">Gere um novo Pix para concluir a compra. Seus dados continuam preenchidos.</p>
            <Link
              href={`/c/${current.productSlug}`}
              className="flex h-12 w-full items-center justify-center rounded-md font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              Gerar novo Pix
            </Link>
          </>
        )}
      </section>
    </CheckoutShell>
  );
}
