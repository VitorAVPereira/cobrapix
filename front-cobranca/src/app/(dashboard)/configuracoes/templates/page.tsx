"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CirclePlus,
  Code2,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Save,
  Smartphone,
  ToggleLeft,
  ToggleRight,
  UploadCloud,
} from "lucide-react";
import type {
  ApiError,
  MessageTemplate,
  MessageTemplateCopyCodeSource,
  MessageTemplateSlug,
  SaveMessageTemplateInput,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { spin } from "@/lib/spintax";

type ComponentTab = "body" | "footer" | "buttons" | "meta";

interface TemplateFormState {
  id: string | null;
  name: string;
  slug: MessageTemplateSlug;
  content: string;
  footerText: string;
  paymentButtonEnabled: boolean;
  paymentButtonLabel: string;
  copyCodeButtonEnabled: boolean;
  copyCodeSource: MessageTemplateCopyCodeSource;
  isActive: boolean;
  metaTemplateName: string;
  metaLanguage: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
}

interface TemplateOption {
  name: string;
  slug: MessageTemplateSlug;
  defaultContent: string;
  footerText: string;
  paymentButtonLabel: string;
}

interface TemplateVariable {
  tag: string;
  label: string;
  preview: string;
  group: "Cobranca" | "Pagamento";
}

const TEMPLATE_OPTIONS: readonly TemplateOption[] = [
  {
    name: "Cobranca na emissao",
    slug: "cobranca-emissao",
    defaultContent:
      "{Ola|Oi}, {{nome_devedor}}. Sua cobranca de {{valor}} da {{nome_empresa}} foi emitida com vencimento em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\nUse o botao abaixo para abrir a pagina segura de pagamento e copiar Pix ou boleto.",
    footerText: "Mensagem automatica da {{nome_empresa}}.",
    paymentButtonLabel: "Abrir pagamento",
  },
  {
    name: "Lembrete antes do vencimento",
    slug: "pre-vencimento",
    defaultContent:
      "{Ola|Oi}, {{nome_devedor}}. Passando para lembrar que a cobranca de {{valor}} da {{nome_empresa}} vence em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\nUse o botao abaixo para abrir a pagina segura de pagamento e copiar Pix ou boleto.",
    footerText: "Mensagem automatica da {{nome_empresa}}.",
    paymentButtonLabel: "Abrir pagamento",
  },
  {
    name: "Vencimento hoje",
    slug: "vencimento-hoje",
    defaultContent:
      "{Ola|Oi|Tudo bem}, {{nome_devedor}}. Sua cobranca de {{valor}} da {{nome_empresa}} vence hoje ({{data_vencimento}}).\n\nForma de pagamento: {{metodo_pagamento}}\nUse o botao abaixo para abrir a pagina segura de pagamento e copiar Pix ou boleto.",
    footerText: "Mensagem automatica da {{nome_empresa}}.",
    paymentButtonLabel: "Abrir pagamento",
  },
  {
    name: "Primeiro aviso de atraso",
    slug: "atraso-primeiro-aviso",
    defaultContent:
      "{Ola|Oi}, {{nome_devedor}}. Identificamos uma cobranca em aberto de {{valor}} da {{nome_empresa}}, vencida em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\nUse o botao abaixo para regularizar com seguranca e copiar Pix ou boleto.",
    footerText: "Mensagem automatica da {{nome_empresa}}.",
    paymentButtonLabel: "Regularizar agora",
  },
  {
    name: "Atraso recorrente",
    slug: "atraso-recorrente",
    defaultContent:
      "{Ola|Oi}, {{nome_devedor}}. Ainda consta uma cobranca pendente de {{valor}} da {{nome_empresa}}, com vencimento em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\nUse o botao abaixo para acessar a pagina de pagamento e copiar Pix ou boleto.",
    footerText: "Mensagem automatica da {{nome_empresa}}.",
    paymentButtonLabel: "Regularizar agora",
  },
  {
    name: "Atraso critico",
    slug: "atraso-critico",
    defaultContent:
      "Ola, {{nome_devedor}}. Sua cobranca de {{valor}} da {{nome_empresa}} segue pendente desde {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\nUse o botao abaixo para acessar a pagina de pagamento e evitar novas restricoes.",
    footerText: "Mensagem automatica da {{nome_empresa}}.",
    paymentButtonLabel: "Regularizar agora",
  },
] as const;

const TABS: Array<{ id: ComponentTab; label: string }> = [
  { id: "body", label: "Corpo" },
  { id: "footer", label: "Rodape" },
  { id: "buttons", label: "Botoes" },
  { id: "meta", label: "Meta" },
];

const TEMPLATE_ORDER = new Map(
  TEMPLATE_OPTIONS.map((option, index) => [option.slug, index]),
);
const DEFAULT_TEMPLATE_OPTION = TEMPLATE_OPTIONS[0];
const COPY_CODE_LIMIT = 15;
const META_STATUS_POLL_INTERVAL_MS = 60_000;

const EMPTY_FORM: TemplateFormState = {
  id: null,
  name: DEFAULT_TEMPLATE_OPTION.name,
  slug: DEFAULT_TEMPLATE_OPTION.slug,
  content: DEFAULT_TEMPLATE_OPTION.defaultContent,
  footerText: DEFAULT_TEMPLATE_OPTION.footerText,
  paymentButtonEnabled: true,
  paymentButtonLabel: DEFAULT_TEMPLATE_OPTION.paymentButtonLabel,
  copyCodeButtonEnabled: false,
  copyCodeSource: "AUTO",
  isActive: true,
  metaTemplateName: "cobrapix_cobranca_emissao",
  metaLanguage: "pt_BR",
  category: "UTILITY",
};

const VARIABLES: readonly TemplateVariable[] = [
  {
    tag: "{{nome_devedor}}",
    label: "Nome do devedor",
    preview: "Joao Silva",
    group: "Cobranca",
  },
  {
    tag: "{{nome_empresa}}",
    label: "Empresa",
    preview: "Clinica Exemplo",
    group: "Cobranca",
  },
  {
    tag: "{{valor}}",
    label: "Valor",
    preview: "R$ 150,00",
    group: "Cobranca",
  },
  {
    tag: "{{data_vencimento}}",
    label: "Vencimento",
    preview: "22/04/2026",
    group: "Cobranca",
  },
  {
    tag: "{{metodo_pagamento}}",
    label: "Metodo",
    preview: "Pix",
    group: "Pagamento",
  },
  {
    tag: "{{payment_link}}",
    label: "Pagina de pagamento",
    preview: "https://cobrapix.com/pagar/abc123",
    group: "Pagamento",
  },
  {
    tag: "{{pix_copia_e_cola}}",
    label: "Pix copia e cola",
    preview: "00020101021226860014br.gov.bcb.pix...",
    group: "Pagamento",
  },
  {
    tag: "{{boleto_linha_digitavel}}",
    label: "Linha digitavel",
    preview: "36490.00027 00000.000000 00000.000000 1 99990000015000",
    group: "Pagamento",
  },
];

function getTemplateOption(slug: string): TemplateOption | undefined {
  return TEMPLATE_OPTIONS.find((option) => option.slug === slug);
}

function getVariableKey(tag: string): string {
  return tag.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
}

function createPreviewRng(content: string): () => number {
  let seed = 0x811c9dc5;

  for (let index = 0; index < content.length; index += 1) {
    seed = Math.imul(seed ^ content.charCodeAt(index), 0x01000193);
  }

  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function interpolatePreviewVariables(content: string): string {
  return VARIABLES.reduce((message, variable) => {
    const key = getVariableKey(variable.tag);
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, "g");

    return message.replace(pattern, variable.preview);
  }, content);
}

function renderPreviewText(content: string): string {
  const withVariables = interpolatePreviewVariables(content);

  try {
    return spin(withVariables, createPreviewRng(withVariables));
  } catch {
    return withVariables;
  }
}

function sortTemplates(templates: MessageTemplate[]): MessageTemplate[] {
  return [...templates].sort((left, right) => {
    const leftOrder =
      TEMPLATE_ORDER.get(left.slug as MessageTemplateSlug) ?? 999;
    const rightOrder =
      TEMPLATE_ORDER.get(right.slug as MessageTemplateSlug) ?? 999;

    return leftOrder - rightOrder || left.name.localeCompare(right.name);
  });
}

function templateToForm(template: MessageTemplate): TemplateFormState {
  const option = getTemplateOption(template.slug);

  return {
    id: template.id,
    name: option?.name ?? template.name,
    slug: (option?.slug ?? template.slug) as MessageTemplateSlug,
    content: template.content,
    footerText: template.footerText ?? option?.footerText ?? "",
    paymentButtonEnabled: template.paymentButtonEnabled,
    paymentButtonLabel:
      template.paymentButtonLabel ||
      option?.paymentButtonLabel ||
      "Abrir pagamento",
    copyCodeButtonEnabled: template.copyCodeButtonEnabled,
    copyCodeSource: template.copyCodeSource,
    isActive: template.isActive,
    metaTemplateName:
      template.metaTemplateName ??
      `cobrapix_${template.slug.replaceAll("-", "_")}`,
    metaLanguage: template.metaLanguage,
    category: template.category,
  };
}

function getFirstAvailableTemplateOption(
  templates: MessageTemplate[],
): TemplateOption {
  return (
    TEMPLATE_OPTIONS.find(
      (option) => !templates.some((template) => template.slug === option.slug),
    ) ?? DEFAULT_TEMPLATE_OPTION
  );
}

function getMetaStatusStyle(status: string): {
  backgroundColor: string;
  color: string;
} {
  const upper = status.toUpperCase();

  if (upper === "APPROVED")
    return { backgroundColor: "#ecfdf5", color: "#065f46" };
  if (upper === "REJECTED")
    return { backgroundColor: "#fef2f2", color: "#991b1b" };
  if (upper === "LOCAL")
    return { backgroundColor: "#f1f5f9", color: "#475569" };
  return { backgroundColor: "#fffbeb", color: "#92400e" };
}

function formatMetaStatus(status: string): string {
  const upper = status.toUpperCase();

  if (upper === "APPROVED") return "Aprovado";
  if (upper === "PENDING" || upper === "SUBMITTED") return "Pendente";
  if (upper === "IN_REVIEW") return "Em analise";
  if (upper === "REJECTED") return "Rejeitado";
  if (upper === "LOCAL") return "Local";
  return status;
}

function isWaitingForMetaReview(status: string): boolean {
  const upper = status.toUpperCase();

  return upper === "PENDING" || upper === "SUBMITTED" || upper === "IN_REVIEW";
}

function canSyncMetaStatus(status: string): boolean {
  return status.toUpperCase() !== "LOCAL";
}

function getMetaStatusMessage(status: string): string {
  const upper = status.toUpperCase();

  if (upper === "APPROVED") return "Template aprovado e pronto para envio.";
  if (upper === "REJECTED")
    return "Template rejeitado pela Meta. Ajuste o conteudo e envie novamente.";
  if (isWaitingForMetaReview(status))
    return "Aguardando analise da Meta. A consulta e atualizada automaticamente.";
  return "Template ainda nao enviado para avaliacao oficial.";
}

function formatSyncTime(isoDate: string | null): string | null {
  if (!isoDate) return null;

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Nao foi possivel concluir a acao. Tente novamente.";
}

function getCopyCodePreview(source: MessageTemplateCopyCodeSource): string {
  if (source === "BOLETO_LINE_DIGITABLE") {
    return "36490.00027 00000.000000 00000.000000 1 99990000015000";
  }

  return "00020101021226860014br.gov.bcb.pix...";
}

function isCopyCodeValid(source: MessageTemplateCopyCodeSource): boolean {
  return getCopyCodePreview(source).length <= COPY_CODE_LIMIT;
}

export default function TemplatesPage() {
  const apiClient = useApiClient();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);
  const [activeTab, setActiveTab] = useState<ComponentTab>("body");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const previewBody = useMemo(
    () => renderPreviewText(form.content),
    [form.content],
  );
  const previewFooter = useMemo(
    () => renderPreviewText(form.footerText),
    [form.footerText],
  );
  const selectedTemplate = templates.find(
    (template) => template.id === form.id,
  );
  const copyCodeValid = isCopyCodeValid(form.copyCodeSource);
  const hasTemplatesWaitingForMeta = templates.some((template) =>
    isWaitingForMetaReview(template.metaStatus),
  );

  useEffect(() => {
    let active = true;

    async function loadTemplates(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const data = sortTemplates(await apiClient.getTemplates());
        if (!active) return;

        setTemplates(data);
        const firstTemplate =
          data.find(
            (template) => template.slug === DEFAULT_TEMPLATE_OPTION.slug,
          ) ?? data[0];
        setForm(firstTemplate ? templateToForm(firstTemplate) : EMPTY_FORM);
      } catch (loadError) {
        if (active) setError(getErrorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadTemplates();

    return () => {
      active = false;
    };
  }, [apiClient]);

  const syncMetaStatuses = useCallback(
    async (showFeedback: boolean): Promise<void> => {
      setSyncingMeta(true);
      if (showFeedback) {
        setError(null);
        setSuccess(null);
      }

      try {
        const syncedTemplates = sortTemplates(
          await apiClient.syncTemplateMetaStatuses(),
        );
        setTemplates(syncedTemplates);
        if (showFeedback) {
          setSuccess("Status atualizado pela Meta.");
        }
      } catch (syncError) {
        if (showFeedback) {
          setError(getErrorMessage(syncError));
        }
      } finally {
        setSyncingMeta(false);
      }
    },
    [apiClient],
  );

  useEffect(() => {
    if (
      loading ||
      saving ||
      syncingMeta ||
      !hasTemplatesWaitingForMeta
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void syncMetaStatuses(false);
    }, META_STATUS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    hasTemplatesWaitingForMeta,
    loading,
    saving,
    syncingMeta,
    syncMetaStatuses,
  ]);

  function updateForm<K extends keyof TemplateFormState>(
    key: K,
    value: TemplateFormState[K],
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
    setSuccess(null);
  }

  function startNewTemplate(): void {
    const option = getFirstAvailableTemplateOption(templates);

    setForm({
      ...EMPTY_FORM,
      name: option.name,
      slug: option.slug,
      content: option.defaultContent,
      footerText: option.footerText,
      paymentButtonLabel: option.paymentButtonLabel,
      metaTemplateName: `cobrapix_${option.slug.replaceAll("-", "_")}`,
    });
    setActiveTab("body");
    setError(null);
    setSuccess(null);
  }

  function selectTemplate(template: MessageTemplate): void {
    setForm(templateToForm(template));
    setError(null);
    setSuccess(null);
  }

  function insertVariable(tag: string): void {
    updateForm(
      "content",
      `${form.content}${form.content.endsWith(" ") ? "" : " "}${tag}`,
    );
  }

  function selectTemplateType(slug: MessageTemplateSlug): void {
    const option = getTemplateOption(slug);
    if (!option) return;

    setForm((current) => ({
      ...current,
      name: option.name,
      slug: option.slug,
      content:
        current.id || current.content.trim()
          ? current.content
          : option.defaultContent,
      footerText:
        current.id || current.footerText.trim()
          ? current.footerText
          : option.footerText,
      paymentButtonLabel:
        current.id || current.paymentButtonLabel.trim()
          ? current.paymentButtonLabel
          : option.paymentButtonLabel,
      metaTemplateName: current.metaTemplateName.trim()
        ? current.metaTemplateName
        : `cobrapix_${option.slug.replaceAll("-", "_")}`,
    }));
    setSuccess(null);
  }

  async function saveTemplate(): Promise<void> {
    const option = getTemplateOption(form.slug);
    const payload: SaveMessageTemplateInput = {
      name: option?.name ?? form.name.trim(),
      slug: option?.slug ?? form.slug,
      content: form.content.trim(),
      footerText: form.footerText.trim(),
      paymentButtonEnabled: form.paymentButtonEnabled,
      paymentButtonLabel: form.paymentButtonLabel.trim() || "Abrir pagamento",
      copyCodeButtonEnabled: form.copyCodeButtonEnabled,
      copyCodeSource: form.copyCodeSource,
      isActive: form.isActive,
      metaTemplateName: form.metaTemplateName.trim(),
      metaLanguage: form.metaLanguage.trim(),
      category: form.category,
    };

    if (!payload.name || !payload.slug || !payload.content) {
      setError(
        "Selecione um tipo de template e preencha a mensagem antes de salvar.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const saved = form.id
        ? await apiClient.updateTemplate(form.id, payload)
        : await apiClient.createTemplate(payload);

      setTemplates((current) => {
        const nextTemplates = current.some(
          (template) => template.id === saved.id,
        )
          ? current.map((template) =>
              template.id === saved.id ? saved : template,
            )
          : [...current, saved];

        return sortTemplates(nextTemplates);
      });
      setForm(templateToForm(saved));
      setSuccess("Template salvo com sucesso.");
    } catch (saveError) {
      const apiError = saveError as ApiError;
      setError(
        apiError.status === 409
          ? "Ja existe um template desse tipo para esta empresa."
          : getErrorMessage(saveError),
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitToMeta(): Promise<void> {
    if (!form.id) {
      setError("Salve o template antes de enviar para a Meta.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await apiClient.submitTemplateToMeta(form.id);
      setTemplates((current) =>
        sortTemplates(
          current.map((template) =>
            template.id === result.template.id ? result.template : template,
          ),
        ),
      );
      setForm(templateToForm(result.template));
      setSuccess(
        "Template enviado para aprovacao na Meta. O status sera sincronizado automaticamente.",
      );
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              Templates de cobranca
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Configure templates Meta por componentes, com corpo, rodape e
              botoes.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startNewTemplate}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
            >
              <CirclePlus size={18} />
              Novo
            </button>
            <button
              type="button"
              onClick={() => void saveTemplate()}
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
            <button
              type="button"
              onClick={() => void submitToMeta()}
              disabled={saving || loading || !form.id}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <UploadCloud size={18} />
              Enviar Meta
            </button>
          </div>
        </div>

        {selectedTemplate && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="text-slate-500">Status na Meta:</span>
            <span
              className="inline-flex rounded px-2 py-0.5 text-xs font-semibold"
              style={getMetaStatusStyle(selectedTemplate.metaStatus)}
            >
              {formatMetaStatus(selectedTemplate.metaStatus)}
            </span>
            {selectedTemplate.metaRejectedReason && (
              <span className="text-red-600">
                Motivo: {selectedTemplate.metaRejectedReason}
              </span>
            )}
            <span className="text-slate-600">
              {getMetaStatusMessage(selectedTemplate.metaStatus)}
            </span>
            {formatSyncTime(selectedTemplate.lastMetaSyncAt) && (
              <span className="text-slate-400">
                Ultima consulta na Meta:{" "}
                {formatSyncTime(selectedTemplate.lastMetaSyncAt)}
              </span>
            )}
            {canSyncMetaStatus(selectedTemplate.metaStatus) && (
              <button
                type="button"
                onClick={() => void syncMetaStatuses(true)}
                disabled={syncingMeta || loading || saving}
                className="ml-auto inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  className={syncingMeta ? "animate-spin" : undefined}
                  size={14}
                />
                {syncingMeta ? "Sincronizando" : "Sincronizar agora"}
              </button>
            )}
          </div>
        )}

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

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Templates
              </h2>
            </div>

            <div className="max-h-155 overflow-y-auto p-2">
              {loading ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
                  <Loader2 className="animate-spin" size={16} />
                  Carregando templates
                </div>
              ) : templates.length === 0 ? (
                <div className="px-3 py-4 text-sm text-slate-500">
                  Nenhum template salvo ainda.
                </div>
              ) : (
                templates.map((template) => {
                  const active = template.id === form.id;

                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => selectTemplate(template)}
                      className={`mb-2 w-full rounded-md border px-3 py-3 text-left transition ${
                        active
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {template.name}
                      </span>
                      <span
                        className={`mt-2 inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
                          template.isActive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {template.isActive ? "Ativo" : "Inativo"}
                      </span>
                      <span
                        className="ml-2 inline-flex rounded px-2 py-0.5 text-xs font-semibold"
                        style={getMetaStatusStyle(template.metaStatus)}
                      >
                        {formatMetaStatus(template.metaStatus)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                      activeTab === tab.id
                        ? "bg-slate-950 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-5 p-5">
              {activeTab === "body" && (
                <>
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">
                        Tipo de template
                      </span>
                      <select
                        value={form.slug}
                        onChange={(event) =>
                          selectTemplateType(
                            event.target.value as MessageTemplateSlug,
                          )
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      >
                        {TEMPLATE_OPTIONS.map((option) => (
                          <option key={option.slug} value={option.slug}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={() => updateForm("isActive", !form.isActive)}
                      className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      {form.isActive ? (
                        <ToggleRight className="text-emerald-600" size={22} />
                      ) : (
                        <ToggleLeft className="text-slate-500" size={22} />
                      )}
                      {form.isActive ? "Ativo" : "Inativo"}
                    </button>
                  </div>

                  <div className="space-y-2">
                    <span className="text-sm font-medium text-slate-700">
                      Placeholders
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {VARIABLES.map((variable) => (
                        <button
                          key={variable.tag}
                          type="button"
                          onClick={() => insertVariable(variable.tag)}
                          title={variable.tag}
                          className="max-w-full rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-left text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          <span className="block">{variable.label}</span>
                          <code className="block break-all font-mono text-[11px] font-medium text-emerald-900">
                            {variable.tag}
                          </code>
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">
                      Corpo da mensagem
                    </span>
                    <textarea
                      value={form.content}
                      onChange={(event) =>
                        updateForm("content", event.target.value)
                      }
                      rows={12}
                      className="w-full resize-none rounded-md border border-slate-300 px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                </>
              )}

              {activeTab === "footer" && (
                <label className="space-y-1.5">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <FileText size={16} />
                    Texto do rodape
                  </span>
                  <textarea
                    aria-label="Texto do rodape"
                    value={form.footerText}
                    onChange={(event) =>
                      updateForm("footerText", event.target.value)
                    }
                    rows={4}
                    maxLength={60}
                    className="w-full resize-none rounded-md border border-slate-300 px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                  <span className="block text-xs text-slate-500">
                    {form.footerText.length}/60 caracteres
                  </span>
                </label>
              )}

              {activeTab === "buttons" && (
                <div className="space-y-5">
                  <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={form.paymentButtonEnabled}
                      onChange={(event) =>
                        updateForm("paymentButtonEnabled", event.target.checked)
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">
                        Abrir pagamento/copiar codigo
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        Botao URL seguro para a pagina /pagar com Pix e boleto.
                      </span>
                    </span>
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">
                      Texto do botao de pagamento
                    </span>
                    <input
                      value={form.paymentButtonLabel}
                      onChange={(event) =>
                        updateForm("paymentButtonLabel", event.target.value)
                      }
                      maxLength={25}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>

                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={form.copyCodeButtonEnabled}
                        onChange={(event) =>
                          updateForm(
                            "copyCodeButtonEnabled",
                            event.target.checked,
                          )
                        }
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                      />
                      <span className="text-sm font-semibold text-amber-950">
                        COPY_CODE direto
                      </span>
                    </label>

                    <label className="mt-3 block space-y-1.5">
                      <span className="text-sm font-medium text-amber-950">
                        Origem do COPY_CODE
                      </span>
                      <select
                        aria-label="Origem do COPY_CODE"
                        value={form.copyCodeSource}
                        onChange={(event) =>
                          updateForm(
                            "copyCodeSource",
                            event.target.value as MessageTemplateCopyCodeSource,
                          )
                        }
                        className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                      >
                        <option value="AUTO">Automatico</option>
                        <option value="PIX_COPY_PASTE">Pix copia e cola</option>
                        <option value="BOLETO_LINE_DIGITABLE">
                          Linha digitavel
                        </option>
                      </select>
                    </label>

                    {!copyCodeValid && (
                      <p className="mt-3 text-xs font-medium text-amber-900">
                        Pix copia e cola e linha digitavel costumam ultrapassar
                        o limite de 15 caracteres da Meta. Use o botao de
                        pagamento.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "meta" && (
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-sm font-medium text-slate-700">
                      Nome oficial na Meta
                    </span>
                    <input
                      value={form.metaTemplateName}
                      onChange={(event) =>
                        updateForm("metaTemplateName", event.target.value)
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm font-medium text-slate-700">
                      Idioma
                    </span>
                    <input
                      value={form.metaLanguage}
                      onChange={(event) =>
                        updateForm("metaLanguage", event.target.value)
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>

                  <label className="space-y-1.5 md:col-span-3">
                    <span className="text-sm font-medium text-slate-700">
                      Categoria
                    </span>
                    <select
                      value={form.category}
                      onChange={(event) =>
                        updateForm(
                          "category",
                          event.target.value as TemplateFormState["category"],
                        )
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="UTILITY">UTILITY</option>
                      <option value="MARKETING">MARKETING</option>
                      <option value="AUTHENTICATION">AUTHENTICATION</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          </section>

          <aside className="rounded-md border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
              <Smartphone size={18} />
              <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
            </div>

            <div className="flex justify-center p-5">
              <div className="flex h-130 w-full max-w-75 flex-col overflow-hidden rounded-[28px] border-10 border-slate-950 bg-[#efeae2] shadow-xl">
                <div className="flex h-16 shrink-0 items-center gap-3 bg-[#075e54] px-4 text-white">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                    <MessageSquareText size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">Cliente</p>
                    <p className="text-xs text-white/70">online</p>
                  </div>
                </div>

                <div className="flex flex-1 items-start overflow-y-auto p-4">
                  <div className="max-w-[92%] overflow-hidden rounded-md rounded-tl-none bg-white text-sm leading-5 text-slate-900 shadow-sm">
                    <div className="wrap-break-word whitespace-pre-wrap px-3 py-2">
                      {previewBody || "A mensagem aparecera aqui."}
                      {previewFooter && (
                        <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                          {previewFooter}
                        </div>
                      )}
                      <div className="mt-1 text-right text-[11px] text-slate-400">
                        09:00
                      </div>
                    </div>

                    {form.paymentButtonEnabled && (
                      <button
                        type="button"
                        className="flex w-full items-center justify-center gap-2 border-t border-slate-100 px-3 py-2 text-xs font-semibold text-sky-700"
                      >
                        <ExternalLink size={13} />
                        {form.paymentButtonLabel || "Abrir pagamento"}
                      </button>
                    )}
                    {form.copyCodeButtonEnabled && copyCodeValid && (
                      <button
                        type="button"
                        className="flex w-full items-center justify-center gap-2 border-t border-slate-100 px-3 py-2 text-xs font-semibold text-sky-700"
                      >
                        <Code2 size={13} />
                        Copiar codigo
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
