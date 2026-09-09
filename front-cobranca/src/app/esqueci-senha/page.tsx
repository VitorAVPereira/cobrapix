"use client";

import { FormEvent, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { AuthCard } from "@/components/auth/AuthCard";
import { apiClient } from "@/lib/api-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsLoading(true);

    try {
      const result = await apiClient.forgotPassword(email.trim());
      setMessage(result.message);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível solicitar a redefinição. Tente novamente.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCard
      title="Esqueceu sua senha?"
      description="Informe seu e-mail. Se houver uma conta cadastrada, enviaremos um link válido por 30 minutos."
    >
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">
          <MailCheck className="mb-2" size={22} aria-hidden="true" />
          {message}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-emerald-500"
              placeholder="seu@email.com"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading && <Loader2 size={18} className="animate-spin" />}
            {isLoading ? "Enviando..." : "Enviar instruções"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
