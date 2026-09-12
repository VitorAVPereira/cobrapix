"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { PaymentFeeQuote } from "@/lib/api-client";

interface Props {
  quote: PaymentFeeQuote;
  replacing: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (newDueDate?: string) => Promise<void>;
}

const money = (cents: number): string =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PaymentFeeConfirmation({
  quote,
  replacing,
  busy,
  onCancel,
  onConfirm,
}: Props): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [newDueDate, setNewDueDate] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minimumDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!busy) await onConfirm(replacing ? newDueDate : undefined);
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="fee-confirmation-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border-0 p-6 shadow-xl backdrop:bg-slate-950/40"
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <h2
          id="fee-confirmation-title"
          className="text-xl font-semibold text-slate-900"
        >
          {replacing ? "Substituir cobrança vencida" : "Confirmar emissão"}
        </h2>
        <p className="text-sm text-slate-600">
          {quote.billingMethod === "PIX"
            ? "Pix"
            : quote.billingMethod === "BOLIX"
              ? "Bolix"
              : "Boleto"}
        </p>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt>Valor bruto</dt>
            <dd>{money(quote.grossAmountCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>
              Taxa{" "}
              <span className="block text-xs text-slate-500">
                {quote.feeLabel}
              </span>
            </dt>
            <dd>{money(quote.totalFeeCents)}</dd>
          </div>
          <div className="flex justify-between border-t pt-3 font-semibold">
            <dt>Líquido estimado</dt>
            <dd>{money(quote.netAmountCents)}</dd>
          </div>
        </dl>
        {replacing && (
          <>
            <p className="text-sm text-slate-600">
              A cobrança anterior será cancelada. A nova emissão usará a tarifa
              vigente e ficará vinculada ao histórico da fatura.
            </p>
            <label className="block text-sm font-medium">
              Novo vencimento
              <input
                type="date"
                required
                min={minimumDate}
                value={newDueDate}
                onChange={(event) => setNewDueDate(event.target.value)}
                className="mt-2 block w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
          </>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded border px-4 py-2 text-sm"
          >
            Voltar
          </button>
          <button
            type="submit"
            disabled={busy || (replacing && !newDueDate)}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? "Processando…"
              : replacing
                ? "Cancelar anterior e emitir nova"
                : "Emitir cobrança"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
