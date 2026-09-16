import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo";

interface AuthCardProps {
  title: string;
  description: string;
  children: ReactNode;
  backToLogin?: boolean;
}

export function AuthCard({
  title,
  description,
  children,
  backToLogin = true,
}: AuthCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandLogo width={168} height={54} priority />
        </div>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
          <div className="mt-7">{children}</div>
          {backToLogin && (
            <Link
              href="/login"
              className="mt-6 block text-center text-sm font-medium text-emerald-700 hover:text-emerald-800"
            >
              Voltar para o login
            </Link>
          )}
        </section>
      </div>
    </main>
  );
}
