"use client";

import { useEffect, useState } from "react";
import type { EmailTemplate, SaveEmailTemplateInput } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { CompanyWhatsappTemplates } from "@/components/features/templates/CompanyWhatsappTemplates";

type Channel = "WHATSAPP" | "EMAIL";

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível salvar a preferência.";
}

export default function TemplatesPage() {
  const apiClient = useApiClient();
  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [email, setEmail] = useState<EmailTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Email personalization belongs to the session's company; reload when it changes.
    setEmail([]);
    setSelectedId(null);
    apiClient
      .getEmailTemplates()
      .then((emailTemplates) => {
        if (!active) return;
        setEmail(emailTemplates);
        setSelectedId(emailTemplates[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (active) setNotice(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [apiClient]);

  const selected =
    email.find((item) => item.id === selectedId) ?? email[0] ?? null;

  function selectChannel(next: Channel): void {
    setChannel(next);
    setNotice(null);
  }
  function updateField(
    field: "greeting" | "instructions" | "signature",
    value: string,
  ): void {
    setEmail((current) =>
      current.map((item) =>
        item.id === selected?.id ? { ...item, [field]: value } : item,
      ),
    );
  }
  function setSelectedActive(isActive: boolean): void {
    if (!selected) return;
    setEmail((current) =>
      current.map((item) =>
        item.id === selected.id ? { ...item, isActive } : item,
      ),
    );
  }
  async function save(): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    const payload: SaveEmailTemplateInput = {
      isActive: selected.isActive,
      greeting: selected.greeting,
      instructions: selected.instructions,
      signature: selected.signature,
    };
    try {
      const saved = await apiClient.updateEmailTemplate(selected.id, payload);
      setEmail((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      setNotice("Preferências salvas.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Modelos de cobrança
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          No WhatsApp você consulta os templates liberados para sua empresa. No
          e-mail você personaliza a saudação, as instruções e a assinatura.
        </p>
      </div>
      <div className="flex gap-2">
        {(["WHATSAPP", "EMAIL"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={channel === item}
            onClick={() => selectChannel(item)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${channel === item ? "bg-slate-900 text-white" : "border bg-white text-slate-700"}`}
          >
            {item === "WHATSAPP" ? "WhatsApp" : "E-mail"}
          </button>
        ))}
      </div>
      {channel === "WHATSAPP" ? (
        <CompanyWhatsappTemplates />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-2">
            {email.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-xl border p-4 text-left ${selected?.id === item.id ? "border-indigo-500 bg-indigo-50" : "bg-white"}`}
              >
                <span className="block font-medium text-slate-900">
                  {item.name}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Modelo central • {item.resendStatus}
                </span>
              </button>
            ))}
          </aside>
          {selected && (
            <section className="space-y-5 rounded-2xl border bg-white p-5 shadow-sm">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Conteúdo aprovado
                </p>
                <p className="mt-2 font-medium text-slate-800">
                  {selected.subject}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {selected.content}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  O texto central e as configurações do provedor são
                  administrados pela CifraMais.
                </p>
              </div>
              {(
                [
                  ["greeting", "Saudação", 80],
                  ["instructions", "Instruções", 280],
                  ["signature", "Assinatura", 120],
                ] as const
              ).map(([field, label, max]) => (
                <label
                  key={field}
                  className="block text-sm font-medium text-slate-700"
                >
                  {label}
                  <input
                    value={selected[field] ?? ""}
                    maxLength={max}
                    onChange={(event) => updateField(field, event.target.value)}
                    className="mt-2 w-full rounded-lg border px-3 py-2 font-normal"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selected.isActive}
                  onChange={(event) => setSelectedActive(event.target.checked)}
                />
                Usar este modelo
              </label>
              {notice && (
                <p role="status" className="text-sm text-slate-600">
                  {notice}
                </p>
              )}
              <button
                disabled={busy}
                onClick={() => void save()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Salvando…" : "Salvar preferências"}
              </button>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
