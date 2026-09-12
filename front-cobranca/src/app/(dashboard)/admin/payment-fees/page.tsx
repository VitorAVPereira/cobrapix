"use client";
import { PaymentFeeAlerts } from "@/components/features/PaymentFeeAlerts";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useApiClient } from "@/lib/use-api-client";
import type { AdminClient, BillingMethod } from "@/lib/api-client";
interface FeeVersion {
  id: string;
  billingMethod: BillingMethod;
  version: number;
  efiFeeKind: "FIXED" | "PERCENTAGE";
  efiFeeAmountCents: number | null;
  efiFeeBasisPoints: number | null;
  platformFeeKind: "FIXED" | "PERCENTAGE";
  platformFeeAmountCents: number | null;
  platformFeeBasisPoints: number | null;
  effectiveFrom: string;
}
function label(kind: string, fixed: number | null, bps: number | null): string {
  return kind === "FIXED"
    ? new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format((fixed ?? 0) / 100)
    : `${((bps ?? 0) / 100).toLocaleString("pt-BR")}%`;
}
function units(value: string): number {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value))
    throw new Error("Use um valor positivo com até duas casas decimais.");
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Valor inválido.");
  return result;
}
export default function AdminPaymentFeesPage(): ReactNode {
  const api = useApiClient();
  const { data: session } = useSession();
  const allowed = session?.user.role === "PLATFORM_ADMIN";
  const [companies, setCompanies] = useState<AdminClient[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [versions, setVersions] = useState<FeeVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [efiKind, setEfiKind] = useState("FIXED");
  const [platformKind, setPlatformKind] = useState("PERCENTAGE");
  const path = `/admin/payment-fees${companyId ? `/${companyId}` : ""}`;
  const load = useCallback(async (): Promise<void> => {
    if (!allowed) return;
    try {
      setVersions(await api.financialAdmin<FeeVersion[]>(path));
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível carregar tarifas.",
      );
    }
  }, [api, allowed, path]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (allowed)
      void api
        .getAdminClients()
        .then(setCompanies)
        .catch(() => setError("Não foi possível carregar empresas."));
  }, [api, allowed]);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const component = (kind: string, value: string): object =>
        kind === "FIXED"
          ? { kind, amountCents: units(value) }
          : { kind, basisPoints: units(value) };
      await api.financialAdmin(`${path}/versions`, "POST", {
        billingMethod: data.get("method"),
        efiFee: component(efiKind, String(data.get("efi"))),
        platformFee: component(platformKind, String(data.get("platform"))),
        effectiveFrom: new Date(
          String(data.get("effectiveFrom")),
        ).toISOString(),
      });
      await load();
      setSaved(true);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível criar a versão.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return (
      <p className="p-8">Acesso restrito à administração da plataforma.</p>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">
      <header>
        <h1 className="text-2xl font-semibold">Tarifas de recebimento</h1>
        <p className="mt-2 text-sm text-slate-600">
          Versões preservam as tarifas de cobranças já emitidas. Uma tarifa da
          empresa prevalece sobre a global.
        </p>
      </header>
      <label className="block text-sm font-medium">
        Configuração
        <select
          className="ml-3 max-w-full rounded-lg border bg-white p-3"
          value={companyId}
          onChange={(event) => {
            setCompanyId(event.target.value);
            setSaved(false);
          }}
        >
          <option value="">Global</option>
          {companies.map((company) => (
            <option value={company.id} key={company.id}>
              {company.corporateName}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-emerald-700">
          Nova versão registrada.
        </p>
      )}
      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-4 rounded-xl border bg-white p-5"
      >
        <h2 className="font-semibold">
          Criar nova versão {companyId ? "para esta empresa" : "global"}
        </h2>
        <fieldset
          disabled={busy}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="text-sm">
            Meio
            <select defaultValue="BOLIX" name="method" className="mt-1 w-full rounded-lg border p-3">
              <option value="PIX">Pix</option>
              <option value="BOLIX">Bolix</option>
            </select>
          </label>
          <label className="text-sm">
            Tarifa Efí
            <select
              className="mt-1 w-full rounded-lg border p-3"
              value={efiKind}
              onChange={(event) => setEfiKind(event.target.value)}
            >
              <option value="FIXED">Fixa em reais</option>
              <option value="PERCENTAGE">Percentual</option>
            </select>
            <input
              name="efi"
              aria-label="Valor da tarifa Efí"
              required
              inputMode="decimal"
              placeholder={efiKind === "FIXED" ? "Ex.: 1,50" : "Ex.: 0,99"}
              className="mt-2 w-full rounded-lg border p-3"
            />
          </label>
          <label className="text-sm">
            Taxa CifraMais
            <select
              className="mt-1 w-full rounded-lg border p-3"
              value={platformKind}
              onChange={(event) => setPlatformKind(event.target.value)}
            >
              <option value="FIXED">Fixa em reais</option>
              <option value="PERCENTAGE">Percentual</option>
            </select>
            <input
              name="platform"
              aria-label="Valor da taxa CifraMais"
              required
              inputMode="decimal"
              placeholder={platformKind === "FIXED" ? "Ex.: 2,00" : "Ex.: 2,50"}
              className="mt-2 w-full rounded-lg border p-3"
            />
          </label>
          <label className="text-sm">
            Vigência a partir de
            <input
              name="effectiveFrom"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-lg border p-3"
            />
          </label>
        </fieldset>
        <button
          disabled={busy}
          className="rounded-lg bg-emerald-700 px-4 py-3 text-white disabled:opacity-40"
        >
          {busy ? "Registrando…" : "Registrar versão"}
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {["Meio", "Versão", "Efí", "CifraMais", "Vigência"].map(
                (title) => (
                  <th className="p-4" key={title}>
                    {title}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {versions.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="p-4">{item.billingMethod}</td>
                <td className="p-4">{item.version}</td>
                <td className="p-4">
                  {label(
                    item.efiFeeKind,
                    item.efiFeeAmountCents,
                    item.efiFeeBasisPoints,
                  )}
                </td>
                <td className="p-4">
                  {label(
                    item.platformFeeKind,
                    item.platformFeeAmountCents,
                    item.platformFeeBasisPoints,
                  )}
                </td>
                <td className="p-4">
                  {new Date(item.effectiveFrom).toLocaleString("pt-BR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {versions.length === 0 && (
          <p className="p-5 text-slate-600">
            {companyId
              ? "Sem sobrescrita. A configuração global será utilizada."
              : "Sem tarifas globais. Configure cada método antes de liberá-lo."}
          </p>
        )}
      </div>
      <PaymentFeeAlerts />
    </div>
  );
}
