"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Frown,
  Info,
  Loader2,
  Meh,
  Plus,
  Save,
  SlidersHorizontal,
  Smile,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  CollectionProfileType,
  CollectionRuleProfile,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import type { CompanyCollectionTemplates } from "@/components/features/templates/types";
import { TemplateRequestDialog } from "@/components/features/templates/TemplateRequestDialog";
import { RuleDayCard } from "@/components/features/regua/RuleDayCard";
import { RuleTimeline } from "@/components/features/regua/RuleTimeline";
import { DayMessageDialog } from "@/components/features/regua/DayMessageDialog";
import {
  DAY_SHORTCUTS,
  MAX_DAY,
  MIN_DAY,
  dayLabel,
  dayMoment,
  newDayKey,
  scheduleProblem,
  shortcutLabel,
  toRuleDays,
  toStepInputs,
  type Channel,
  type RuleDay,
} from "@/components/features/regua/rule-days";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Não foi possível concluir a ação.";
}

interface ProfileViewMeta {
  label: string;
  description: string;
  icon: LucideIcon;
}

const PROFILE_VIEW_META: Record<CollectionProfileType, ProfileViewMeta> = {
  NEW: {
    label: "Novo Cliente",
    description:
      "Lembretes de boas-vindas e um acompanhamento firme, sem exagero, enquanto você conhece o cliente.",
    icon: UserPlus,
  },
  GOOD: {
    label: "Bom Pagador",
    description:
      "Lembretes pontuais que respeitam o histórico de quem costuma pagar em dia.",
    icon: Smile,
  },
  DOUBTFUL: {
    label: "Pagador Duvidoso",
    description:
      "O acompanhamento mais próximo: mais lembretes antes do vencimento e contatos regulares depois.",
    icon: Meh,
  },
  BAD: {
    label: "Mau Pagador",
    description:
      "Lembretes antes do vencimento e poucos contatos depois: insistir demais não recupera o pagamento.",
    icon: Frown,
  },
};

const PROFILE_TYPE_ORDER: Record<CollectionProfileType, number> = {
  NEW: 0,
  GOOD: 1,
  DOUBTFUL: 2,
  BAD: 3,
};

interface NewProfileForm {
  name: string;
  profileType: CollectionProfileType;
  isDefault: boolean;
}

const EMPTY_PROFILE: NewProfileForm = {
  name: "",
  profileType: "NEW",
  isDefault: false,
};

function sortProfiles(
  profiles: CollectionRuleProfile[],
): CollectionRuleProfile[] {
  return [...profiles].sort((a, b) => {
    const order =
      PROFILE_TYPE_ORDER[a.profileType] - PROFILE_TYPE_ORDER[b.profileType];
    if (order !== 0) return order;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

function getInitialProfileId(profiles: CollectionRuleProfile[]): string | null {
  return (
    profiles.find((profile) => profile.profileType === "NEW")?.id ??
    sortProfiles(profiles)[0]?.id ??
    null
  );
}

function getProfileLabel(profile: CollectionRuleProfile): string {
  return profile.name || PROFILE_VIEW_META[profile.profileType].label;
}

/** Contacts of a profile, counted the way the company reads them (one per day). */
function contactCount(profile: CollectionRuleProfile): number {
  return toRuleDays(profile.steps).length;
}

const RULES = [
  "A mensagem de cada contato é escolhida sozinha, pelo momento da cobrança e pela forma de pagamento.",
  "A mensagem de emissão é enviada quando você pede no cadastro da cobrança.",
  "Entre duas mensagens da mesma cobrança passa pelo menos um dia.",
  "Se um contato atrasou e o próximo já chegou, só o mais recente é enviado.",
];

export default function ReguaPage(): ReactElement {
  const apiClient = useApiClient();
  const [profiles, setProfiles] = useState<CollectionRuleProfile[]>([]);
  const [templates, setTemplates] = useState<CompanyCollectionTemplates | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newProfile, setNewProfile] = useState<NewProfileForm>(EMPTY_PROFILE);
  const [days, setDays] = useState<RuleDay[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [customDay, setCustomDay] = useState("");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);

  const sortedProfiles = useMemo(() => sortProfiles(profiles), [profiles]);
  const selected =
    profiles.find((profile) => profile.id === selectedId) ?? null;
  const selectedMeta = selected
    ? PROFILE_VIEW_META[selected.profileType]
    : PROFILE_VIEW_META.NEW;
  const previewRow = days.find((row) => row.key === previewKey) ?? null;
  const requestRow = days.find((row) => row.key === requestKey) ?? null;

  function markChanged(): void {
    setError(null);
    setSuccess(null);
    setHasChanges(true);
  }

  useEffect(() => {
    if (!hasChanges) return;

    function warnBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = "";
    }

    function guardLinkNavigation(event: MouseEvent): void {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === "_blank" ||
        link.getAttribute("href")?.startsWith("#")
      )
        return;
      if (
        window.confirm(
          "Você tem alterações não salvas. Descartá-las e sair desta página?",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", guardLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", guardLinkNavigation, true);
    };
  }, [hasChanges]);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.getRules(),
      // The messages only illustrate; a failure there never blocks editing the rule.
      apiClient.getCollectionTemplates().catch(() => null),
    ])
      .then(([data, collection]) => {
        if (!active) return;
        // The first attempt can run before the session token arrives; a later success clears it.
        setError(null);
        setProfiles(data);
        setTemplates(collection);
        setSelectedId((current) =>
          current && data.some((profile) => profile.id === current)
            ? current
            : getInitialProfileId(data),
        );
      })
      .catch((err: unknown) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiClient]);

  useEffect(() => {
    setDays(selected ? toRuleDays(selected.steps) : []);
    setHasChanges(false);
  }, [selected]);

  function selectProfile(profileId: string): void {
    if (profileId === selectedId) return;
    if (
      hasChanges &&
      !window.confirm(
        "Você tem alterações não salvas. Descartar e trocar de perfil?",
      )
    )
      return;
    setSelectedId(profileId);
    setError(null);
    setSuccess(null);
  }

  async function createProfile(): Promise<void> {
    if (
      hasChanges &&
      !window.confirm(
        "Você tem alterações não salvas. Descartá-las e criar outro perfil?",
      )
    )
      return;
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

  async function deleteProfile(profileId: string): Promise<void> {
    if (
      !window.confirm(
        "Remover este perfil? Os clientes dele passam para o perfil padrão.",
      )
    )
      return;
    setSaving(true);
    try {
      await apiClient.deleteRule(profileId);
      setProfiles((prev) => prev.filter((profile) => profile.id !== profileId));
      if (selectedId === profileId) setSelectedId(null);
      setSuccess("Perfil removido.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleClassify(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await apiClient.classifyDebtors();
      setSuccess("Classificação automática concluída.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveDays(): Promise<void> {
    if (!selectedId) return;
    const problem = scheduleProblem(days);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const steps = await apiClient.setRuleSteps(selectedId, toStepInputs(days));
      setProfiles((prev) =>
        prev.map((profile) =>
          profile.id === selectedId ? { ...profile, steps } : profile,
        ),
      );
      setHasChanges(false);
      setSuccess("Régua salva.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function addDay(day: number): void {
    if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY) {
      setError(
        `Escolha um dia entre ${-MIN_DAY} dias antes e ${MAX_DAY} dias após o vencimento.`,
      );
      return;
    }
    if (days.some((row) => row.day === day)) {
      setError(`Já existe um contato em “${dayLabel(day)}”.`);
      return;
    }
    setDays((prev) =>
      [
        ...prev,
        {
          key: newDayKey(),
          day,
          channels: {
            WHATSAPP: { attempted: false, customTemplates: [] },
          },
          sendTimeStart: "",
          sendTimeEnd: "",
        },
      ].sort((a, b) => a.day - b.day),
    );
    setCustomDay("");
    markChanged();
  }

  function changeDay(key: string, day: number): void {
    if (day < MIN_DAY || day > MAX_DAY) {
      setError(
        `Escolha um dia entre ${-MIN_DAY} dias antes e ${MAX_DAY} dias após o vencimento.`,
      );
      return;
    }
    if (days.some((row) => row.key !== key && row.day === day)) {
      setError(`Já existe um contato em “${dayLabel(day)}”.`);
      return;
    }
    setDays((prev) =>
      prev
        .map((row) => (row.key === key ? { ...row, day } : row))
        .sort((a, b) => a.day - b.day),
    );
    markChanged();
  }

  function toggleChannel(key: string, channel: Channel, enabled: boolean): void {
    const row = days.find((item) => item.key === key);
    const step = row?.channels[channel];
    if (
      !enabled &&
      step?.attempted &&
      !window.confirm(
        "Este canal já foi enviado nesta etapa. Ele será desativado e mantido no histórico. Continuar?",
      )
    )
      return;
    setDays((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const channels = { ...item.channels };
        if (enabled)
          channels[channel] = channels[channel] ?? {
            attempted: false,
            customTemplates: [],
          };
        else delete channels[channel];
        return { ...item, channels };
      }),
    );
    markChanged();
  }

  function updateTime(
    key: string,
    field: "sendTimeStart" | "sendTimeEnd",
    value: string,
  ): void {
    setDays((prev) =>
      prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
    markChanged();
  }

  function removeDay(key: string): void {
    const row = days.find((item) => item.key === key);
    if (!row) return;
    const steps = Object.values(row.channels);
    const sent = steps.some((step) => step?.attempted);
    const custom = steps.some((step) => (step?.customTemplates.length ?? 0) > 0);
    const notice = [
      sent
        ? "Este contato já foi enviado: ele será desativado e mantido no histórico."
        : null,
      custom ? "A mensagem personalizada pelo suporte deixará de ser usada." : null,
    ].filter(Boolean);
    if (notice.length && !window.confirm(`${notice.join(" ")} Continuar?`))
      return;
    setDays((prev) => prev.filter((item) => item.key !== key));
    markChanged();
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-4 pb-12 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              Configurações
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              Régua de Cobrança
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Escolha quando cada cliente recebe um lembrete e por qual canal. A
              mensagem certa é escolhida automaticamente.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleClassify()}
              disabled={saving}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              <SlidersHorizontal size={16} />
              Classificar clientes
            </button>
            <button
              type="button"
              onClick={() => setShowNewProfile(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <Plus size={16} />
              Novo perfil
            </button>
          </div>
        </div>

        {(error || success) && (
          <div
            role={error ? "alert" : "status"}
            className={`rounded-xl border px-4 py-3 text-sm font-medium ${
              error
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {error ?? success}
          </div>
        )}

        {showNewProfile && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-bold text-slate-950">
              Criar perfil de cobrança
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Perfis permitem sequências diferentes para cada grupo de clientes.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-bold text-slate-700">
                Nome do perfil
                <input
                  type="text"
                  value={newProfile.name}
                  onChange={(event) =>
                    setNewProfile((profile) => ({
                      ...profile,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Ex.: Clientes novos"
                  className="h-11 rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-bold text-slate-700">
                Tipo de cliente
                <select
                  value={newProfile.profileType}
                  onChange={(event) =>
                    setNewProfile((profile) => ({
                      ...profile,
                      profileType: event.target.value as CollectionProfileType,
                    }))
                  }
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900"
                >
                  {Object.entries(PROFILE_VIEW_META).map(([type, meta]) => (
                    <option key={type} value={type}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={newProfile.isDefault}
                onChange={(event) =>
                  setNewProfile((profile) => ({
                    ...profile,
                    isDefault: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300"
              />
              Usar como perfil padrão
            </label>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void createProfile()}
                disabled={saving || !newProfile.name.trim()}
                className="min-h-10 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Criar perfil
              </button>
              <button
                type="button"
                onClick={() => setShowNewProfile(false)}
                className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:sticky xl:top-6">
            <div className="px-2 pb-3 pt-2">
              <h2 className="text-sm font-bold text-slate-950">
                Perfis de cobrança
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Cada cliente segue a régua do seu perfil.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {sortedProfiles.map((profile) => {
                const isSelected = selectedId === profile.id;
                const Icon = PROFILE_VIEW_META[profile.profileType].icon;
                const count = contactCount(profile);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => selectProfile(profile.id)}
                    aria-current={isSelected ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                      isSelected
                        ? "border-emerald-300 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200"
                        : "border-transparent bg-white text-slate-900 hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isSelected
                          ? "bg-emerald-600 text-white"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {getProfileLabel(profile)}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        {count} contato{count !== 1 ? "s" : ""}
                        {profile._count && (
                          <>
                            <span aria-hidden="true">·</span>
                            <Users size={12} />
                            {profile._count.debtors} cliente
                            {profile._count.debtors !== 1 ? "s" : ""}
                          </>
                        )}
                      </span>
                    </span>
                    {profile.isDefault && (
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        Padrão
                      </span>
                    )}
                  </button>
                );
              })}
              {sortedProfiles.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-slate-500">
                  Nenhum perfil cadastrado. Crie um perfil para começar.
                </p>
              )}
            </div>
          </aside>

          <main className="min-w-0 space-y-4">
            {selected ? (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-950">
                        {getProfileLabel(selected)}
                      </h2>
                      <p className="mt-1 max-w-2xl text-sm text-slate-600">
                        {selectedMeta.description}
                      </p>
                    </div>
                    {!selected.isDefault && (
                      <button
                        type="button"
                        onClick={() => void deleteProfile(selected.id)}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        <Trash2 size={15} />
                        Remover perfil
                      </button>
                    )}
                  </div>
                  <div className="mt-4">
                    <RuleTimeline days={days} />
                  </div>
                  <ul className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 sm:grid-cols-2">
                    {RULES.map((rule) => (
                      <li key={rule} className="flex gap-2">
                        <Info size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
                        {rule}
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-label="Contatos da régua" className="space-y-3">
                  {days.length === 0 && (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                      Nenhum contato neste perfil. Adicione o primeiro abaixo.
                    </p>
                  )}
                  {days.map((row) => {
                    const whatsapp = row.channels.WHATSAPP;
                    return (
                      <RuleDayCard
                        key={row.key}
                        row={row}
                        disabled={saving}
                        onDayChange={(day) => changeDay(row.key, day)}
                        onToggleChannel={(channel, enabled) =>
                          toggleChannel(row.key, channel, enabled)
                        }
                        onTimeChange={(field, value) =>
                          updateTime(row.key, field, value)
                        }
                        onRemove={() => removeDay(row.key)}
                        onPreview={() => setPreviewKey(row.key)}
                        onRequest={
                          whatsapp?.id && !hasChanges
                            ? () => setRequestKey(row.key)
                            : undefined
                        }
                      />
                    );
                  })}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Adicionar contato
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DAY_SHORTCUTS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        disabled={saving || days.some((row) => row.day === day)}
                        onClick={() => addDay(day)}
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        {shortcutLabel(day)}
                      </button>
                    ))}
                  </div>
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      addDay(Number(customDay));
                    }}
                  >
                    <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                      Outro dia (negativo antes do vencimento)
                      <input
                        type="number"
                        min={MIN_DAY}
                        max={MAX_DAY}
                        step={1}
                        value={customDay}
                        onChange={(event) => setCustomDay(event.target.value)}
                        className="h-10 w-48 rounded-md border border-slate-300 px-3 text-sm font-normal"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={saving || customDay.trim() === ""}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                    >
                      <Plus size={15} /> Adicionar
                    </button>
                  </form>
                  {customDay.trim() !== "" &&
                    Number.isInteger(Number(customDay)) && (
                      <p className="mt-2 text-xs text-slate-500">
                        {dayLabel(Number(customDay))} · Mensagem:{" "}
                        {dayMoment(Number(customDay)).label}
                      </p>
                    )}
                </section>

                <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
                  <p className="text-sm" aria-live="polite">
                    {hasChanges ? (
                      <span className="font-medium text-amber-700">
                        Alterações não salvas
                      </span>
                    ) : (
                      <span className="text-slate-500">Régua salva</span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveDays()}
                    disabled={saving || !hasChanges}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      <Save size={16} />
                    )}
                    Salvar alterações
                  </button>
                </div>
              </>
            ) : (
              <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Selecione ou crie um perfil para configurar a régua.
              </p>
            )}
          </main>
        </div>
      </div>

      <DayMessageDialog
        row={previewRow}
        templates={templates}
        onClose={() => setPreviewKey(null)}
      />
      <TemplateRequestDialog
        open={Boolean(requestRow)}
        onClose={() => setRequestKey(null)}
        purpose={requestRow ? dayMoment(requestRow.day).purpose : null}
        ruleStepId={requestRow?.channels.WHATSAPP?.id}
        stepLabel={
          requestRow && selected
            ? `${getProfileLabel(selected)} · ${dayLabel(requestRow.day)}`
            : undefined
        }
      />
    </div>
  );
}
