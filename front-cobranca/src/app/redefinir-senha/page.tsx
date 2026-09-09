"use client";

import { FormEvent, Suspense, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { apiClient } from "@/lib/api-client";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError("O link de redefinição está incompleto. Solicite um novo link.");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("A confirmação da senha não confere.");
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.resetPassword({ token, password, passwordConfirmation });
      router.push("/login?passwordReset=1");
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível redefinir a senha.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCard
      title="Crie uma nova senha"
      description="Use pelo menos 8 caracteres, incluindo letra minúscula, letra maiúscula e número."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <PasswordField id="password" label="Nova senha" value={password} onChange={setPassword} />
        <PasswordField
          id="password-confirmation"
          label="Confirmar nova senha"
          value={passwordConfirmation}
          onChange={setPasswordConfirmation}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {isLoading && <Loader2 size={18} className="animate-spin" />}
          {isLoading ? "Redefinindo..." : "Redefinir senha"}
        </button>
      </form>
    </AuthCard>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        minLength={8}
        maxLength={120}
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
