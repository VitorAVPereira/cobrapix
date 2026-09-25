"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AdminConversationDetail,
  AdminConversationMessage,
  ApiError,
  AttributionMethod,
  ContextOption,
  MessageContextInput,
  MessageTemplate,
} from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import {
  errorMessage,
  formatInvoice,
  reasonLabel,
  serviceWindowOpen,
} from "./format";

const METHOD_LABELS: Record<AttributionMethod, string> = {
  UNASSIGNED: "Sem classificação",
  OUTBOUND_CONTEXT: "Contexto do envio",
  REPLY_CONTEXT: "Resposta citando a cobrança",
  INTERACTIVE_CONTEXT: "Botão da cobrança",
  MANUAL: "Classificação manual",
};

const VARIABLE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Positional variables of an approved template, in order. */
export function templateVariables(content: string): string[] {
  return Array.from(content.matchAll(VARIABLE), (match) => match[1] ?? "");
}

export function isSendableTemplate(template: MessageTemplate): boolean {
  return (
    template.isActive &&
    template.metaStatus === "APPROVED" &&
    !template.metaReviewRequired &&
    Boolean(template.metaTemplateName)
  );
}

interface ContextChoice {
  value: string;
  label: string;
  context: MessageContextInput;
  hasInvoice: boolean;
}

/** Suggestions from the server; every choice is revalidated there on write. */
function contextChoices(options: ContextOption[]): ContextChoice[] {
  const choices: ContextChoice[] = [];
  for (const option of options) {
    const company = option.company;
    if (!option.debtor) {
      choices.push({
        value: `company:${company.id}`,
        label: company.name,
        context: { companyId: company.id },
        hasInvoice: false,
      });
      continue;
    }
    const debtor = option.debtor;
    choices.push({
      value: `debtor:${company.id}:${debtor.id}`,
      label: `${company.name} · ${debtor.name}`,
      context: { companyId: company.id, debtorId: debtor.id },
      hasInvoice: false,
    });
    for (const invoice of option.invoices)
      choices.push({
        value: `invoice:${invoice.id}`,
        label: `${company.name} · ${debtor.name} · ${formatInvoice(invoice)}`,
        context: {
          companyId: company.id,
          debtorId: debtor.id,
          invoiceId: invoice.id,
        },
        hasInvoice: true,
      });
  }
  return choices;
}

function ContextSelect({
  label,
  choices,
  value,
  onChange,
  emptyLabel,
}: {
  label: string;
  choices: ContextChoice[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
}): ReactNode {
  return (
    <label className="block text-sm">
      {label}
      <select
        className="mt-1 w-full rounded-lg border p-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Per-message admin context: company, attribution and send outcome. No resend action. */
export function AdminMessageDetails({
  message,
  canQuote,
  onClassify,
  onQuote,
}: {
  message: AdminConversationMessage;
  canQuote: boolean;
  onClassify: (message: AdminConversationMessage) => void;
  onQuote: (message: AdminConversationMessage) => void;
}): ReactNode {
  const intent = message.outboundIntent;
  const reason =
    intent && ["UNCERTAIN", "FAILED"].includes(intent.state)
      ? reasonLabel(intent.lastErrorCode)
      : null;
  return (
    <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
      <p>
        {message.company
          ? (message.company.tradeName ?? message.company.corporateName)
          : "Sem empresa (somente atendimento)"}
        {message.attributionMethod
          ? ` · ${METHOD_LABELS[message.attributionMethod]}`
          : " · Histórico anterior"}
      </p>
      {intent?.state === "UNCERTAIN" && (
        <p role="note" className="rounded bg-amber-50 p-2 text-amber-800">
          {reason} Não reenvie esta cobrança sem confirmar com o provedor.
        </p>
      )}
      {intent?.state === "FAILED" && (
        <p className="rounded bg-red-50 p-2 text-red-800">{reason}</p>
      )}
      <div className="flex gap-3">
        {!intent && (
          <button
            className="font-medium text-indigo-700"
            onClick={() => onClassify(message)}
          >
            Classificar
          </button>
        )}
        {canQuote && message.externalMessageId && (
          <button
            className="font-medium text-indigo-700"
            onClick={() => onQuote(message)}
          >
            Responder citando
          </button>
        )}
      </div>
    </div>
  );
}

/** Attribution, text replies and template replies for the selected conversation. */
export function AdminConversationContext({
  conversation,
  templates,
  classifying,
  quoting,
  onCancelClassify,
  onCancelQuote,
  onChanged,
}: {
  conversation: AdminConversationDetail;
  templates: MessageTemplate[];
  classifying: AdminConversationMessage | null;
  quoting: AdminConversationMessage | null;
  onCancelClassify: () => void;
  onCancelQuote: () => void;
  onChanged: () => Promise<void>;
}): ReactNode {
  const api = useApiClient();
  const [options, setOptions] = useState<ContextOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attribution, setAttribution] = useState({ context: "", reason: "" });
  const [reply, setReply] = useState({ context: "", content: "" });
  const [template, setTemplate] = useState({
    id: "",
    context: "",
    parameters: {} as Record<string, string>,
  });
  // One id per draft: a retry after a network error is the same request.
  const replyDraft = useRef<string | null>(null);
  const templateDraft = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getConversationContextOptions(conversation.id)
      .then((result) => {
        if (active) setOptions(result.options);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(errorMessage(caught, "Falha ao carregar contextos."));
      });
    return () => {
      active = false;
    };
  }, [api, conversation.id]);

  const choices = useMemo(() => contextChoices(options), [options]);
  const contextOf = (value: string): MessageContextInput | undefined =>
    choices.find((choice) => choice.value === value)?.context;
  const windowOpen =
    conversation.channel !== "WHATSAPP" ||
    serviceWindowOpen(conversation.serviceWindowExpiresAt);
  const sendable = templates.filter(isSendableTemplate);
  const selectedTemplate = sendable.find((item) => item.id === template.id);
  const variables = selectedTemplate
    ? templateVariables(selectedTemplate.content)
    : [];
  const templateNeedsInvoice =
    Boolean(selectedTemplate?.paymentButtonEnabled) &&
    !choices.find((choice) => choice.value === template.context)?.hasInvoice;

  async function run(
    operation: () => Promise<unknown>,
    success: string,
    after?: () => void,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      after?.();
      setNotice(success);
      await onChanged();
    } catch (caught: unknown) {
      const status = (caught as ApiError).status;
      setError(
        status === 409 && classifying
          ? "A mensagem foi alterada por outra pessoa. A conversa foi atualizada; revise e tente novamente."
          : errorMessage(caught, "A operação não foi concluída."),
      );
      if (status === 409) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 border-t pt-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}

      {classifying && (
        <form
          aria-label="Classificar mensagem"
          className="space-y-2 rounded-lg border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                api.attributeMessage(classifying.id, {
                  expectedRevision: classifying.attributionRevision,
                  context: contextOf(attribution.context) ?? { companyId: null },
                  reason: attribution.reason.trim(),
                }),
              "Classificação registrada.",
              () => {
                setAttribution({ context: "", reason: "" });
                onCancelClassify();
              },
            );
          }}
        >
          <p className="text-sm font-medium">
            Classificar: “{classifying.content.slice(0, 80)}”
          </p>
          <ContextSelect
            label="Empresa e cobrança"
            choices={choices}
            value={attribution.context}
            onChange={(value) =>
              setAttribution((current) => ({ ...current, context: value }))
            }
            emptyLabel="Sem empresa (somente atendimento)"
          />
          <label className="block text-sm">
            Motivo
            <textarea
              aria-label="Motivo da classificação"
              className="mt-1 w-full rounded-lg border p-2"
              maxLength={500}
              required
              value={attribution.reason}
              onChange={(event) =>
                setAttribution((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !attribution.reason.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Salvar classificação
            </button>
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm"
              onClick={onCancelClassify}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {windowOpen ? (
        <form
          aria-label="Responder"
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            replyDraft.current ??= crypto.randomUUID();
            const context = contextOf(reply.context);
            void run(
              () =>
                api.replyToAdminConversation(conversation.id, {
                  idempotencyId: replyDraft.current!,
                  content: reply.content.trim(),
                  ...(context ? { context } : {}),
                  ...(quoting ? { replyToMessageId: quoting.id } : {}),
                }),
              "Resposta enviada para a fila do atendimento central.",
              () => {
                replyDraft.current = null;
                setReply({ context: "", content: "" });
                onCancelQuote();
              },
            );
          }}
        >
          {conversation.channel === "WHATSAPP" && (
            <ContextSelect
              label="Contexto da resposta"
              choices={choices}
              value={reply.context}
              onChange={(value) => {
                replyDraft.current = null;
                setReply((current) => ({ ...current, context: value }));
              }}
              emptyLabel="Somente atendimento (não aparece para empresas)"
            />
          )}
          {quoting && (
            <p className="flex justify-between gap-2 rounded bg-slate-100 p-2 text-xs">
              <span>Citando: “{quoting.content.slice(0, 80)}”</span>
              <button type="button" onClick={onCancelQuote}>
                Remover citação
              </button>
            </p>
          )}
          <label className="block text-sm font-medium">
            Resposta do atendimento central
            <textarea
              aria-label="Resposta do atendimento central"
              className="mt-2 min-h-28 w-full rounded-lg border p-3 font-normal"
              maxLength={4000}
              value={reply.content}
              onChange={(event) => {
                replyDraft.current = null;
                setReply((current) => ({
                  ...current,
                  content: event.target.value,
                }));
              }}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !reply.content.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Enviando…" : "Enviar resposta"}
          </button>
        </form>
      ) : (
        <form
          aria-label="Responder com template"
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedTemplate) return;
            templateDraft.current ??= crypto.randomUUID();
            const context = contextOf(template.context);
            void run(
              () =>
                api.replyWithTemplate(conversation.id, {
                  idempotencyId: templateDraft.current!,
                  templateId: selectedTemplate.id,
                  parameters: variables.map(
                    (name) => template.parameters[name]?.trim() ?? "",
                  ),
                  ...(context ? { context } : {}),
                }),
              "Template enviado para a fila do atendimento central.",
              () => {
                templateDraft.current = null;
                setTemplate({ id: "", context: "", parameters: {} });
              },
            );
          }}
        >
          <p className="text-sm text-amber-700">
            A janela de atendimento do WhatsApp está fechada. Somente templates
            aprovados podem ser enviados.
          </p>
          <label className="block text-sm">
            Template aprovado
            <select
              className="mt-1 w-full rounded-lg border p-2"
              value={template.id}
              onChange={(event) => {
                templateDraft.current = null;
                setTemplate({
                  id: event.target.value,
                  context: template.context,
                  parameters: {},
                });
              }}
            >
              <option value="">Selecione</option>
              {sendable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {sendable.length === 0 && (
            <p className="text-sm text-slate-500">
              Nenhum template aprovado e sem revisão pendente.
            </p>
          )}
          {selectedTemplate && (
            <>
              <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">
                {selectedTemplate.content}
              </p>
              {variables.map((name, index) => (
                <label key={`${name}-${index}`} className="block text-sm">
                  {name}
                  <input
                    aria-label={`Parâmetro ${name}`}
                    className="mt-1 w-full rounded-lg border p-2"
                    maxLength={1024}
                    value={template.parameters[name] ?? ""}
                    onChange={(event) => {
                      templateDraft.current = null;
                      setTemplate((current) => ({
                        ...current,
                        parameters: {
                          ...current.parameters,
                          [name]: event.target.value,
                        },
                      }));
                    }}
                  />
                </label>
              ))}
              <ContextSelect
                label="Contexto do template"
                choices={choices}
                value={template.context}
                onChange={(value) => {
                  templateDraft.current = null;
                  setTemplate((current) => ({ ...current, context: value }));
                }}
                emptyLabel="Somente atendimento (não aparece para empresas)"
              />
              {templateNeedsInvoice && (
                <p className="text-sm text-amber-700">
                  Este template tem botão de pagamento: selecione uma cobrança.
                </p>
              )}
            </>
          )}
          <button
            type="submit"
            disabled={
              busy ||
              !selectedTemplate ||
              templateNeedsInvoice ||
              variables.some((name) => !template.parameters[name]?.trim())
            }
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Enviar template
          </button>
        </form>
      )}
    </div>
  );
}
