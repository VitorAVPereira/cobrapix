"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useApiClient } from "@/lib/use-api-client";
import type { EmailTemplate } from "@/lib/api-client";
import { WhatsappCatalog } from "@/components/features/templates/WhatsappCatalog";
import { TemplateMappingEditor } from "@/components/features/templates/TemplateMappingEditor";
import { CompanyTemplateGrants } from "@/components/features/templates/CompanyTemplateGrants";
import { TemplatePendingSends } from "@/components/features/templates/TemplatePendingSends";

export default function AdminTemplatesPage(): ReactNode {
  const api = useApiClient();
  const { data: session } = useSession();
  const allowed = session?.user.role === "PLATFORM_ADMIN";
  const [editing, setEditing] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [email, setEmail] = useState<EmailTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    if (!allowed) return;
    try {
      setEmail(await api.getEmailTemplates());
      setError(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível carregar os modelos de e-mail.",
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
          Os templates de WhatsApp vêm do catálogo aprovado na Meta: aqui você
          configura as variáveis e decide quais empresas podem usá-los. Os
          modelos de e-mail continuam com as personalizações de cada cliente.
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
      <WhatsappCatalog onConfigure={setEditing} refreshKey={refreshKey} />
      {editing && (
        <TemplateMappingEditor
          key={editing}
          templateId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setRefreshKey((value) => value + 1)}
        />
      )}
      <CompanyTemplateGrants />
      <TemplatePendingSends scope="ADMIN" />
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
