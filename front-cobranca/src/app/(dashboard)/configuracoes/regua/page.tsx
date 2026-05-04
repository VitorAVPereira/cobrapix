"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Globe,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
  Users,
} from "lucide-react";
import type { CollectionRuleProfile, CollectionRuleStep } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Nao foi possivel concluir a acao.";
}

const PROFILE_TYPE_LABELS: Record<string, string> = {
  NEW: "Novo",
  GOOD: "Bom pagador",
  DOUBTFUL: "Duvidoso",
  BAD: "Mau pagador",
};

const PROFILE_TYPE_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  GOOD: "bg-emerald-100 text-emerald-700",
  DOUBTFUL: "bg-amber-100 text-amber-700",
  BAD: "bg-red-100 text-red-700",
};

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
};

const CHANNEL_ICONS: Record<string, typeof MessageCircle> = {
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
};

interface NewProfileForm {
  name: string;
  profileType: "NEW" | "GOOD" | "DOUBTFUL" | "BAD";
  isDefault: boolean;
}

interface StepForm {
  stepOrder: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId?: string;
  delayDays: number;
  sendTimeStart: string;
  sendTimeEnd: string;
}

const EMPTY_PROFILE: NewProfileForm = {
  name: "",
  profileType: "NEW",
  isDefault: false,
};

const EMPTY_STEP: StepForm = {
  stepOrder: 0,
  channel: "WHATSAPP",
  delayDays: 0,
  sendTimeStart: "",
  sendTimeEnd: "",
};

export default function ReguaPage() {
  const apiClient = useApiClient();
  const [profiles, setProfiles] = useState<CollectionRuleProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newProfile, setNewProfile] = useState<NewProfileForm>(EMPTY_PROFILE);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const [stepForms, setStepForms] = useState<StepForm[]>([]);
  const [hasStepChanges, setHasStepChanges] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient.getRules();
        if (active) {
          setProfiles(data);
          if (data.length > 0 && !selectedId) {
            setSelectedId(data[0].id);
          }
        }
      } catch (err) {
        if (active) setError(getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [apiClient]);

  useEffect(() => {
    if (selected) {
      setStepForms(
        selected.steps.map((s) => ({
          stepOrder: s.stepOrder,
          channel: s.channel as "EMAIL" | "WHATSAPP",
          templateId: s.templateId ?? undefined,
          delayDays: s.delayDays,
          sendTimeStart: s.sendTimeStart ?? "",
          sendTimeEnd: s.sendTimeEnd ?? "",
        })),
      );
      setHasStepChanges(false);
    } else {
      setStepForms([]);
    }
  }, [selected?.id, selected?.steps.length]);

  async function createProfile() {
    setSaving(true);
    setError(null);
    try {
      const created = await apiClient.createRule(newProfile);
      setProfiles((prev) => [...prev, created]);
      setSelectedId(created.id);
      setNewProfile(EMPTY_PROFILE);
      setShowNewProfile(false);
      setSuccess("Perfil criado.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteProfile(profileId: string) {
    if (!confirm("Remover este perfil? Devedores migrarao para o perfil padrao.")) return;
    setSaving(true);
    try {
      await apiClient.deleteRule(profileId);
      setProfiles((prev) => prev.filter((p) => p.id !== profileId));
      if (selectedId === profileId) setSelectedId(null);
      setSuccess("Perfil removido.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveSteps() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const steps = await apiClient.setRuleSteps(selectedId, stepForms);
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === selectedId ? { ...p, steps: steps as unknown as CollectionRuleStep[] } : p,
        ),
      );
      setHasStepChanges(false);
      setSuccess("Etapas salvas.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleClassify() {
    setSaving(true);
    try {
      await apiClient.classifyDebtors();
      setSuccess("Classificacao automatica concluida.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function updateStep(index: number, field: keyof StepForm, value: string | number) {
    setStepForms((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
    setHasStepChanges(true);
  }

  function addStep() {
    setStepForms((prev) => [
      ...prev,
      {
        ...EMPTY_STEP,
        stepOrder: prev.length,
        delayDays: prev.length > 0 ? (prev[prev.length - 1]?.delayDays ?? 0) + 3 : 0,
      },
    ]);
    setHasStepChanges(true);
  }

  function removeStep(index: number) {
    setStepForms((prev) =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i })),
    );
    setHasStepChanges(true);
  }

  function moveStep(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= stepForms.length) return;
    setStepForms((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((s, i) => ({ ...s, stepOrder: i }));
    });
    setHasStepChanges(true);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Regua de Cobranca</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure perfis e etapas de cobranca multicanal.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleClassify()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
          >
            <SlidersHorizontal size={16} />
            Classificar devedores
          </button>
          <button
            type="button"
            onClick={() => setShowNewProfile(true)}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            <Plus size={16} />
            Novo perfil
          </button>
        </div>
      </div>

      {(error || success) && (
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-sm font-medium ${
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error ?? success}
        </div>
      )}

      {showNewProfile && (
        <div className="mb-6 rounded-md border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Novo perfil</h3>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={newProfile.name}
              onChange={(e) => setNewProfile((p) => ({ ...p, name: e.target.value }))}
              placeholder="Nome do perfil"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={newProfile.profileType}
              onChange={(e) =>
                setNewProfile((p) => ({
                  ...p,
                  profileType: e.target.value as NewProfileForm["profileType"],
                }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {Object.entries(PROFILE_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newProfile.isDefault}
                onChange={(e) => setNewProfile((p) => ({ ...p, isDefault: e.target.checked }))}
              />
              Padrao
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => void createProfile()}
                disabled={saving || !newProfile.name}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Criar
              </button>
              <button
                onClick={() => setShowNewProfile(false)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <section className="rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Perfis</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => setSelectedId(profile.id)}
                className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${
                  selectedId === profile.id ? "bg-emerald-50 border-l-2 border-emerald-500" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">{profile.name}</span>
                  <div className="flex items-center gap-1">
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${PROFILE_TYPE_COLORS[profile.profileType] ?? "bg-slate-100 text-slate-600"}`}>
                      {PROFILE_TYPE_LABELS[profile.profileType] ?? profile.profileType}
                    </span>
                    {profile.isDefault && (
                      <CheckCircle2 size={14} className="text-emerald-500" />
                    )}
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    {profile.steps.length} etapa{profile.steps.length !== 1 ? "s" : ""}
                  </span>
                  {profile._count && (
                    <span className="flex items-center gap-1">
                      <Users size={11} />
                      {profile._count.debtors}
                    </span>
                  )}
                </div>
              </button>
            ))}
            {profiles.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                Nenhum perfil cadastrado.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Etapas — {selected.name}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    As etapas sao executadas em ordem. Cada etapa so dispara se a anterior ja foi concluida ou o delay ja passou.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!selected.isDefault && (
                    <button
                      onClick={() => void deleteProfile(selected.id)}
                      className="rounded-md border border-red-200 p-2 text-red-500 hover:bg-red-50"
                      title="Remover perfil"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  <button
                    onClick={addStep}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    + Etapa
                  </button>
                  <button
                    onClick={() => void saveSteps()}
                    disabled={saving || !hasStepChanges}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <Save size={13} />
                    Salvar
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {stepForms.length === 0 && (
                  <p className="px-5 py-12 text-center text-sm text-slate-400">
                    Nenhuma etapa configurada. Clique em "+ Etapa" para adicionar.
                  </p>
                )}
                {stepForms.map((step, index) => {
                  const ChannelIcon = CHANNEL_ICONS[step.channel] ?? Globe;
                  return (
                    <div key={index} className="flex items-start gap-3 px-5 py-3">
                      <div className="mt-2 flex flex-col items-center gap-0.5">
                        <button
                          onClick={() => moveStep(index, "up")}
                          disabled={index === 0}
                          className="rounded p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <span className="text-xs font-bold text-slate-500">{index + 1}</span>
                        <button
                          onClick={() => moveStep(index, "down")}
                          disabled={index === stepForms.length - 1}
                          className="rounded p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>

                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <select
                          value={step.channel}
                          onChange={(e) =>
                            updateStep(index, "channel", e.target.value)
                          }
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                        >
                          <option value="WHATSAPP">WhatsApp</option>
                          <option value="EMAIL">E-mail</option>
                        </select>

                        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                          <span className="text-xs text-slate-500">Delay:</span>
                          <input
                            type="number"
                            value={step.delayDays}
                            onChange={(e) =>
                              updateStep(index, "delayDays", parseInt(e.target.value) || 0)
                            }
                            className="w-14 border-0 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                            min={-30}
                            max={365}
                          />
                          <span className="text-xs text-slate-400">dias</span>
                        </div>

                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <span>Janela:</span>
                          <input
                            type="time"
                            value={step.sendTimeStart}
                            onChange={(e) => updateStep(index, "sendTimeStart", e.target.value)}
                            className="w-28 rounded border border-slate-200 px-1.5 py-1 text-xs"
                            placeholder="09:00"
                          />
                          <span>—</span>
                          <input
                            type="time"
                            value={step.sendTimeEnd}
                            onChange={(e) => updateStep(index, "sendTimeEnd", e.target.value)}
                            className="w-28 rounded border border-slate-200 px-1.5 py-1 text-xs"
                            placeholder="18:00"
                          />
                        </div>

                        <button
                          onClick={() => removeStep(index)}
                          className="ml-auto rounded p-1 text-slate-300 hover:text-red-500"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center">
              <p className="text-sm text-slate-400">
                Selecione um perfil para editar suas etapas.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
