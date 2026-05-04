"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Save,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  CollectionProfileType,
  CollectionRuleProfile,
  DebtorBillingSettings,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

const PROFILE_TYPE_LABELS: Record<CollectionProfileType, string> = {
  NEW: "Novo",
  GOOD: "Bom pagador",
  DOUBTFUL: "Duvidoso",
  BAD: "Mau pagador",
};

const PROFILE_TYPE_COLORS: Record<CollectionProfileType, string> = {
  NEW: "border-blue-200 bg-blue-50 text-blue-700",
  GOOD: "border-emerald-200 bg-emerald-50 text-emerald-700",
  DOUBTFUL: "border-amber-200 bg-amber-50 text-amber-700",
  BAD: "border-red-200 bg-red-50 text-red-700",
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Nao foi possivel salvar as configuracoes do devedor.";
}

function getProfileMeta(profile: CollectionRuleProfile): string {
  const stepCount = profile.steps.length;
  const stepLabel = stepCount === 1 ? "etapa" : "etapas";
  const defaultLabel = profile.isDefault ? "Padrao" : "Personalizado";

  return `${stepCount} ${stepLabel} - ${defaultLabel}`;
}

interface DebtorSettingsModalProps {
  debtorId: string;
  debtorName: string;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export function DebtorSettingsModal({
  debtorId,
  debtorName,
  onClose,
  onSaved,
}: DebtorSettingsModalProps) {
  const apiClient = useApiClient();
  const [settings, setSettings] = useState<DebtorBillingSettings | null>(null);
  const [profiles, setProfiles] = useState<CollectionRuleProfile[]>([]);
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const selectedProfileSummary = useMemo(() => {
    if (selectedProfile) {
      return `${selectedProfile.name} - ${
        PROFILE_TYPE_LABELS[selectedProfile.profileType]
      }`;
    }

    if (
      selectedProfileId &&
      settings?.collectionProfile?.id === selectedProfileId
    ) {
      return `${settings.collectionProfile.name} - ${
        PROFILE_TYPE_LABELS[settings.collectionProfile.profileType]
      }`;
    }

    return "Sem perfil definido";
  }, [selectedProfile, selectedProfileId, settings?.collectionProfile]);

  useEffect(() => {
    let active = true;

    async function loadSettings(): Promise<void> {
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const [settingsResponse, profilesResponse] = await Promise.all([
          apiClient.getDebtorBillingSettings(debtorId),
          apiClient.getRules(),
        ]);

        if (!active) return;

        setSettings(settingsResponse);
        setProfiles(profilesResponse);
        setWhatsappOptIn(settingsResponse.whatsappOptIn);
        setSelectedProfileId(settingsResponse.collectionProfile?.id ?? "");
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
  }, [apiClient, debtorId]);

  async function saveSettings(): Promise<void> {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const saved = await apiClient.updateDebtorBillingSettings(debtorId, {
        whatsappOptIn,
        collectionProfileId: selectedProfileId || null,
      });

      setSettings(saved);
      setWhatsappOptIn(saved.whatsappOptIn);
      setSelectedProfileId(saved.collectionProfile?.id ?? "");
      setSuccess("Configuracoes do devedor salvas.");

      if (onSaved) {
        void Promise.resolve(onSaved()).catch(() => undefined);
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Configurar devedor
            </h2>
            <p className="mt-1 text-sm text-slate-500">{debtorName}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-5">
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

          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={18} />
              Carregando configuracoes do devedor
            </div>
          ) : (
            <>
              <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={whatsappOptIn}
                    onChange={(event) => {
                      setWhatsappOptIn(event.target.checked);
                      setSuccess(null);
                    }}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <MessageCircle size={16} className="text-emerald-600" />
                      Opt-in WhatsApp oficial
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Autoriza templates de cobranca pela Meta Cloud API.
                    </p>
                  </div>
                </label>
              </section>

              <section className="rounded-md border border-slate-200 bg-white">
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                  <Settings2 size={18} className="text-emerald-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Perfil de cobranca
                  </h3>
                </div>

                <div className="space-y-3 p-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProfileId("");
                      setSuccess(null);
                    }}
                    className={`w-full rounded-md border px-4 py-3 text-left transition ${
                      selectedProfileId === ""
                        ? "border-slate-400 bg-slate-100"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-slate-900">
                      Sem perfil manual
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      O devedor fica sem uma regra de perfil selecionada.
                    </span>
                  </button>

                  {profiles.map((profile) => {
                    const isSelected = selectedProfileId === profile.id;

                    return (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => {
                          setSelectedProfileId(profile.id);
                          setSuccess(null);
                        }}
                        className={`w-full rounded-md border px-4 py-3 text-left transition ${
                          isSelected
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {profile.name}
                          </span>
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                              PROFILE_TYPE_COLORS[profile.profileType]
                            }`}
                          >
                            {PROFILE_TYPE_LABELS[profile.profileType]}
                          </span>
                          {isSelected && (
                            <ShieldCheck
                              size={16}
                              className="text-emerald-600"
                            />
                          )}
                        </span>
                        <span className="mt-2 block text-xs text-slate-500">
                          {getProfileMeta(profile)}
                        </span>
                      </button>
                    );
                  })}

                  {profiles.length === 0 && (
                    <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
                      Nenhum perfil cadastrado na regua de cobranca.
                    </p>
                  )}
                </div>
              </section>

              <aside className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Perfil atual
                </h3>
                <p className="mt-3 text-sm text-slate-600">
                  {selectedProfileSummary}
                </p>
              </aside>
            </>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={loading || saving}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Save size={18} />
            )}
            Salvar configuracoes
          </button>
        </div>
      </div>
    </div>
  );
}
