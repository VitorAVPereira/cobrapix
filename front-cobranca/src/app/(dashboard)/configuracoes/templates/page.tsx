"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CirclePlus,
  Loader2,
  MessageSquareText,
  Save,
  Smartphone,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useApiClient } from "@/lib/use-api-client";
import { spin } from "@/lib/spintax";
import type {
  ApiError,
  MessageTemplate,
  SaveMessageTemplateInput,
} from "@/lib/api-client";

interface TemplateFormState {
  id: string | null;
  name: string;
  slug: string;
  content: string;
  isActive: boolean;
}

interface TemplateOption {
  name: string;
  slug: string;
  defaultContent: string;
}

interface TemplateVariable {
  tag: string;
  label: string;
  preview: string;
  reserved?: boolean;
}

const DEFAULT_TEMPLATE_OPTION: TemplateOption = {
  name: "Vencimento hoje",
  slug: "vencimento-hoje",
  defaultContent:
    "{Olá|Oi|Tudo bem}, {debtorName}. Sua fatura de {originalAmount} vence em {dueDate}.",
};

const TEMPLATE_OPTIONS: TemplateOption[] = [
  DEFAULT_TEMPLATE_OPTION,
  {
    name: "Lembrete antes do vencimento",
    slug: "pre-vencimento",
    defaultContent:
      "{Olá|Oi}, {debtorName}. Passando para lembrar que sua fatura de {originalAmount} vence em {dueDate}.",
  },
  {
    name: "Primeiro aviso de atraso",
    slug: "atraso-primeiro-aviso",
    defaultContent:
      "{Olá|Oi}, {debtorName}. Identificamos uma fatura em aberto de {originalAmount}, vencida em {dueDate}.",
  },
  {
    name: "Atraso recorrente",
    slug: "atraso-recorrente",
    defaultContent:
      "{Olá|Oi}, {debtorName}. Ainda consta uma pendencia de {originalAmount} com vencimento em {dueDate}.",
  },
  {
    name: "Ultimo aviso",
    slug: "ultimo-aviso",
    defaultContent:
      "{Olá|Oi}, {debtorName}. Este e um ultimo lembrete sobre a fatura de {originalAmount}, vencida em {dueDate}.",
  },
  {
    name: "Confirmacao de pagamento",
    slug: "pagamento-confirmado",
    defaultContent:
      "{Olá|Oi}, {debtorName}. Recebemos o pagamento da sua fatura de {originalAmount}. Obrigado!",
  },
];

const DEFAULT_TEMPLATE = {
  name: DEFAULT_TEMPLATE_OPTION.name,
  slug: DEFAULT_TEMPLATE_OPTION.slug,
  content: DEFAULT_TEMPLATE_OPTION.defaultContent,
  isActive: true,
};

const EMPTY_FORM: TemplateFormState = {
  id: null,
  ...DEFAULT_TEMPLATE,
};

const VARIABLES: TemplateVariable[] = [
  { tag: "{debtorName}", label: "Cliente", preview: "Joao Silva" },
  { tag: "{originalAmount}", label: "Valor", preview: "R$ 150,00" },
  { tag: "{dueDate}", label: "Vencimento", preview: "22/04/2026" },
  { tag: "{companyName}", label: "Empresa", preview: "Clinica Exemplo" },
  {
    tag: "{pixCopyPaste}",
    label: "PIX copia e cOlá",
    preview: "00020101021226...",
    reserved: true,
  },
  {
    tag: "{paymentLink}",
    label: "Link de pagamento",
    preview: "https://pay.example/cobranca",
    reserved: true,
  },
];

function templateToForm(template: MessageTemplate): TemplateFormState {
  const option = getTemplateOption(template.slug);

  return {
    id: template.id,
    name: option?.name ?? template.name,
    slug: template.slug,
    content: template.content,
    isActive: template.isActive,
  };
}

function getTemplateOption(slug: string): TemplateOption | undefined {
  return TEMPLATE_OPTIONS.find((option) => option.slug === slug);
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Nao foi possivel concluir a acao. Tente novamente.";
}

function renderPreview(content: string): string {
  const withVariables = VARIABLES.reduce(
    (message, variable) => message.replaceAll(variable.tag, variable.preview),
    content,
  );

  try {
    return spin(withVariables);
  } catch {
    return withVariables;
  }
}

export default function TemplatesPage() {
  const apiClient = useApiClient();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const preview = useMemo(() => renderPreview(form.content), [form.content]);
  const selectedTemplate = templates.find(
    (template) => template.id === form.id,
  );

  useEffect(() => {
    let active = true;

    async function loadTemplates(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const data = await apiClient.getTemplates();
        if (!active) {
          return;
        }

        setTemplates(data);
        const firstTemplate =
          data.find((template) => template.slug === DEFAULT_TEMPLATE.slug) ??
          data[0];
        setForm(firstTemplate ? templateToForm(firstTemplate) : EMPTY_FORM);
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

    void loadTemplates();

    return () => {
      active = false;
    };
  }, [apiClient]);

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
      id: null,
      name: option.name,
      slug: option.slug,
      content: option.defaultContent,
      isActive: true,
    });
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

  function selectTemplateType(slug: string): void {
    const option = getTemplateOption(slug);

    if (!option) {
      return;
    }

    setForm((current) => ({
      ...current,
      name: option.name,
      slug: option.slug,
      content:
        current.id || current.content.trim()
          ? current.content
          : option.defaultContent,
    }));
    setSuccess(null);
  }

  async function saveTemplate(): Promise<void> {
    const option = getTemplateOption(form.slug);
    const payload: SaveMessageTemplateInput = {
      name: option?.name ?? form.name.trim(),
      slug: option?.slug ?? form.slug,
      content: form.content.trim(),
      isActive: form.isActive,
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
        const exists = current.some((template) => template.id === saved.id);
        if (exists) {
          return current.map((template) =>
            template.id === saved.id ? saved : template,
          );
        }

        return [saved, ...current];
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

  return (
    <main className="min-h-full bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              Regras de cobranca
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Configure jornadas de WhatsApp com Spintax e variaveis do backend.
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
          </div>
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
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">
                {selectedTemplate ? "Editar template" : "Novo template"}
              </h2>
            </div>

            <div className="space-y-5 p-5">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">
                  Tipo de template
                </span>
                <select
                  value={form.slug}
                  onChange={(event) => selectTemplateType(event.target.value)}
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
                className="inline-flex items-center mt-1.5 gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                {form.isActive ? (
                  <ToggleRight className="text-emerald-600" size={22} />
                ) : (
                  <ToggleLeft className="text-slate-500" size={22} />
                )}
                {form.isActive ? "Template ativo" : "Template inativo"}
              </button>

              <div className="space-y-2">
                <span className="text-sm font-medium text-slate-700">
                  Variaveis
                </span>
                <div className="flex flex-wrap gap-2">
                  {VARIABLES.map((variable) => (
                    <button
                      key={variable.tag}
                      type="button"
                      onClick={() => {
                        if (!variable.reserved) {
                          insertVariable(variable.tag);
                        }
                      }}
                      disabled={variable.reserved}
                      title={
                        variable.reserved
                          ? "Reservada para a sprint de pagamento"
                          : undefined
                      }
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                        variable.reserved
                          ? "cursor-not-allowed border-sky-200 bg-sky-50 text-sky-700 opacity-70"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      }`}
                    >
                      {variable.label}
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
                  placeholder="{Olá|Oi}, {debtorName}. Sua fatura de {originalAmount} vence em {dueDate}."
                />
              </label>

              <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                Use Spintax com pipe, como {"{Olá|Oi|Tudo bem}"}. As variaveis
                financeiras foram reservadas para o proximo passo do fluxo de
                PIX.
              </div>
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

                <div className="flex flex-1 items-start p-4">
                  <div className="max-w-[92%] whitespace-pre-wrap wrap-break-word rounded-md rounded-tl-none bg-white px-3 py-2 text-sm leading-5 text-slate-900 shadow-sm">
                    {preview || "A mensagem aparecera aqui."}
                    <div className="mt-1 text-right text-[11px] text-slate-400">
                      09:00
                    </div>
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
