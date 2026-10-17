"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { CircleCheck, MessageCircle, X } from "lucide-react";
import { QUOTE_DIALOG_ID, QUOTE_REQUEST_URL, WHATSAPP_URL } from "./contact";
import styles from "./landing.module.css";

function openQuoteDialog() {
  const dialog = document.getElementById(QUOTE_DIALOG_ID);
  if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
}

export function QuoteButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={openQuoteDialog}>
      {children}
    </button>
  );
}

type Status = "idle" | "sending" | "sent" | "invalid" | "busy" | "failed";

const ERRORS: Partial<Record<Status, string>> = {
  invalid: "Confira o nome, o e-mail e o celular informados.",
  busy: "Recebemos muitos pedidos deste endereço. Tente de novo em alguns minutos.",
  failed: "Não foi possível enviar seu pedido agora. Tente de novo ou fale com a gente pelo WhatsApp.",
};

export function QuoteDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<Status>("idle");

  const close = () => dialogRef.current?.close();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    const data = new FormData(event.currentTarget);
    const optional = (name: string) => String(data.get(name) ?? "").trim() || undefined;

    setStatus("sending");
    try {
      const response = await fetch(QUOTE_REQUEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Without an answer the visitor would wait forever; the WhatsApp fallback is better.
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          name: String(data.get("name") ?? "").trim(),
          email: String(data.get("email") ?? "").trim(),
          phone: String(data.get("phone") ?? "").trim(),
          monthlyVolume: optional("monthlyVolume"),
          averageTicket: optional("averageTicket"),
          website: optional("website"),
        }),
      });
      if (response.ok) setStatus("sent");
      else if (response.status === 400) setStatus("invalid");
      else if (response.status === 429) setStatus("busy");
      else setStatus("failed");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      id={QUOTE_DIALOG_ID}
      className={styles.quoteDialog}
      aria-labelledby="orcamento-title"
      onClose={() => setStatus((current) => (current === "sent" ? "idle" : current))}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
    >
      <div className={styles.quoteBox}>
        <div className={styles.quoteHead}>
          <h2 id="orcamento-title">Solicitar orçamento</h2>
          <button type="button" className={styles.quoteClose} onClick={close} aria-label="Fechar">
            <X size={20} aria-hidden />
          </button>
        </div>

        {status === "sent" ? (
          <div className={styles.quoteDone} role="status">
            <CircleCheck size={40} aria-hidden />
            <p>Recebemos seu pedido. Nossa equipe entra em contato em breve.</p>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={close}>
              Fechar
            </button>
          </div>
        ) : (
          <form className={styles.quoteForm} onSubmit={(event) => void submit(event)}>
            <p className={styles.quoteIntro}>
              Conte um pouco sobre sua empresa. Respondemos pelo contato informado.
            </p>
            <label>
              Nome
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
                autoFocus
              />
            </label>
            <label>
              E-mail
              <input name="email" type="email" required maxLength={254} autoComplete="email" />
            </label>
            <label>
              Celular com DDD
              <input
                name="phone"
                type="tel"
                required
                inputMode="tel"
                pattern="[\d\s()+\-]{10,20}"
                title="Informe o celular com DDD, por exemplo (11) 98888-7777."
                autoComplete="tel"
              />
            </label>
            <div className={styles.quotePair}>
              <label>
                <span>
                  Cobranças por mês <small>(opcional)</small>
                </span>
                <input name="monthlyVolume" maxLength={60} inputMode="numeric" />
              </label>
              <label>
                <span>
                  Ticket médio <small>(opcional)</small>
                </span>
                <input name="averageTicket" maxLength={60} placeholder="R$" />
              </label>
            </div>
            {/* Honeypot: hidden from people and assistive technology. */}
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className={styles.quoteTrap}
            />

            {ERRORS[status] && (
              <p className={styles.quoteError} role="alert">
                {ERRORS[status]}
                {status === "failed" && (
                  <>
                    {" "}
                    <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                      Abrir WhatsApp
                    </a>
                  </>
                )}
              </p>
            )}

            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={status === "sending"}
            >
              {status === "sending" ? "Enviando…" : "Enviar pedido"}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}

export function WhatsAppFloat() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.whatsFloat}
      aria-label="Falar com a Cifra+ pelo WhatsApp"
    >
      <MessageCircle size={28} aria-hidden />
    </a>
  );
}
