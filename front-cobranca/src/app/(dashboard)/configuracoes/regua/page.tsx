"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  CollectionProfileType,
  CollectionRuleProfile,
  MessageTemplate,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Nao foi possivel concluir a acao.";
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
      "Uma sequência de boas-vindas e lembretes leves para quem está começando a pagar com você.",
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
      "Mais pontos de contato para acompanhar pagamentos que precisam de atenção.",
    icon: Meh,
  },
  BAD: {
    label: "Mau Pagador",
    description:
      "Uma sequência de cobrança mais frequente e direta para pagamentos em atraso.",
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

const TONE_CLASSES: Record<TimelineTone, { node: string }> = {
  emission: {
    node: "bg-slate-500 text-white",
  },
  before: {
    node: "bg-slate-700 text-white",
  },
  due: {
    node: "bg-emerald-600 text-white",
  },
  after: {
    node: "bg-amber-500 text-white",
  },
  critical: {
    node: "bg-red-700 text-white",
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

function sortTemplates(templates: MessageTemplate[]): MessageTemplate[] {
  return [...templates].sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR"),
  );
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

function formatDayBadge(day: number): string {
  if (day <= EMISSION_DAY) return "Inicial";
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

function formatScheduleDay(day: number): string {
  const absoluteDay = Math.abs(day);
  const dayLabel = absoluteDay === 1 ? "dia" : "dias";

  if (day < 0) {
    return `${absoluteDay} ${dayLabel} antes do vencimento`;
  }

  if (day === 0) {
    return "No dia do vencimento";
  }

  return `${day} ${dayLabel} após o vencimento`;
}

interface StepDayInputProps {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (day: number) => void;
}

function StepDayInput({
  value,
  min,
  max,
  label,
  onCommit,
}: StepDayInputProps): ReactElement {
  const [draft, setDraft] = useState(String(value));
  const [inputError, setInputError] = useState<string | null>(null);

  function commit(): void {
    const parsed = Number(draft);
    if (!/^-?\d+$/.test(draft.trim()) || !Number.isSafeInteger(parsed)) {
      setDraft(String(value));
      setInputError("Digite um número inteiro de dias.");
      return;
    }

    const nextDay = clampDay(parsed, min, max);
    setDraft(String(nextDay));
    setInputError(null);
    if (nextDay !== value) onCommit(nextDay);
  }

  return (
    <>
      <input
        type="number"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setInputError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        min={min}
        max={max}
        step={1}
        aria-label={label}
        aria-invalid={Boolean(inputError)}
        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900"
      />
      {inputError && (
        <span role="alert" className="text-xs font-medium text-red-600">
          {inputError}
        </span>
      )}
    </>
  );
}

export default function ReguaPage() {
  const apiClient = useApiClient();
  const [profiles, setProfiles] = useState<CollectionRuleProfile[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showNewProfile, setShowNewProfile] = useState(false);
  const [newProfile, setNewProfile] = useState<NewProfileForm>(EMPTY_PROFILE);

  const sortedProfiles = useMemo(() => sortProfiles(profiles), [profiles]);
  const activeTemplates = useMemo(
    () => sortTemplates(templates.filter((template) => template.isActive)),
    [templates],
  );
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

  function markStepsChanged(): void {
    setError(null);
    setSuccess(null);
    setHasStepChanges(true);
  }

  useEffect(() => {
    if (!hasStepChanges) return;

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
  }, [hasStepChanges]);

  function selectProfile(profileId: string): void {
    if (profileId === selectedId) return;
    if (
      hasStepChanges &&
      !window.confirm(
        "Você tem alterações não salvas. Descartar e trocar de perfil?",
      )
    ) {
      return;
    }

    setSelectedId(profileId);
    setError(null);
    setSuccess(null);
  }

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const [data, templateData] = await Promise.all([
          apiClient.getRules(),
          apiClient.getTemplates(),
        ]);
        if (!active) return;

        setProfiles(data);
        setTemplates(templateData);
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
    if (
      hasStepChanges &&
      !window.confirm(
        "Você tem alterações não salvas. Descartá-las e criar outro perfil?",
      )
    ) {
      return;
    }

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

    for (const [position, entry] of editableStepEntries.entries()) {
      const { sendTimeStart, sendTimeEnd } = entry.step;
      if (Boolean(sendTimeStart) !== Boolean(sendTimeEnd)) {
        setError(
          `Preencha os dois horários do contato ${position + 1} ou deixe ambos vazios.`,
        );
        return;
      }
      if (sendTimeStart && sendTimeEnd && sendTimeStart > sendTimeEnd) {
        setError(
          `O horário inicial do contato ${position + 1} deve ser anterior ao horário final.`,
        );
        return;
      }
    }

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
    markStepsChanged();
  }

  function updateStepTemplate(index: number, templateId: string): void {
    setStepForms((prev) =>
      prev.map((step, stepIndex) =>
        stepIndex === index
          ? { ...step, templateId: templateId || undefined }
          : step,
      ),
    );
    markStepsChanged();
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
    markStepsChanged();
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
    markStepsChanged();
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
    markStepsChanged();
  }

  function updateEmissionTemplate(
    channel: StepChannel,
    templateId: string,
  ): void {
    setStepForms((prev) =>
      buildStepFormsFromScheduledSteps(
        getScheduledStepForms(prev).map((step) =>
          step.scheduleDay === EMISSION_DAY && step.channel === channel
            ? { ...step, templateId: templateId || undefined }
            : step,
        ),
      ),
    );
    markStepsChanged();
  }

  function getEmissionTemplateId(channel: StepChannel): string {
    return (
      getScheduledStepForms(stepForms).find(
        (step) => step.scheduleDay === EMISSION_DAY && step.channel === channel,
      )?.templateId ?? ""
    );
  }

  function addStep(): void {
    setStepForms((prev) => {
      if (prev.length >= 20) return prev;
      const scheduledSteps = getScheduledStepForms(prev);
      const lastScheduleDay = scheduledSteps.reduce(
        (maxDay, step) => Math.max(maxDay, step.scheduleDay),
        Number.NEGATIVE_INFINITY,
      );
      const scheduleDay =
        lastScheduleDay === Number.NEGATIVE_INFINITY ||
        lastScheduleDay <= EMISSION_DAY
          ? 0
          : Math.min(lastScheduleDay + 3, 365);

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
    markStepsChanged();
  }

  function removeStep(index: number): void {
    setStepForms((prev) =>
      buildStepFormsFromScheduledSteps(
        getScheduledStepForms(prev).filter(
          (_, stepIndex) => stepIndex !== index,
        ),
      ),
    );
    markStepsChanged();
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
    markStepsChanged();
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
              Configurações de cobrança
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              Régua de cobrança
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Escolha um perfil e organize os contatos que serão enviados ao
              longo do vencimento.
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
              Classificar devedores
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

        <div className="grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 sm:grid-cols-3 sm:gap-5 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white font-bold text-emerald-700">
              1
            </span>
            <span>
              <strong className="block">Escolha o perfil</strong>
              <span className="text-emerald-800">
                Cada grupo pode receber uma sequência diferente.
              </span>
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white font-bold text-emerald-700">
              2
            </span>
            <span>
              <strong className="block">Defina os contatos</strong>
              <span className="text-emerald-800">
                Escolha o dia, o canal e a mensagem.
              </span>
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white font-bold text-emerald-700">
              3
            </span>
            <span>
              <strong className="block">Salve a régua</strong>
              <span className="text-emerald-800">
                Confira a prévia antes de aplicar as alterações.
              </span>
            </span>
          </div>
        </div>

        {(error || success) && (
          <div
            role="status"
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
              Perfis permitem criar sequências diferentes para cada grupo de
              clientes.
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
            <p className="mt-1 text-xs text-slate-500">
              Define este como o perfil principal da empresa.
            </p>
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
                Selecione quem receberá esta sequência.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {sortedProfiles.map((profile) => {
                const isSelected = selectedId === profile.id;
                const meta = PROFILE_VIEW_META[profile.profileType];
                const Icon = meta.icon;

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
                        {profile.steps.length} contato
                        {profile.steps.length !== 1 ? "s" : ""}
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

          <main className="min-w-0 space-y-6">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {selected ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
                        Perfil selecionado
                      </p>
                      <h2 className="mt-1 text-xl font-bold text-slate-950 sm:text-2xl">
                        {getProfileLabel(selected)}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        {selectedMeta.description}
                      </p>
                    </div>
                    {selected.isDefault && (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                        Perfil padrão
                      </span>
                    )}
                  </div>

                  <div className="p-5 sm:p-6">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-950">
                          Prévia da sequência
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          Veja quando os contatos deste perfil estão
                          programados.
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {stepForms.length} contato
                        {stepForms.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {timelinePoints.length > 0 ? (
                      <ol className="space-y-0">
                        {timelinePoints.map((point, pointIndex) => (
                          <li
                            key={`${point.day}-${point.steps
                              .map((step) => step.index)
                              .join("-")}`}
                            className="relative flex gap-4 pb-5 last:pb-0"
                          >
                            {pointIndex < timelinePoints.length - 1 && (
                              <span
                                className="absolute bottom-0 left-4 top-8 w-px bg-slate-200"
                                aria-hidden="true"
                              />
                            )}
                            <span
                              className={`relative z-10 flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold ${TONE_CLASSES[point.tone].node}`}
                            >
                              {formatDayBadge(point.day)}
                            </span>
                            <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-sm font-bold text-slate-900">
                                {point.day === EMISSION_DAY
                                  ? "A partir de 30 dias antes do vencimento"
                                  : formatScheduleDay(point.day)}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {point.steps.map((timelineStep) => {
                                  const templateId =
                                    stepForms[timelineStep.index]?.templateId;
                                  const templateName =
                                    templates.find(
                                      (template) => template.id === templateId,
                                    )?.name ?? "Sem mensagem selecionada";
                                  return (
                                    <span
                                      key={timelineStep.index}
                                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                                    >
                                      {timelineStep.channel === "EMAIL" ? (
                                        <Mail size={13} className="shrink-0" />
                                      ) : (
                                        <MessageCircle
                                          size={13}
                                          className="shrink-0"
                                        />
                                      )}
                                      {timelineStep.channel === "EMAIL"
                                        ? "E-mail"
                                        : "WhatsApp"}
                                      <span
                                        className="text-slate-400"
                                        aria-hidden="true"
                                      >
                                        ·
                                      </span>
                                      <span className="truncate">
                                        {templateName}
                                      </span>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
                        Nenhuma etapa configurada.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="px-5 py-16 text-center text-sm text-slate-500">
                  Selecione ou crie um perfil para configurar os contatos.
                </p>
              )}
            </section>

            {selected && (
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-6">
                  <div>
                    <h2 className="text-lg font-bold text-slate-950">
                      Configurar contatos
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Ajuste os envios do perfil {getProfileLabel(selected)}.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!selected.isDefault && (
                      <button
                        type="button"
                        onClick={() => void deleteProfile(selected.id)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-200 px-3 text-xs font-semibold text-red-600 hover:bg-red-50"
                        aria-label="Remover perfil"
                      >
                        <Trash2 size={15} />
                        <span className="hidden sm:inline">Remover perfil</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="border-b border-slate-100 bg-emerald-50/60 px-5 py-4 sm:px-6">
                  <p className="text-sm font-bold text-emerald-950">
                    Como contar os dias
                  </p>
                  <p className="mt-1 text-sm leading-6 text-emerald-900">
                    Dia 0 é o vencimento. Use números negativos para enviar
                    antes e positivos para enviar depois.
                  </p>
                </div>

                <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Contato inicial
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Envie uma mensagem a partir de 30 dias antes do
                        vencimento, quando a fatura já estiver cadastrada.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={emissionEnabled}
                      onClick={() => updateEmissionEnabled(!emissionEnabled)}
                      aria-label="Contato inicial"
                      className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
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

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-semibold text-slate-600">
                      Enviar por
                    </span>
                    <button
                      type="button"
                      aria-pressed={emissionChannels.EMAIL}
                      onClick={() =>
                        updateEmissionChannel("EMAIL", !emissionChannels.EMAIL)
                      }
                      className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
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
                      className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                        emissionChannels.WHATSAPP
                          ? "border-emerald-200 bg-white text-emerald-700 shadow-sm"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      <MessageCircle size={14} />
                      WhatsApp
                    </button>
                  </div>

                  {emissionEnabled && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {(["EMAIL", "WHATSAPP"] as const)
                        .filter((channel) => emissionChannels[channel])
                        .map((channel) => (
                          <label
                            key={channel}
                            className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                          >
                            <span className="text-xs font-semibold text-slate-600">
                              Mensagem do contato inicial por{" "}
                              {channel === "EMAIL" ? "E-mail" : "WhatsApp"}
                            </span>
                            <select
                              aria-label={`Template do contato inicial por ${
                                channel === "EMAIL" ? "E-mail" : "WhatsApp"
                              }`}
                              value={getEmissionTemplateId(channel)}
                              onChange={(event) =>
                                updateEmissionTemplate(
                                  channel,
                                  event.target.value,
                                )
                              }
                              className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                            >
                              <option value="">Sem seleção</option>
                              {activeTemplates.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                            </select>
                            <span className="text-xs leading-5 text-slate-500">
                              {channel === "WHATSAPP"
                                ? 'Sem seleção usa "Vencimento hoje" se aprovado na Meta. Outra mensagem escolhida também precisa de aprovação.'
                                : 'Sem seleção prioriza "Vencimento hoje" ou outro modelo ativo.'}
                            </span>
                          </label>
                        ))}
                    </div>
                  )}
                </div>

                <div className="px-5 py-5 sm:px-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Contatos programados
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Adicione lembretes antes, no dia ou depois do
                        vencimento.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addStep}
                      disabled={stepForms.length >= 20}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={16} /> Adicionar contato
                    </button>
                  </div>

                  {editableStepEntries.length === 0 && (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                      Ainda não há lembretes programados. Adicione um contato
                      para começar.
                    </p>
                  )}

                  <div className="space-y-4">
                    {editableStepEntries.map(
                      ({ index, scheduleDay, step }, entryPosition) => {
                        const limits = getStepDayLimits(scheduleDays, index);
                        const min = Math.max(limits.min, EMISSION_DAY + 1);
                        const { max } = limits;

                        return (
                          <article
                            key={index}
                            className="rounded-2xl border border-slate-200 bg-white shadow-sm"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
                              <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                                  {entryPosition + 1}
                                </span>
                                <div className="min-w-0">
                                  <h4 className="text-sm font-bold text-slate-900">
                                    Contato {entryPosition + 1}
                                  </h4>
                                  <p className="truncate text-xs text-slate-500">
                                    {formatScheduleDay(scheduleDay)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => moveStep(index, "up")}
                                  disabled={entryPosition === 0}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                                  aria-label={`Mover contato ${entryPosition + 1} para cima`}
                                >
                                  <ArrowUp size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveStep(index, "down")}
                                  disabled={
                                    entryPosition ===
                                    editableStepEntries.length - 1
                                  }
                                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                                  aria-label={`Mover contato ${entryPosition + 1} para baixo`}
                                >
                                  <ArrowDown size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeStep(index)}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"
                                  aria-label={`Remover contato ${entryPosition + 1}`}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                            <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-2">
                              <label className="grid gap-1.5">
                                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                                  <CalendarClock size={14} /> Dia em relação ao
                                  vencimento
                                </span>
                              <StepDayInput
                                key={`${selected.id}-${index}-${scheduleDay}`}
                                value={scheduleDay}
                                  onCommit={(day) =>
                                    updateStepScheduleDay(index, day)
                                  }
                                  min={min}
                                  max={max}
                                  label={`Dia do contato ${entryPosition + 1}`}
                                />
                                <span className="text-xs text-slate-500">
                                  {formatScheduleDay(scheduleDay)}
                                </span>
                              </label>
                              <div className="grid content-start gap-1.5">
                                <span className="text-xs font-bold text-slate-700">
                                  Canal de envio
                                </span>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    aria-pressed={step.channel === "EMAIL"}
                                    onClick={() =>
                                      updateStep(index, "channel", "EMAIL")
                                    }
                                    className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold ${step.channel === "EMAIL" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                                  >
                                    <Mail size={16} /> E-mail
                                  </button>
                                  <button
                                    type="button"
                                    aria-pressed={step.channel === "WHATSAPP"}
                                    onClick={() =>
                                      updateStep(index, "channel", "WHATSAPP")
                                    }
                                    className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold ${step.channel === "WHATSAPP" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                                  >
                                    <MessageCircle size={16} /> WhatsApp
                                  </button>
                                </div>
                              </div>
                              <label className="grid gap-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-700">
                                  Mensagem que será enviada
                                </span>
                                <select
                                  aria-label={`Template da etapa ${index + 1}`}
                                  value={step.templateId ?? ""}
                                  onChange={(event) =>
                                    updateStepTemplate(
                                      index,
                                      event.target.value,
                                    )
                                  }
                                  className="h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                                >
                                  <option value="">Sem seleção</option>
                                  {activeTemplates.map((template) => (
                                    <option
                                      key={template.id}
                                      value={template.id}
                                    >
                                      {template.name}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-xs text-slate-500">
                                  {step.channel === "WHATSAPP"
                                    ? 'Sem seleção usa "Vencimento hoje" se aprovado na Meta. Outra mensagem escolhida também precisa de aprovação.'
                                    : 'Sem seleção prioriza "Vencimento hoje" ou outro modelo ativo.'}
                                </span>
                              </label>
                              <div className="md:col-span-2">
                                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                                  <Clock3 size={14} /> Horário de envio{" "}
                                  <span className="font-normal text-slate-500">
                                    (opcional)
                                  </span>
                                </span>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
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
                                    className="h-11 min-w-32 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 sm:flex-none"
                                    aria-label={`Horário inicial do contato ${entryPosition + 1}`}
                                  />
                                  <span>até</span>
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
                                    className="h-11 min-w-32 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 sm:flex-none"
                                    aria-label={`Horário final do contato ${entryPosition + 1}`}
                                  />
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      },
                    )}
                  </div>
                </div>

                <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
                  <p
                    aria-live="polite"
                    className={`text-sm font-semibold ${hasStepChanges ? "text-amber-700" : "text-slate-500"}`}
                  >
                    {hasStepChanges ? "Alterações não salvas" : "Tudo salvo"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveSteps()}
                    disabled={saving || !hasStepChanges}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save size={16} />{" "}
                    {saving ? "Salvando..." : "Salvar alterações"}
                  </button>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
