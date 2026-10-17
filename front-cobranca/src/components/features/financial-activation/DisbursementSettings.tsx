"use client";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useApiClient } from "@/lib/use-api-client";
import type {
  DisbursementItemUnderVerification,
  DisbursementSettingsView,
} from "@/lib/api-client";
import {
  errorCode,
  formatCents,
  formatDateTime,
  onlyDigits,
} from "@/lib/disbursements";

/**
 * Collaborator payments of one company: readiness, approver and the switch. The approver's
 * phone is changed only here, by the platform admin.
 */
export default function DisbursementSettings({
  companyId,
}: {
  companyId: string;
}) {
  const api = useApiClient();
  const [data, setData] = useState<DisbursementSettingsView | null>(null);
  const [checking, setChecking] = useState<DisbursementItemUnderVerification[]>(
    [],
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async () =>
      Promise.all([
        api.getDisbursementSettings(companyId),
        api.getDisbursementsUnderVerification(companyId),
      ]),
    [api, companyId],
  );
  useEffect(() => {
    let current = true;
    load()
      .then(([settings, items]) => {
        if (!current) return;
        setData(settings);
        setChecking(items);
        setError("");
      })
      .catch(() => {
        if (current)
          setError(
            "Não foi possível carregar a configuração de pagamentos a colaboradores.",
          );
      });
    return () => {
      current = false;
    };
  }, [load]);

  async function reload() {
    const [settings, items] = await load();
    setData(settings);
    setChecking(items);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy) return;
    const form = new FormData(event.currentTarget);
    const enabled = form.has("enabled");
    if (
      data.current?.enabled &&
      !enabled &&
      !window.confirm(
        "Desligar cancela os lotes aguardando aprovação e os pagamentos ainda não enviados. Os Pix já enviados continuam sendo acompanhados. Desligar?",
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.configureDisbursements(companyId, {
        expectedVersion: data.current?.version ?? 0,
        enabled,
        approverName: String(form.get("approverName") ?? "").trim(),
        approverPhone: onlyDigits(String(form.get("approverPhone") ?? "")),
      });
      await reload();
      setNotice(
        enabled
          ? "Pagamentos a colaboradores liberados para esta empresa."
          : "Configuração salva. Pagamentos a colaboradores desligados.",
      );
    } catch (e) {
      const code = errorCode(e);
      if (code === "VERSION_CHANGED") {
        await reload().catch(() => undefined);
        setError(
          "Outro administrador alterou a configuração. Os dados foram recarregados; revise e salve de novo.",
        );
      } else
        setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function check(itemId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const item = await api.checkDisbursementItem(companyId, itemId);
      setNotice(
        item.status === "UNCERTAIN"
          ? "A Efí ainda não encontrou esse envio. Ele continua em verificação."
          : "Situação atualizada pela Efí.",
      );
      await reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível consultar a Efí.",
      );
    } finally {
      setBusy(false);
    }
  }

  const current = data?.current;
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Pagamentos a colaboradores</h2>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
      {!data && !error && <p>Carregando configuração…</p>}
      {data && (
        <>
          <p className="text-sm">
            Situação:{" "}
            <strong>{current?.enabled ? "Liberado" : "Desligado"}</strong>
            {current &&
              ` · versão ${current.version}, alterada em ${formatDateTime(current.createdAt)}`}
          </p>
          {data.readiness.ready ? (
            <p className="text-sm text-emerald-700">
              Pronta para liberar: conta Efí própria, chave Pix e os três
              templates.
            </p>
          ) : (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Falta para liberar:</p>
              <ul className="ml-5 list-disc">
                {data.readiness.missing.map((item) => (
                  <li key={`${item.code}:${item.message}`}>{item.message}</li>
                ))}
              </ul>
            </div>
          )}
          <form
            key={`${companyId}:${current?.version ?? 0}`}
            onSubmit={(e) => void save(e)}
            className="space-y-3 text-sm"
          >
            <fieldset disabled={busy} className="space-y-3">
              <label className="block">
                Nome do aprovador
                <input
                  name="approverName"
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue={current?.approverName}
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <label className="block">
                Celular do aprovador (WhatsApp)
                <input
                  name="approverPhone"
                  required
                  inputMode="numeric"
                  pattern="\D*55\D*(\d\D*){10,11}"
                  placeholder="5511999998888"
                  defaultValue={current?.approverPhone}
                  className="mt-1 w-full rounded border p-2"
                />
                <span className="text-xs text-slate-500">
                  55, DDD e número. O pedido de aprovação de cada lote chega
                  nesse WhatsApp; trocar o aprovador invalida os pedidos em
                  aberto.
                </span>
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={current?.enabled ?? false}
                />
                Liberar pagamentos a colaboradores para esta empresa
              </label>
              <button
                type="submit"
                className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Salvando…" : "Salvar pagamentos a colaboradores"}
              </button>
            </fieldset>
          </form>
          {data.history.length > 1 && (
            <details className="text-sm">
              <summary className="cursor-pointer">Histórico de alterações</summary>
              <ul className="mt-2 space-y-1">
                {data.history.map((version) => (
                  <li key={version.id}>
                    Versão {version.version} ·{" "}
                    {version.enabled ? "Liberado" : "Desligado"} ·{" "}
                    {version.approverName} · {formatDateTime(version.createdAt)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {!!checking.length && (
        <div className="space-y-2">
          <h3 className="font-semibold">Pagamentos em verificação</h3>
          <p className="text-xs text-slate-500">
            A Efí não confirmou o resultado. Nada é reenviado automaticamente;
            consulte para atualizar.
          </p>
          {checking.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"
            >
              <span>
                {item.recipientName} · {formatCents(item.amountCents)} ·
                identificador {item.idEnvio}
              </span>
              <button
                disabled={busy}
                onClick={() => void check(item.id)}
                className="rounded border px-3 py-1"
              >
                Consultar Efí
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
