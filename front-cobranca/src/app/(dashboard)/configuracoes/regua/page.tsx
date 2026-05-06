"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Frown,
  Loader2,
  Mail,
  Meh,
  MessageCircle,
  Plus,
  Save,
  SlidersHorizontal,
  Smile,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  CollectionProfileType,
  CollectionRuleProfile,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Nao foi possivel concluir a acao.";
}

interface ProfileViewMeta {
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

const PROFILE_VIEW_META: Record<CollectionProfileType, ProfileViewMeta> = {
  NEW: {
    label: "Novo Cliente",
    title: "Regua de Cobranca para Novos Clientes",
    description:
      "Desenvolva um relacionamento positivo desde o inicio com estrategias suaves que incentivam o pagamento sem pressionar.",
    icon: UserPlus,
  },
  GOOD: {
    label: "Bom Pagador",
    title: "Regua de Cobranca para Bons Pagadores",
    description:
      "Mantenha a confianca e a lealdade com uma cadencia amigavel que respeita o historico de pontualidade.",
    icon: Smile,
  },
  DOUBTFUL: {
    label: "Pagador Duvidoso",
    title: "Regua de Cobranca para Pagador Duvidoso",
    description:
      "Use abordagens mais frequentes para reduzir riscos de inadimplencia sem perder clareza no contato.",
    icon: Meh,
  },
  BAD: {
    label: "Mau Pagador",
    title: "Regua de Cobranca para Mau Pagador",
    description:
      "Aplique uma cobranca mais estruturada para recuperar debitos com comunicacao direta e rastreavel.",
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

interface StepForm {
  stepOrder: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId?: string;
  delayDays: number;
  sendTimeStart: string;
  sendTimeEnd: string;
}

interface TimelineStep {
  index: number;
  channel: StepForm["channel"];
}

interface TimelinePoint {
  day: number;
  steps: TimelineStep[];
  tone: TimelineTone;
  caption: string;
}

type TimelineTone = "emission" | "before" | "due" | "after" | "critical";
type StepChannel = StepForm["channel"];

interface ScheduledStepForm {
  channel: StepChannel;
  templateId?: string;
  sendTimeStart: string;
  sendTimeEnd: string;
  scheduleDay: number;
}

interface EditableStepEntry {
  index: number;
  scheduleDay: number;
  step: StepForm;
}

const EMISSION_DAY = -30;
const CHANNEL_ORDER: Record<StepChannel, number> = {
  EMAIL: 0,
  WHATSAPP: 1,
};

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

const TONE_CLASSES: Record<
  TimelineTone,
  { node: string; icon: string; label: string }
> = {
  emission: {
    node: "bg-slate-500 text-white",
    icon: "text-slate-500",
    label: "text-slate-700",
  },
  before: {
    node: "bg-slate-700 text-white",
    icon: "text-slate-600",
    label: "text-slate-700",
  },
  due: {
    node: "bg-emerald-600 text-white",
    icon: "text-emerald-700",
    label: "text-emerald-950",
  },
  after: {
    node: "bg-amber-500 text-white",
    icon: "text-amber-600",
    label: "text-amber-700",
  },
  critical: {
    node: "bg-red-700 text-white",
    icon: "text-red-700",
    label: "text-red-950",
  },
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

function buildTimelinePoints(
  steps: StepForm[],
  profileType: CollectionProfileType,
): TimelinePoint[] {
  let cumulativeDay = 0;
  const points: TimelinePoint[] = [];

  steps.forEach((step, index) => {
    cumulativeDay += step.delayDays;
    const previous = points[points.length - 1];

    if (previous && previous.day === cumulativeDay) {
      previous.steps.push({ index, channel: step.channel });
      return;
    }

    points.push({
      day: cumulativeDay,
      steps: [{ index, channel: step.channel }],
      tone: getTimelineTone(cumulativeDay, profileType),
      caption: getTimelineCaption(cumulativeDay, profileType),
    });
  });

  return points;
}

function getTimelineTone(
  day: number,
  profileType: CollectionProfileType,
): TimelineTone {
  if (day <= EMISSION_DAY) return "emission";
  if (profileType === "BAD" && day >= 30) return "critical";
  if (day < 0) return "before";
  if (day === 0) return "due";
  return "after";
}

function getTimelineCaption(
  day: number,
  profileType: CollectionProfileType,
): string {
  if (day <= EMISSION_DAY) return "Ao cadastrar";
  if (day < 0) return "Antes do vencimento";
  if (day === 0) return "No dia do vencimento";
  if (profileType === "BAD" && day === 30) return "Negativacao";
  if (profileType === "BAD" && day >= 40) return "Protesto";
  if ([2, 15, 30].includes(day)) return "Depois do vencimento";
  return "";
}

function formatDayBadge(day: number): string {
  if (day <= EMISSION_DAY) return "Emissão";
  return day.toString();
}

function getProfileLabel(profile: CollectionRuleProfile): string {
  return profile.name || PROFILE_VIEW_META[profile.profileType].label;
}

function getStepScheduleDays(steps: StepForm[]): number[] {
  let scheduleDay = 0;

  return steps.map((step) => {
    scheduleDay += step.delayDays;
    return scheduleDay;
  });
}

function getScheduledStepForms(steps: StepForm[]): ScheduledStepForm[] {
  const scheduleDays = getStepScheduleDays(steps);

  return steps.map((step, index) => ({
    channel: step.channel,
    templateId: step.templateId,
    sendTimeStart: step.sendTimeStart,
    sendTimeEnd: step.sendTimeEnd,
    scheduleDay: scheduleDays[index] ?? 0,
  }));
}

function buildStepFormsFromScheduledSteps(
  scheduledSteps: ScheduledStepForm[],
): StepForm[] {
  let previousDay = 0;

  return [...scheduledSteps]
    .sort((a, b) => {
      const dayOrder = a.scheduleDay - b.scheduleDay;
      if (dayOrder !== 0) return dayOrder;
      return CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel];
    })
    .map((step, index) => {
      const delayDays =
        index === 0 ? step.scheduleDay : step.scheduleDay - previousDay;
      previousDay = step.scheduleDay;

      return {
        stepOrder: index,
        channel: step.channel,
        templateId: step.templateId,
        delayDays,
        sendTimeStart: step.sendTimeStart,
        sendTimeEnd: step.sendTimeEnd,
      };
    });
}

function createEmissionStep(channel: StepChannel): ScheduledStepForm {
  return {
    channel,
    scheduleDay: EMISSION_DAY,
    sendTimeStart: "",
    sendTimeEnd: "",
  };
}

function getEmissionChannels(steps: StepForm[]): Record<StepChannel, boolean> {
  const channels: Record<StepChannel, boolean> = {
    EMAIL: false,
    WHATSAPP: false,
  };

  getScheduledStepForms(steps).forEach((step) => {
    if (step.scheduleDay === EMISSION_DAY) {
      channels[step.channel] = true;
    }
  });

  return channels;
}

function getStepDayLimits(
  scheduleDays: number[],
  index: number,
): { min: number; max: number } {
  return {
    min: index === 0 ? EMISSION_DAY : (scheduleDays[index - 1] ?? EMISSION_DAY),
    max:
      index === scheduleDays.length - 1
        ? 365
        : (scheduleDays[index + 1] ?? 365),
  };
}

function clampDay(day: number, min: number, max: number): number {
  return Math.min(Math.max(day, min), max);
}

function parseIntegerInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatScheduleDay(day: number): string {
  const absoluteDay = Math.abs(day);
  const dayLabel = absoluteDay === 1 ? "dia" : "dias";

  if (day < 0) {
    return `${absoluteDay} ${dayLabel} antes do vencimento`;
  }

  if (day === 0) {
    return "No dia do vencimento";
  }

  return `${day} ${dayLabel} apos o vencimento`;
}

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

  const sortedProfiles = useMemo(() => sortProfiles(profiles), [profiles]);
  const selected =
    profiles.find((profile) => profile.id === selectedId) ?? null;
  const selectedMeta = selected
    ? PROFILE_VIEW_META[selected.profileType]
    : PROFILE_VIEW_META.NEW;

  const [stepForms, setStepForms] = useState<StepForm[]>([]);
  const [hasStepChanges, setHasStepChanges] = useState(false);
  const timelinePoints = useMemo(
    () => buildTimelinePoints(stepForms, selected?.profileType ?? "NEW"),
    [selected?.profileType, stepForms],
  );
  const scheduleDays = useMemo(
    () => getStepScheduleDays(stepForms),
    [stepForms],
  );
  const editableStepEntries = useMemo<EditableStepEntry[]>(
    () =>
      stepForms.flatMap((step, index) => {
        const scheduleDay = scheduleDays[index];

        if (scheduleDay === undefined || scheduleDay === EMISSION_DAY) {
          return [];
        }

        return [{ index, scheduleDay, step }];
      }),
    [scheduleDays, stepForms],
  );
  const emissionChannels = useMemo(
    () => getEmissionChannels(stepForms),
    [stepForms],
  );
  const emissionEnabled = emissionChannels.EMAIL || emissionChannels.WHATSAPP;
  const timelineMinWidth = Math.max(820, timelinePoints.length * 86);

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const data = await apiClient.getRules();
        if (!active) return;

        setProfiles(data);
        setSelectedId((current) => {
          if (current && data.some((profile) => profile.id === current)) {
            return current;
          }

          return getInitialProfileId(data);
        });
      } catch (err) {
        if (active) setError(getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [apiClient]);

  useEffect(() => {
    if (selected) {
      setStepForms(
        selected.steps.map((step) => ({
          stepOrder: step.stepOrder,
          channel: step.channel,
          templateId: step.templateId ?? undefined,
          delayDays: step.delayDays,
          sendTimeStart: step.sendTimeStart ?? "",
          sendTimeEnd: step.sendTimeEnd ?? "",
        })),
      );
      setHasStepChanges(false);
    } else {
      setStepForms([]);
      setHasStepChanges(false);
    }
  }, [selected]);

  async function createProfile(): Promise<void> {
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
      !confirm("Remover este perfil? Devedores migrarao para o perfil padrao.")
    ) {
      return;
    }

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

  async function saveSteps(): Promise<void> {
    if (!selectedId) return;

    setSaving(true);
    setError(null);

    try {
      const steps = await apiClient.setRuleSteps(selectedId, stepForms);
      setProfiles((prev) =>
        prev.map((profile) =>
          profile.id === selectedId ? { ...profile, steps } : profile,
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

  async function handleClassify(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      await apiClient.classifyDebtors();
      setSuccess("Classificacao automatica concluida.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function updateStep(
    index: number,
    field: keyof StepForm,
    value: string | number,
  ): void {
    setStepForms((prev) =>
      prev.map((step, stepIndex) =>
        stepIndex === index ? { ...step, [field]: value } : step,
      ),
    );
    setHasStepChanges(true);
  }

  function updateStepScheduleDay(index: number, value: number): void {
    setStepForms((prev) => {
      const next = [...prev];
      const currentStep = next[index];

      if (!currentStep) {
        return prev;
      }

      const currentScheduleDays = getStepScheduleDays(prev);
      const { min, max } = getStepDayLimits(currentScheduleDays, index);
      const currentScheduleDay = currentScheduleDays[index] ?? 0;
      const safeMin =
        currentScheduleDay === EMISSION_DAY
          ? min
          : Math.max(min, EMISSION_DAY + 1);
      const scheduleDay = clampDay(value, safeMin, max);
      const previousScheduleDay =
        index === 0 ? 0 : (currentScheduleDays[index - 1] ?? 0);
      const nextScheduleDay = currentScheduleDays[index + 1];

      next[index] = {
        ...currentStep,
        delayDays: scheduleDay - previousScheduleDay,
      };

      const followingStep = next[index + 1];

      if (followingStep && nextScheduleDay !== undefined) {
        next[index + 1] = {
          ...followingStep,
          delayDays: nextScheduleDay - scheduleDay,
        };
      }

      return next;
    });
    setHasStepChanges(true);
  }

  function updateEmissionEnabled(enabled: boolean): void {
    setStepForms((prev) => {
      const scheduledSteps = getScheduledStepForms(prev);
      const emissionSteps = scheduledSteps.filter(
        (step) => step.scheduleDay === EMISSION_DAY,
      );
      const otherSteps = scheduledSteps.filter(
        (step) => step.scheduleDay !== EMISSION_DAY,
      );

      if (!enabled) {
        return buildStepFormsFromScheduledSteps(otherSteps);
      }

      if (emissionSteps.length > 0) {
        return buildStepFormsFromScheduledSteps([
          ...emissionSteps,
          ...otherSteps,
        ]);
      }

      return buildStepFormsFromScheduledSteps([
        createEmissionStep("EMAIL"),
        ...otherSteps,
      ]);
    });
    setHasStepChanges(true);
  }

  function updateEmissionChannel(channel: StepChannel, enabled: boolean): void {
    setStepForms((prev) => {
      const scheduledSteps = getScheduledStepForms(prev);
      const emissionSteps = scheduledSteps.filter(
        (step) => step.scheduleDay === EMISSION_DAY,
      );
      const otherSteps = scheduledSteps.filter(
        (step) => step.scheduleDay !== EMISSION_DAY,
      );
      const nextChannels = new Set<StepChannel>(
        emissionSteps.map((step) => step.channel),
      );

      if (enabled) {
        nextChannels.add(channel);
      } else {
        nextChannels.delete(channel);
      }

      if (nextChannels.size === 0) {
        return buildStepFormsFromScheduledSteps(otherSteps);
      }

      const emissionStepByChannel = new Map<StepChannel, ScheduledStepForm>(
        emissionSteps.map((step) => [step.channel, step]),
      );
      const nextEmissionSteps = Array.from(nextChannels).map(
        (nextChannel) =>
          emissionStepByChannel.get(nextChannel) ??
          createEmissionStep(nextChannel),
      );

      return buildStepFormsFromScheduledSteps([
        ...nextEmissionSteps,
        ...otherSteps,
      ]);
    });
    setHasStepChanges(true);
  }

  function addStep(): void {
    setStepForms((prev) => {
      const scheduledSteps = getScheduledStepForms(prev);
      const lastScheduleDay = scheduledSteps.reduce(
        (maxDay, step) => Math.max(maxDay, step.scheduleDay),
        Number.NEGATIVE_INFINITY,
      );
      const scheduleDay =
        lastScheduleDay === Number.NEGATIVE_INFINITY ||
        lastScheduleDay <= EMISSION_DAY
          ? 0
          : lastScheduleDay + 3;

      return buildStepFormsFromScheduledSteps([
        ...scheduledSteps,
        {
          channel: EMPTY_STEP.channel,
          scheduleDay,
          sendTimeStart: EMPTY_STEP.sendTimeStart,
          sendTimeEnd: EMPTY_STEP.sendTimeEnd,
        },
      ]);
    });
    setHasStepChanges(true);
  }

  function removeStep(index: number): void {
    setStepForms((prev) =>
      buildStepFormsFromScheduledSteps(
        getScheduledStepForms(prev).filter(
          (_, stepIndex) => stepIndex !== index,
        ),
      ),
    );
    setHasStepChanges(true);
  }

  function moveStep(index: number, direction: "up" | "down"): void {
    const editableIndexes = scheduleDays.flatMap((scheduleDay, stepIndex) =>
      scheduleDay === EMISSION_DAY ? [] : [stepIndex],
    );
    const position = editableIndexes.indexOf(index);
    const target =
      direction === "up"
        ? editableIndexes[position - 1]
        : editableIndexes[position + 1];

    if (position < 0 || target === undefined) return;

    setStepForms((prev) => {
      const next = getScheduledStepForms(prev);
      const currentStep = next[index];
      const targetStep = next[target];

      if (!currentStep || !targetStep) {
        return prev;
      }

      next[index] = {
        ...currentStep,
        scheduleDay: targetStep.scheduleDay,
      };
      next[target] = {
        ...targetStep,
        scheduleDay: currentStep.scheduleDay,
      };

      return buildStepFormsFromScheduledSteps(next);
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
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              Regua de Cobranca
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Configure perfis e etapas de cobranca multicanal.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleClassify()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
            >
              <SlidersHorizontal size={16} />
              Classificar devedores
            </button>
            <button
              type="button"
              onClick={() => setShowNewProfile(true)}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
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
          <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-950">
              Novo perfil
            </h2>
            <div className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_220px_auto_auto]">
              <input
                type="text"
                value={newProfile.name}
                onChange={(event) =>
                  setNewProfile((profile) => ({
                    ...profile,
                    name: event.target.value,
                  }))
                }
                placeholder="Nome do perfil"
                className="h-10 rounded-md border border-slate-300 px-3 text-sm"
              />
              <select
                value={newProfile.profileType}
                onChange={(event) =>
                  setNewProfile((profile) => ({
                    ...profile,
                    profileType: event.target.value as CollectionProfileType,
                  }))
                }
                className="h-10 rounded-md border border-slate-300 px-3 text-sm"
              >
                {Object.entries(PROFILE_VIEW_META).map(([type, meta]) => (
                  <option key={type} value={type}>
                    {meta.label}
                  </option>
                ))}
              </select>
              <label className="flex h-10 items-center gap-2 text-sm text-slate-600">
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
                Padrao
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void createProfile()}
                  disabled={saving || !newProfile.name.trim()}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  Criar
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewProfile(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[290px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
            <div className="divide-y divide-slate-100">
              {sortedProfiles.map((profile) => {
                const isSelected = selectedId === profile.id;
                const meta = PROFILE_VIEW_META[profile.profileType];
                const Icon = meta.icon;

                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setSelectedId(profile.id)}
                    className={`flex w-full items-center gap-4 px-5 py-4 text-left transition ${
                      isSelected
                        ? "bg-emerald-600 text-white"
                        : "bg-white text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {getProfileLabel(profile)}
                      </span>
                      <span
                        className={`mt-1 flex items-center gap-2 text-xs ${
                          isSelected ? "text-emerald-50" : "text-slate-400"
                        }`}
                      >
                        {profile.steps.length} etapa
                        {profile.steps.length !== 1 ? "s" : ""}
                        {profile._count && (
                          <>
                            <Users size={12} />
                            {profile._count.debtors}
                          </>
                        )}
                      </span>
                    </span>
                    {profile.isDefault && (
                      <CheckCircle2
                        size={16}
                        className={
                          isSelected ? "text-white" : "text-emerald-500"
                        }
                      />
                    )}
                  </button>
                );
              })}

              {sortedProfiles.length === 0 && (
                <p className="px-5 py-8 text-center text-sm text-slate-400">
                  Nenhum perfil cadastrado.
                </p>
              )}
            </div>
          </aside>

          <main className="min-w-0 space-y-6">
            <section className="rounded-lg bg-white px-4 py-6 shadow-sm ring-1 ring-slate-200 sm:px-6">
              {selected ? (
                <>
                  <div className="mx-auto max-w-3xl text-center">
                    <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">
                      {selectedMeta.title}
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-slate-500">
                      {selectedMeta.description}
                    </p>
                  </div>

                  <div className="mt-8 overflow-x-auto pb-2">
                    {timelinePoints.length > 0 ? (
                      <div
                        className="relative flex items-start justify-between px-8 pt-2"
                        style={{ minWidth: `${timelineMinWidth}px` }}
                      >
                        <div className="absolute left-10 right-10 top-4.5 h-1 rounded-full bg-linear-to-r from-slate-400 via-emerald-500 to-amber-400" />
                        {timelinePoints.map((point) => (
                          <div
                            key={`${point.day}-${point.steps
                              .map((step) => step.index)
                              .join("-")}`}
                            className="relative z-10 flex w-18.5 flex-col items-center text-center"
                          >
                            <span
                              className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-bold shadow-sm ${TONE_CLASSES[point.tone].node}`}
                            >
                              {formatDayBadge(point.day)}
                            </span>
                            <span
                              className={`mt-2 min-h-8 text-[11px] font-semibold leading-3 ${TONE_CLASSES[point.tone].label}`}
                            >
                              {point.caption}
                            </span>
                            <span className="mt-1 flex h-4 items-center justify-center gap-1">
                              {point.steps.map((step) =>
                                step.channel === "EMAIL" ? (
                                  <Mail
                                    key={step.index}
                                    size={13}
                                    className={TONE_CLASSES[point.tone].icon}
                                    aria-label="E-mail"
                                  />
                                ) : (
                                  <MessageCircle
                                    key={step.index}
                                    size={13}
                                    className={TONE_CLASSES[point.tone].icon}
                                    aria-label="WhatsApp"
                                  />
                                ),
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="py-12 text-center text-sm text-slate-400">
                        Nenhuma etapa configurada.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="py-16 text-center text-sm text-slate-400">
                  Selecione um perfil para editar suas etapas.
                </p>
              )}
            </section>

            {selected && (
              <section className="rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-950">
                      Etapas - {getProfileLabel(selected)}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Ajuste canais, dias da regua e horarios de envio.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!selected.isDefault && (
                      <button
                        type="button"
                        onClick={() => void deleteProfile(selected.id)}
                        className="rounded-md border border-red-200 p-2 text-red-500 hover:bg-red-50"
                        title="Remover perfil"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={addStep}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <Plus size={13} />
                      Etapa
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveSteps()}
                      disabled={saving || !hasStepChanges}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <Save size={13} />
                      Salvar
                    </button>
                  </div>
                </div>

                <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Cobranca na emissao
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Envie a primeira cobranca assim que a fatura for
                        cadastrada neste perfil.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={emissionEnabled}
                      onClick={() => updateEmissionEnabled(!emissionEnabled)}
                      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition ${
                        emissionEnabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-7 items-center rounded-full p-0.5 transition ${
                          emissionEnabled ? "bg-emerald-600" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`h-3 w-3 rounded-full bg-white transition ${
                            emissionEnabled ? "translate-x-3" : "translate-x-0"
                          }`}
                        />
                      </span>
                      {emissionEnabled ? "Ativa" : "Inativa"}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={emissionChannels.EMAIL}
                      onClick={() =>
                        updateEmissionChannel("EMAIL", !emissionChannels.EMAIL)
                      }
                      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition ${
                        emissionChannels.EMAIL
                          ? "border-emerald-200 bg-white text-emerald-700 shadow-sm"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      <Mail size={14} />
                      E-mail
                    </button>
                    <button
                      type="button"
                      aria-pressed={emissionChannels.WHATSAPP}
                      onClick={() =>
                        updateEmissionChannel(
                          "WHATSAPP",
                          !emissionChannels.WHATSAPP,
                        )
                      }
                      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition ${
                        emissionChannels.WHATSAPP
                          ? "border-emerald-200 bg-white text-emerald-700 shadow-sm"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      <MessageCircle size={14} />
                      WhatsApp
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {editableStepEntries.length === 0 && (
                    <p className="px-5 py-12 text-center text-sm text-slate-400">
                      Clique em Etapa para adicionar o primeiro contato.
                    </p>
                  )}

                  {editableStepEntries.map(
                    ({ index, scheduleDay, step }, entryPosition) => {
                      const limits = getStepDayLimits(scheduleDays, index);
                      const min = Math.max(limits.min, EMISSION_DAY + 1);
                      const { max } = limits;

                      return (
                        <div
                          key={index}
                          className="grid gap-3 px-5 py-4 lg:grid-cols-[56px_150px_minmax(220px,1fr)_minmax(260px,1.2fr)_36px]"
                        >
                          <div className="flex items-center gap-1 lg:flex-col">
                            <button
                              type="button"
                              onClick={() => moveStep(index, "up")}
                              disabled={entryPosition === 0}
                              className="rounded p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                              title="Mover para cima"
                            >
                              <ArrowUp size={13} />
                            </button>
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                              {index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => moveStep(index, "down")}
                              disabled={
                                entryPosition === editableStepEntries.length - 1
                              }
                              className="rounded p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                              title="Mover para baixo"
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>

                          <div className="flex items-center">
                            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
                              <button
                                type="button"
                                onClick={() =>
                                  updateStep(index, "channel", "EMAIL")
                                }
                                className={`rounded px-3 py-1.5 text-xs font-semibold ${
                                  step.channel === "EMAIL"
                                    ? "bg-white text-emerald-700 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                                }`}
                                title="E-mail"
                              >
                                <Mail size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateStep(index, "channel", "WHATSAPP")
                                }
                                className={`rounded px-3 py-1.5 text-xs font-semibold ${
                                  step.channel === "WHATSAPP"
                                    ? "bg-white text-emerald-700 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                                }`}
                                title="WhatsApp"
                              >
                                <MessageCircle size={14} />
                              </button>
                            </div>
                          </div>

                          <label className="grid gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                              <CalendarClock size={13} />
                              Dia da regua
                            </span>
                            <span className="flex items-center gap-2">
                              <input
                                type="number"
                                value={scheduleDay}
                                onChange={(event) =>
                                  updateStepScheduleDay(
                                    index,
                                    parseIntegerInput(event.target.value),
                                  )
                                }
                                className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none"
                                min={min}
                                max={max}
                              />
                              <span className="text-xs text-slate-400">
                                dias
                              </span>
                            </span>
                            <span className="text-[11px] font-medium text-slate-500">
                              {formatScheduleDay(scheduleDay)}
                            </span>
                          </label>

                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                                <Clock3 size={13} />
                                Horario
                              </span>
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                                Opcional
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <input
                                type="time"
                                value={step.sendTimeStart}
                                onChange={(event) =>
                                  updateStep(
                                    index,
                                    "sendTimeStart",
                                    event.target.value,
                                  )
                                }
                                className="h-9 w-28 rounded-md border border-slate-200 px-2 text-xs text-slate-700"
                                aria-label="Horario inicial"
                              />
                              <span>ate</span>
                              <input
                                type="time"
                                value={step.sendTimeEnd}
                                onChange={(event) =>
                                  updateStep(
                                    index,
                                    "sendTimeEnd",
                                    event.target.value,
                                  )
                                }
                                className="h-9 w-28 rounded-md border border-slate-200 px-2 text-xs text-slate-700"
                                aria-label="Horario final"
                              />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeStep(index)}
                            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-500"
                            title="Remover etapa"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      );
                    },
                  )}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
