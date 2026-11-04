"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { CheckoutClientDetail } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatDateTime } from "@/lib/disbursements";
import { inputClass, messageOf, NoticeText, secondaryButtonClass, type Notice } from "./ui";

/** Pause or resume one seller's card (e.g. high chargeback); Pix keeps selling. */
export function CardPausePanel({
  client,
  onChanged,
}: {
  client: CheckoutClientDetail;
  onChanged: (client: CheckoutClientDetail) => void;
}) {
  const api = useApiClient();
  const paused = Boolean(client.card.pausedAt);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setBusy(true);
    try {
      const updated = await api.setCheckoutCardPause(client.id, { paused: !paused, reason: reason.trim() });
      setReason("");
      setNotice({ error: false, text: paused ? "Cartão retomado." : "Cartão pausado. O Pix continua vendendo." });
      onChanged(updated);
    } catch (caught) {
      setNotice({ error: true, text: messageOf(caught, "Não foi possível alterar o cartão.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Cartão deste vendedor</h3>
      <p className="text-sm text-slate-600">
        {client.card.pausedAt
          ? `Pausado pela Cifra+ desde ${formatDateTime(client.card.pausedAt)}.`
          : client.card.enabledBySeller
            ? "Ligado pelo vendedor."
            : "Desligado pelo vendedor."}
      </p>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Motivo (fica na auditoria)
        <input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} />
      </label>
      <NoticeText notice={notice} />
      <button type="submit" className={secondaryButtonClass} disabled={busy || reason.trim().length < 5}>
        {busy && <Loader2 size={16} className="animate-spin" />}
        {paused ? "Retomar cartão" : "Pausar cartão"}
      </button>
    </form>
  );
}
