"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  CirclePlus,
  Loader2,
  Save,
  Trash2,
} from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";

const DEFAULT_OFFSETS = [-2, 0, 2, 7];
const QUICK_OFFSETS = [-7, -3, -2, -1, 0, 1, 2, 3, 7, 15, 30];
const MIN_OFFSET = -30;
const MAX_OFFSET = 365;

function normalizeOffsets(offsets: number[]): number[] {
  return Array.from(
    new Set(
      offsets.filter(
        (offset) =>
          Number.isInteger(offset) &&
          offset >= MIN_OFFSET &&
          offset <= MAX_OFFSET,
      ),
    ),
  ).sort((left, right) => left - right);
}

function formatOffset(offset: number): string {
  if (offset === 0) {
    return "No vencimento";
  }

  const absoluteOffset = Math.abs(offset);
  const dayLabel = absoluteOffset === 1 ? "dia" : "dias";

  if (offset < 0) {
    return `${absoluteOffset} ${dayLabel} antes`;
  }

  return `${absoluteOffset} ${dayLabel} depois`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Nao foi possivel salvar a configuracao.";
}

export default function BillingSettingsPage() {
  const apiClient = useApiClient();
  const [selectedOffsets, setSelectedOffsets] = useState<number[]>([0]);
  const [customOffset, setCustomOffset] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const orderedOffsets = useMemo(
    () => normalizeOffsets(selectedOffsets),
    [selectedOffsets],
  );

  useEffect(() => {
    let active = true;

    async function loadSettings(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const settings = await apiClient.getBillingSettings();

        if (active) {
          setSelectedOffsets(normalizeOffsets(settings.collectionReminderDays));
        }
      } catch (loadError) {
        if (active) {
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      active = false;
    };
  }, [apiClient]);

  function toggleOffset(offset: number): void {
    setSelectedOffsets((current) => {
      if (current.includes(offset)) {
        const nextOffsets = current.filter((item) => item !== offset);
        return nextOffsets.length > 0 ? nextOffsets : current;
      }

      return normalizeOffsets([...current, offset]);
    });
    setSuccess(null);
  }

  function removeOffset(offset: number): void {
    setSelectedOffsets((current) => {
      const nextOffsets = current.filter((item) => item !== offset);
      return nextOffsets.length > 0 ? nextOffsets : current;
    });
    setSuccess(null);
  }

  function applyDefaultOffsets(): void {
    setSelectedOffsets(DEFAULT_OFFSETS);
    setSuccess(null);
  }

  function addCustomOffset(): void {
    const offset = Number(customOffset);

    if (
      !Number.isInteger(offset) ||
      offset < MIN_OFFSET ||
      offset > MAX_OFFSET
    ) {
      setError("Informe um numero inteiro entre -30 e 365.");
      return;
    }

    setSelectedOffsets((current) => normalizeOffsets([...current, offset]));
    setCustomOffset("");
    setError(null);
    setSuccess(null);
  }

  async function saveSettings(): Promise<void> {
    const collectionReminderDays = normalizeOffsets(selectedOffsets);

    if (collectionReminderDays.length === 0) {
      setError("Mantenha pelo menos um dia de cobranca ativo.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const saved = await apiClient.updateBillingSettings({
        collectionReminderDays,
      });
      setSelectedOffsets(normalizeOffsets(saved.collectionReminderDays));
      setSuccess("Agenda de cobranca salva.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              Agenda de cobranca
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Defina os dias em que devedores recebem mensagens pelo WhatsApp/E-mail.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={saving || loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Save size={18} />
            )}
            Salvar
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            <CheckCircle2 size={18} />
            {success}
          </div>
        )}

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <CalendarClock size={20} className="text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                Dias ativos
              </h2>
            </div>
            <button
              type="button"
              onClick={applyDefaultOffsets}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              Padrão
            </button>
          </div>

          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="animate-spin" size={18} />
                  Carregando agenda
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {QUICK_OFFSETS.map((offset) => {
                      const active = orderedOffsets.includes(offset);

                      return (
                        <button
                          key={offset}
                          type="button"
                          onClick={() => toggleOffset(offset)}
                          className={`min-h-20 rounded-md border px-4 py-3 text-left transition ${
                            active
                              ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span className="block text-sm font-semibold">
                            {formatOffset(offset)}
                          </span>
                          <span className="mt-2 block text-xs text-slate-500">
                            D
                            {offset === 0
                              ? ""
                              : offset > 0
                                ? `+${offset}`
                                : offset}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="number"
                      min={MIN_OFFSET}
                      max={MAX_OFFSET}
                      step={1}
                      value={customOffset}
                      onChange={(event) => setCustomOffset(event.target.value)}
                      className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:max-w-52"
                      placeholder="-2, 0, 7..."
                    />
                    <button
                      type="button"
                      onClick={addCustomOffset}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      <CirclePlus size={18} />
                      Adicionar
                    </button>
                  </div>
                </>
              )}
            </div>

            <aside className="rounded-md border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Sequencia
                </h2>
              </div>

              <div className="space-y-2 p-3">
                {orderedOffsets.map((offset) => (
                  <div
                    key={offset}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {formatOffset(offset)}
                      </p>
                      <p className="text-xs text-slate-500">
                        D
                        {offset === 0 ? "" : offset > 0 ? `+${offset}` : offset}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeOffset(offset)}
                      disabled={orderedOffsets.length === 1}
                      aria-label={`Remover ${formatOffset(offset)}`}
                      title="Remover"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
