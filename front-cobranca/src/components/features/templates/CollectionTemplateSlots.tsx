"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";
import {
  BLOCK_LABELS,
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
  MOMENT_HINTS,
  MOMENT_LABELS,
  SLOT_METHOD_LABELS,
  errorText,
  isConflict,
  type CollectionSlotMethod,
  type CollectionTemplateSlot,
  type CollectionTemplateSlots as SlotsView,
} from "./types";

const key = (slot: Pick<CollectionTemplateSlot, "purpose" | "billingMethod">) =>
  `${slot.purpose}:${slot.billingMethod}`;

/**
 * The 18 global collection templates (moment x payment method), shared by every company.
 * Each write carries the version the admin saw; a conflict reloads instead of overwriting.
 */
export function CollectionTemplateSlots(): ReactNode {
  const api = useApiClient();
  const [view, setView] = useState<SlotsView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setView(await api.getCollectionTemplateSlots());
      setDrafts({});
      setLoadError(null);
    } catch (caught: unknown) {
      setLoadError(
        errorText(caught, "Não foi possível carregar os templates da régua."),
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(slot: CollectionTemplateSlot): Promise<void> {
    const templateId = drafts[key(slot)] ?? slot.templateId ?? "";
    const label = `${MOMENT_LABELS[slot.purpose]} · ${SLOT_METHOD_LABELS[slot.billingMethod]}`;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.setCollectionTemplateSlot(slot.purpose, slot.billingMethod, {
        templateId: templateId || null,
        expectedVersion: slot.version,
      });
      setNotice(`Template de “${label}” atualizado.`);
    } catch (caught: unknown) {
      setError(
        isConflict(caught)
          ? "Outro administrador alterou este template. Os dados foram recarregados; revise antes de repetir."
          : errorText(caught, "A alteração não foi salva."),
      );
    } finally {
      await load();
      setBusy(false);
    }
  }

  function options(slot: CollectionTemplateSlot, method: CollectionSlotMethod) {
    const list = view?.options[method] ?? [];
    // The saved template stays visible even if it stopped being offered.
    if (slot.templateId && !list.some((option) => option.id === slot.templateId))
      return [
        ...list,
        {
          id: slot.templateId,
          name: `${slot.templateName ?? slot.templateId} (indisponível)`,
          language: "",
        },
      ];
    return list;
  }

  const readyCount = view?.slots.filter((slot) => slot.available.ready).length ?? 0;

  return (
    <section aria-labelledby="collection-slots" className="space-y-4">
      <div>
        <h2 id="collection-slots" className="text-xl font-semibold">
          Templates da régua
        </h2>
        <p className="text-sm text-slate-600">
          Um template por momento da cobrança e forma de pagamento, igual para
          todas as empresas. Para cartão, só servem templates com o link de
          pagamento (sem Pix e sem boleto). A régua passa a usar estes templates
          quando a seleção automática for publicada; até lá, os envios seguem
          os padrões de cada empresa.
        </p>
      </div>
      {loadError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {loadError}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void load()}
          >
            Tentar novamente
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-700">
          {notice}
        </p>
      )}
      {!view && !loadError && (
        <p className="text-sm text-slate-500">Carregando templates da régua...</p>
      )}
      {view && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">
            {readyCount} de {view.slots.length} prontos
          </p>
          {COLLECTION_PURPOSES.map((purpose) => (
            <div
              key={purpose}
              role="group"
              aria-label={MOMENT_LABELS[purpose]}
              className="rounded-xl border bg-white p-4"
            >
              <h3 className="font-semibold">{MOMENT_LABELS[purpose]}</h3>
              <p className="text-xs text-slate-500">{MOMENT_HINTS[purpose]}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {COLLECTION_SLOT_METHODS.map((method) => {
                  const slot = view.slots.find(
                    (item) =>
                      item.purpose === purpose && item.billingMethod === method,
                  );
                  if (!slot) return null;
                  const draft = drafts[key(slot)] ?? slot.templateId ?? "";
                  const label = `${MOMENT_LABELS[purpose]} · ${SLOT_METHOD_LABELS[method]}`;
                  return (
                    <div key={method} className="space-y-2 rounded-lg border p-3">
                      <label className="block text-sm font-medium">
                        {SLOT_METHOD_LABELS[method]}
                        <select
                          aria-label={`Template: ${label}`}
                          className="mt-1 block w-full rounded-lg border p-2 text-sm font-normal"
                          value={draft}
                          disabled={busy}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [key(slot)]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Sem template</option>
                          {options(slot, method).map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                              {option.language ? ` · ${option.language}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-center justify-between gap-2">
                        {slot.available.ready ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 size={14} /> Pronto
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-800">
                            <CircleAlert size={14} />
                            {slot.templateId && slot.available.code
                              ? BLOCK_LABELS[slot.available.code]
                              : "Sem template"}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Salvar template: ${label}`}
                          disabled={busy || draft === (slot.templateId ?? "")}
                          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
                          onClick={() => void save(slot)}
                        >
                          Salvar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
