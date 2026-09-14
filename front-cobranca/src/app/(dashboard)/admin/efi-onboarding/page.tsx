"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useApiClient } from "@/lib/use-api-client";
import { certificateExpirationNotice, EFI_STATUS_LABELS } from "@/lib/efi-onboarding";
import type { EfiOnboardingStatus } from "@/lib/efi-onboarding";

interface Row {
  companyId: string;
  status: EfiOnboardingStatus;
  submittedAt: string | null;
  lastProgressAt: string;
  sanitizedErrorCode: string | null;
  provisioningAttempts: number;
  company: { corporateName: string; document: string };
}
interface Health {
  integration: string;
  enabled: boolean;
  healthStatus: string;
  lastCheckedAt: string | null;
}
interface Detail {
  onboarding: {
    status: EfiOnboardingStatus;
    simplifiedAccountRequestId: string | null;
    sanitizedErrorCode: string | null;
    provisioningAttempts: number;
  } | null;
  gateway: {
    status: string;
    healthStatus: string;
    certificateExpiresAt: string | null;
    lastValidatedAt: string | null;
    consecutiveFailures: number;
    lastError: string | null;
  } | null;
  timeline: Array<{ action: string; createdAt: string }>;
}
export default function AdminEfiOnboardingPage(): ReactNode {
  const api = useApiClient();
  const { data: session } = useSession();
  const allowed = session?.user.role === "PLATFORM_ADMIN";
  const inspection = useRef(0);
  const [items, setItems] = useState<Row[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    if (!allowed) return;
    try {
      const [list, status] = await Promise.all([
        api.financialAdmin<{ items: Row[]; total: number }>(
          `/admin/efi-onboarding?page=${page}`,
        ),
        api.financialAdmin<Health[]>("/admin/integrations/health"),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setHealth(status);
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Falha ao carregar o painel.",
      );
    }
  }, [api, allowed, page]);
  useEffect(() => {
    void load();
  }, [load]);
  async function inspect(row: Row): Promise<void> {
    const request = ++inspection.current;
    setSelected(row);
    setDetail(null);
    try {
      const nextDetail = await api.financialAdmin<Detail>(`/admin/efi-onboarding/${row.companyId}`);
      if (request === inspection.current) setDetail(nextDetail);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao consultar.",
      );
    }
  }
  async function action(
    path: string,
    method: "POST" | "PUT",
    body?: unknown,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.financialAdmin(path, method, body);
      await load();
      if (selected) await inspect(selected);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "A operação não foi concluída.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function manual(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    await action(`/admin/efi-onboarding/${selected.companyId}/manual`, "POST", {
      requestId: String(data.get("requestId") ?? ""),
      ...(!detail?.onboarding?.simplifiedAccountRequestId
        ? {
            ownershipVerified: data.get("ownershipVerified") === "on",
            verifiedCompanyDocument: String(
              data.get("verifiedCompanyDocument") ?? "",
            ),
          }
        : {}),
      ...(data.get("certificate")
        ? {
            certificateBase64: String(data.get("certificate")),
            certificatePassword: String(data.get("password") ?? ""),
          }
        : {}),
    });
    form.reset();
  }
  if (!allowed)
    return (
      <p className="p-8">Acesso restrito à administração da plataforma.</p>
    );
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Ativações e saúde financeira
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Acompanhe pendências, validações e certificados.
          </p>
        </div>
        <button
          className="rounded-lg border px-4 py-2"
          onClick={() => void load()}
        >
          Atualizar
        </button>
      </header>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {health.map((item) => (
          <div
            key={item.integration}
            className="rounded-xl border bg-white p-4"
          >
            <h2 className="font-semibold">
              {{
                META: "WhatsApp central",
                RESEND: "E-mail central",
                EFI_ONBOARDING: "Novas ativações",
                EFI_PAYMENTS: "Novas emissões",
              }[item.integration] ?? item.integration}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {item.enabled ? "Liberado" : "Pausado"} · {item.healthStatus}
            </p>
            {["EFI_ONBOARDING", "EFI_PAYMENTS", "META", "RESEND"].includes(
              item.integration,
            ) && (
              <button
                disabled={busy}
                className="mt-3 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                onClick={() =>
                  void action(
                    `/admin/integrations/${{ EFI_ONBOARDING: "efi-onboarding", EFI_PAYMENTS: "efi-payments", META: "meta", RESEND: "resend" }[item.integration]}`,
                    "PUT",
                    { enabled: !item.enabled },
                  )
                }
              >
                {item.enabled ? "Pausar" : "Liberar"}
              </button>
            )}
          </div>
        ))}
      </section>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {[
                "Empresa",
                "Situação",
                "Tentativas",
                "Último avanço",
                "Ação",
              ].map((label) => (
                <th className="p-4" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.companyId} className="border-t">
                <td className="p-4">
                  <p className="font-medium">{row.company.corporateName}</p>
                  <p className="text-xs text-slate-500">
                    {row.company.document}
                  </p>
                </td>
                <td className="p-4">
                  {EFI_STATUS_LABELS[row.status]}
                  {row.sanitizedErrorCode && (
                    <p className="text-xs text-red-700">
                      {row.sanitizedErrorCode}
                    </p>
                  )}
                </td>
                <td className="p-4">{row.provisioningAttempts}/5</td>
                <td className="p-4">
                  {new Date(row.lastProgressAt).toLocaleString("pt-BR")}
                </td>
                <td className="p-4">
                  <button
                    className="text-emerald-700 underline"
                    onClick={() => void inspect(row)}
                  >
                    Detalhes
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="p-5 text-slate-500">Nenhuma ativação cadastrada.</p>
        )}
      </div>
      <div className="flex gap-4 items-center text-sm">
        <button
          disabled={page === 1}
          onClick={() => setPage((value) => value - 1)}
          className="disabled:opacity-40"
        >
          Anterior
        </button>
        <span>Página {page}</span>
        <button
          disabled={page * 50 >= total}
          onClick={() => setPage((value) => value + 1)}
          className="disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
      {selected && (
        <section className="space-y-4 rounded-xl border bg-white p-5">
          <div className="flex justify-between">
            <h2 className="font-semibold">{selected.company.corporateName}</h2>
            <button
              onClick={() => {
                inspection.current++;
                setSelected(null);
                setDetail(null);
              }}
            >
              Fechar
            </button>
          </div>
          {!detail ? (
            <p>Carregando…</p>
          ) : (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Saúde</dt>
                  <dd>
                    {detail.gateway?.healthStatus ?? "Ainda não provisionada"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Certificado válido até</dt>
                  <dd>
                    {detail.gateway?.certificateExpiresAt
                      ? new Date(
                          detail.gateway.certificateExpiresAt,
                        ).toLocaleDateString("pt-BR")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Falhas consecutivas</dt>
                  <dd>{detail.gateway?.consecutiveFailures ?? 0}</dd>
                </div>
              </dl>
              {certificateExpirationNotice(detail.gateway?.certificateExpiresAt) && (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">{certificateExpirationNotice(detail.gateway?.certificateExpiresAt)}</p>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  disabled={
                    busy || detail.onboarding?.status !== "CONFIGURATION_ERROR"
                  }
                  className="rounded-lg border px-3 py-2 disabled:opacity-40"
                  onClick={() =>
                    void action(
                      `/admin/efi-onboarding/${selected.companyId}/retry-provisioning`,
                      "POST",
                    )
                  }
                >
                  Repetir provisionamento
                </button>
                <button
                  disabled={busy || detail.onboarding?.status !== "ACTIVE"}
                  className="rounded-lg border px-3 py-2 disabled:opacity-40"
                  onClick={() =>
                    void action(
                      `/admin/efi-onboarding/${selected.companyId}/validate`,
                      "POST",
                    )
                  }
                >
                  Validar integração agora
                </button>
              </div>
              {[
                "CONFIGURATION_ERROR",
                "SUBMISSION_UNCERTAIN",
                "ACTIVE",
              ].includes(detail.onboarding?.status ?? "") && (
                <form
                  onSubmit={(event) => void manual(event)}
                  className="space-y-3 border-t pt-4"
                >
                  <h3 className="font-medium">Recuperação manual validada</h3>
                  <p className="text-sm text-slate-600">
                    Use o identificador confirmado pela Efí para esta empresa. O
                    certificado recupera uma geração incerta e é obrigatório
                    para renovar uma integração ativa. A conta passará por todas
                    as validações.
                  </p>
                  <label className="block text-sm">
                    Identificador Efí
                    <input
                      name="requestId"
                      required
                      defaultValue={
                        detail.onboarding?.simplifiedAccountRequestId ?? ""
                      }
                      className="mt-1 w-full rounded-lg border p-3"
                    />
                  </label>
                  <label className="block text-sm">
                    P12 em base64{" "}
                    {detail.onboarding?.status === "ACTIVE"
                      ? "(obrigatório)"
                      : "(opcional)"}
                    <textarea
                      name="certificate"
                      required={detail.onboarding?.status === "ACTIVE"}
                      autoComplete="off"
                      className="mt-1 w-full rounded-lg border p-3"
                    />
                  </label>
                  {!detail.onboarding?.simplifiedAccountRequestId && (
                    <fieldset className="space-y-3 rounded-lg border p-3">
                      <legend className="text-sm font-medium">
                        Conferência de titularidade
                      </legend>
                      <label className="block text-sm">
                        CNPJ titular consultado no painel Efí (14 dígitos)
                        <input
                          name="verifiedCompanyDocument"
                          required
                          pattern="[0-9]{14}"
                          inputMode="numeric"
                          maxLength={14}
                          className="mt-1 w-full rounded-lg border p-3"
                        />
                      </label>
                      <label className="flex gap-2 text-sm">
                        <input
                          name="ownershipVerified"
                          type="checkbox"
                          required
                        />
                        Conferi no painel Efí que este identificador pertence ao
                        CNPJ informado. Esta confirmação será registrada com meu
                        usuário.
                      </label>
                    </fieldset>
                  )}
                  <label className="block text-sm">
                    Senha do P12
                    <input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      className="mt-1 w-full rounded-lg border p-3"
                    />
                  </label>
                  <button
                    disabled={busy}
                    className="rounded-lg bg-emerald-700 px-4 py-3 text-white disabled:opacity-40"
                  >
                    Validar e retomar
                  </button>
                </form>
              )}
              <ol className="space-y-2 border-t pt-4 text-sm">
                {detail.timeline.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`}>
                    {new Date(event.createdAt).toLocaleString("pt-BR")} ·{" "}
                    {event.action}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </div>
  );
}
