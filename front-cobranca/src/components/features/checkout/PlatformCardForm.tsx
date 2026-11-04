"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import type { CheckoutPlatformView } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { errorCode } from "@/lib/disbursements";
import { parsePercentToBps } from "@/lib/checkout";
import { buttonClass, Field, inputClass, messageOf, NoticeText, type Notice } from "./ui";

const percent = (bps: number | undefined) => (bps === undefined ? "" : String(bps / 100).replace(".", ","));

/**
 * Card on the CifraMais account: rates of the anticipated receipt, days until
 * the Efí credit and the switch, turned on only after the Efí card approval.
 */
export function PlatformCardForm({
  current,
  onSaved,
  onConflict,
}: {
  current: NonNullable<CheckoutPlatformView["current"]>;
  onSaved: (view: CheckoutPlatformView) => void;
  onConflict: () => void;
}) {
  const api = useApiClient();
  const [cash, setCash] = useState(percent(current.cardRates?.cashBasisPoints));
  const [anticipation, setAnticipation] = useState(percent(current.cardRates?.anticipationBasisPoints));
  const [days, setDays] = useState(String(current.cardCreditDays ?? 30));
  const [enabled, setEnabled] = useState(current.cardEnabled);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const cashBps = parsePercentToBps(cash);
    const anticipationBps = parsePercentToBps(anticipation);
    const creditDays = Number(days);
    if (cashBps === null || cashBps > 2000 || anticipationBps === null || anticipationBps > 1000) {
      setNotice({ error: true, text: "Informe as tarifas em %, como 3,49 e 1,59." });
      return;
    }
    if (!Number.isInteger(creditDays) || creditDays < 1 || creditDays > 60) {
      setNotice({ error: true, text: "Informe os dias até o crédito, de 1 a 60." });
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      onSaved(
        await api.setCheckoutPlatformCard({
          expectedVersion: current.version,
          cardEnabled: enabled,
          cashBasisPoints: cashBps,
          anticipationBasisPoints: anticipationBps,
          cardCreditDays: creditDays,
        }),
      );
    } catch (caught) {
      if (errorCode(caught) === "VERSION_CHANGED") onConflict();
      else setNotice({ error: true, text: messageOf(caught, "Não foi possível salvar o cartão.") });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-md border border-slate-200 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <CreditCard size={16} /> Cartão
        <span className={`text-xs font-medium ${current.cardEnabled ? "text-emerald-700" : "text-slate-500"}`}>
          {current.cardEnabled ? "ligado" : "desligado"}
        </span>
      </h3>
      <p className="text-sm text-slate-500">
        Recebimento antecipado: a venda libera para o vendedor no maior entre 7 dias e os dias até o crédito.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tarifa à vista (%)">
          <input className={inputClass} inputMode="decimal" placeholder="3,49" value={cash} onChange={(event) => setCash(event.target.value)} />
        </Field>
        <Field label="Antecipação por parcela (%)" hint="Cobrada em cada parcela depois da primeira.">
          <input className={inputClass} inputMode="decimal" placeholder="1,59" value={anticipation} onChange={(event) => setAnticipation(event.target.value)} />
        </Field>
        <Field label="Dias até o crédito">
          <input className={inputClass} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>
          Cartão ligado no checkout. Ligue só depois da homologação de cartão na conta Cifra+ (runbook do checkout).
        </span>
      </label>
      <NoticeText notice={notice} />
      <button type="submit" className={buttonClass} disabled={busy}>
        {busy && <Loader2 size={16} className="animate-spin" />}
        Salvar cartão
      </button>
    </form>
  );
}
