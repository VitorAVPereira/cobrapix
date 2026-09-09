"use client";

import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { useApiClient } from "@/lib/use-api-client";

export default function FirstAccessPage() {
  const router = useRouter();
  const apiClient = useApiClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (password !== passwordConfirmation) {
      setError("A confirmação da senha não confere.");
      return;
    }
    if (password === currentPassword) {
      setError("A nova senha deve ser diferente da senha temporária.");
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.changePassword({
        currentPassword,
        password,
        passwordConfirmation,
      });
      await signOut({ redirect: false });
      router.push("/login?passwordChanged=1");
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível alterar a senha.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCard
      title="Proteja seu acesso"
      description="Esta é uma senha temporária. Defina uma nova senha antes de acessar o painel."
      backToLogin={false}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <PasswordInput
          id="current-password"
          label="Senha temporária"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <PasswordInput id="new-password" label="Nova senha" value={password} onChange={setPassword} />
        <PasswordInput
          id="new-password-confirmation"
          label="Confirmar nova senha"
          value={passwordConfirmation}
          onChange={setPasswordConfirmation}
        />
        <p className="text-xs leading-5 text-slate-500">
          Use pelo menos 8 caracteres, com letra minúscula, letra maiúscula e número.
        </p>
        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {isLoading && <Loader2 size={18} className="animate-spin" />}
          {isLoading ? "Trocando..." : "Trocar senha"}
        </button>
      </form>
    </AuthCard>
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete = "new-password",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
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
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  );
}
