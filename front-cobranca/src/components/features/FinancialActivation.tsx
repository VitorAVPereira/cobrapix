"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useApiClient } from "@/lib/use-api-client";
import { canIssueFinancially, EFI_STATUS_LABELS } from "@/lib/efi-onboarding";
import type { EfiOnboardingState } from "@/lib/efi-onboarding";
import { FinancialActivationContext } from "./financial-activation-context";
export function FinancialActivationProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const api = useApiClient();
  const { data: session, status } = useSession();
  const [state, setState] = useState<EfiOnboardingState | null>(null);
  const [ownerCompanyId, setOwnerCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const currentRequestId = ++requestId.current;
    if (
      status !== "authenticated" ||
      session?.user.role !== "COMPANY_ADMIN" ||
      session.user.mustChangePassword
    ) {
      setState(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const value = await api.getEfiOnboarding();
      if (currentRequestId !== requestId.current) return;
      setState(value);
      setOwnerCompanyId(session.user.companyId);
      setError(null);
    } catch (caught: unknown) {
      if (currentRequestId !== requestId.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível verificar a ativação financeira.",
      );
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [
    api,
    status,
    session?.user.role,
    session?.user.mustChangePassword,
    session?.user.companyId,
  ]);
  useEffect(() => {
    const activeRequest = requestId;
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      clearInterval(timer);
      activeRequest.current++;
    };
  }, [refresh]);
  const visibleState =
    ownerCompanyId === session?.user.companyId &&
    session?.user.role === "COMPANY_ADMIN"
      ? state
      : null;
  return (
    <FinancialActivationContext.Provider
      value={{
        state: visibleState,
        loading,
        error,
        canIssue: canIssueFinancially(visibleState) && !error,
        refresh,
      }}
    >
      {session?.user.role === "COMPANY_ADMIN" &&
        !session.user.mustChangePassword &&
        (!canIssueFinancially(visibleState) || error) && (
          <div
            role="status"
            className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-950 flex flex-wrap items-center justify-between gap-2"
          >
            <span>
              {error ??
                (loading
                  ? "Verificando sua ativação financeira…"
                  : `Ativação financeira: ${visibleState ? EFI_STATUS_LABELS[visibleState.status] : "pendente"}. Você pode preparar cadastros e rascunhos.`)}
            </span>
            <Link
              className="font-semibold underline underline-offset-4"
              href="/onboarding/efi"
            >
              Continuar ativação
            </Link>
          </div>
        )}
      {children}
    </FinancialActivationContext.Provider>
  );
}
