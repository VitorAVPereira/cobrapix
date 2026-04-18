"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Zap, Shield, BarChart3 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setIsLoading(false);

    if (result?.error) {
      setError("E-mail ou senha incorretos.");
      return;
    }

    router.push("/cobrancas");
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel — Brand */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[560px] bg-slate-900 flex-col justify-between p-12 relative overflow-hidden">
        {/* Decorative gradient */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl" />

        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-white tracking-wider mb-2">
            COBRA<span className="text-emerald-400">PIX</span>
          </h1>
          <p className="text-slate-400 text-sm">
            Plataforma de cobranca automatizada
          </p>
        </div>

        <div className="relative z-10 space-y-8">
          <h2 className="text-2xl font-semibold text-white leading-snug">
            Gerencie cobranças com<br />
            <span className="text-emerald-400">WhatsApp + Pix</span>
          </h2>

          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-emerald-500/10 rounded-lg shrink-0">
                <Zap size={20} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">Disparo automatico</p>
                <p className="text-slate-400 text-sm">
                  Mensagens de cobranca enviadas via WhatsApp para devedores.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-emerald-500/10 rounded-lg shrink-0">
                <Shield size={20} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">Seguro e auditavel</p>
                <p className="text-slate-400 text-sm">
                  Cada acao registrada no log de cobranca com rastreabilidade completa.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-emerald-500/10 rounded-lg shrink-0">
                <BarChart3 size={20} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">Painel em tempo real</p>
                <p className="text-slate-400 text-sm">
                  Acompanhe faturas, vencimentos e status de conexao do WhatsApp.
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-slate-600 text-xs">
          CobraPix &copy; {new Date().getFullYear()}
        </p>
      </div>

      {/* Right panel — Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-slate-50">
        <div className="w-full max-w-md">
          {/* Mobile brand (hidden on lg+) */}
          <div className="lg:hidden text-center mb-10">
            <h1 className="text-3xl font-bold text-slate-900 tracking-wider">
              COBRA<span className="text-emerald-500">PIX</span>
            </h1>
            <p className="text-slate-500 mt-1 text-sm">
              Plataforma de cobranca automatizada
            </p>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900">
              Bem-vindo de volta
            </h2>
            <p className="text-slate-500 mt-1">
              Entre com suas credenciais para acessar o painel.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center font-medium">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow text-slate-900 placeholder:text-slate-400"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Senha
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow text-slate-900 placeholder:text-slate-400"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 size={18} className="animate-spin" />}
              {isLoading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          {/* MVP dev hint */}
          {process.env.NODE_ENV === "development" && (
            <div className="mt-6 p-3 bg-slate-100 border border-slate-200 rounded-xl text-center">
              <p className="text-xs text-slate-500">
                <span className="font-medium text-slate-600">MVP</span>{" "}
                admin@cobrapix.com / senha123
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
