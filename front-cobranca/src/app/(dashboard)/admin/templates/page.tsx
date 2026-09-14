"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useApiClient } from "@/lib/use-api-client";
import type { EmailTemplate, MessageTemplate } from "@/lib/api-client";
export default function AdminTemplatesPage(): ReactNode {
  const api = useApiClient();
  const { data: session } = useSession();
  const allowed = session?.user.role === "PLATFORM_ADMIN";
  const [whatsapp, setWhatsapp] = useState<MessageTemplate[]>([]);
  const [email, setEmail] = useState<EmailTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    if (!allowed) return;
    try {
      const [messages, emails] = await Promise.all([
        api.getTemplates(),
        api.getEmailTemplates(),
      ]);
      setWhatsapp(messages);
      setEmail(emails);
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível carregar o catálogo.",
      );
    }
  }, [api, allowed]);
  useEffect(() => {
    void load();
  }, [load]);
  async function run(
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await load();
      setNotice(success);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "A operação não foi concluída.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return (
      <p className="p-8">Acesso restrito à administração da plataforma.</p>
    );
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">
      <header>
        <h1 className="text-2xl font-semibold">
          Catálogo central de templates
        </h1>
        <p className="mt-2 text-slate-600">
          Modelos globais de cobrança. Os clientes personalizam saudação,
          instruções e assinatura.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-700">
          {notice}
        </p>
      )}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">WhatsApp</h2>
          <button
            disabled={busy}
            className="rounded-lg border px-4 py-2 disabled:opacity-50"
            onClick={() =>
              void run(
                () => api.syncTemplateMetaStatuses(),
                "Situações da Meta atualizadas.",
              )
            }
          >
            Sincronizar com a Meta
          </button>
        </div>
        {whatsapp.map((item) => (
          <article
            key={item.id}
            className="space-y-3 rounded-xl border bg-white p-5"
          >
            <h3 className="font-semibold">{item.name}</h3>
            <p className="text-sm text-slate-600">
              Situação na Meta: {item.metaStatus}
            </p>
            {item.metaRejectedReason && (
              <p className="text-sm text-red-700">{item.metaRejectedReason}</p>
            )}
            <p className="whitespace-pre-wrap text-sm">{item.content}</p>
            <button
              disabled={
                busy ||
                item.metaStatus === "APPROVED" ||
                item.metaStatus === "PENDING"
              }
              className="rounded-lg border px-3 py-2 disabled:opacity-50"
              onClick={() =>
                void run(
                  () => api.submitTemplateToMeta(item.id),
                  "Modelo enviado para aprovação da Meta.",
                )
              }
            >
              Solicitar aprovação de {item.name}
            </button>
          </article>
        ))}
        {whatsapp.length === 0 && (
          <p className="text-slate-500">Nenhum modelo WhatsApp disponível.</p>
        )}
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">E-mail</h2>
        {email.map((item) => (
          <article
            key={item.id}
            className="space-y-3 rounded-xl border bg-white p-5"
          >
            <h3 className="font-semibold">{item.name}</h3>
            <p className="text-sm text-slate-600">
              {item.resendTemplateId
                ? "Publicado no Resend"
                : "Publicação pendente"}
            </p>
            <p className="font-medium">{item.subject}</p>
            <p className="whitespace-pre-wrap text-sm">{item.content}</p>
            <button
              disabled={busy}
              className="rounded-lg border px-3 py-2 disabled:opacity-50"
              onClick={() =>
                void run(
                  () =>
                    api.financialAdmin(
                      "/email/templates/" + item.id + "/publish",
                      "POST",
                    ),
                  "Modelo publicado no Resend.",
                )
              }
            >
              Publicar {item.name}
            </button>
          </article>
        ))}
        {email.length === 0 && (
          <p className="text-slate-500">Nenhum modelo de e-mail disponível.</p>
        )}
      </section>
    </main>
  );
}
