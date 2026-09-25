"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useApiClient } from "@/lib/use-api-client";
import { EFI_STATUS_LABELS } from "@/lib/efi-onboarding";
import type { EfiOnboardingState } from "@/lib/efi-onboarding";
import type { CompanyFinancialProfile } from "@/lib/financial-activation";
import {
  FinancialActivationContext,
  useFinancialActivation,
} from "./financial-activation-context";
export function FinancialActivationProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const api = useApiClient();
  const { data: session, status } = useSession();
  const [state, setState] = useState<EfiOnboardingState | null>(null);
  const [profile, setProfile] = useState<CompanyFinancialProfile | null>(null);
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
      setProfile(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextProfile = await api.getFinancialProfile();
      // The opening flow is only queried when the server offers it.
      const nextState = nextProfile.openingEnabled
        ? await api.getEfiOnboarding()
        : null;
      if (currentRequestId !== requestId.current) return;
      setProfile(nextProfile);
      setState(nextState);
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
  const owned =
    ownerCompanyId === session?.user.companyId &&
    session?.user.role === "COMPANY_ADMIN";
  const visibleState = owned ? state : null;
  const visibleProfile = owned ? profile : null;
  return (
    <FinancialActivationContext.Provider
      value={{
        state: visibleState,
        profile: visibleProfile,
        openingEnabled: visibleProfile?.openingEnabled ?? false,
        loading,
        error,
        // Same rule as the API: a published financial profile, whether it came
        // from a manual activation or from a completed opening.
        canIssue: Boolean(visibleProfile?.canIssue) && !error,
        refresh,
      }}
    >
      {children}
    </FinancialActivationContext.Provider>
  );
}

export function FinancialActivationBanner(): ReactNode {
  const { data: session } = useSession();
  const { state, openingEnabled, loading, error, canIssue } =
    useFinancialActivation();
  if (
    session?.user.role !== "COMPANY_ADMIN" ||
    session.user.mustChangePassword ||
    (canIssue && !error)
  )
    return null;
  const message =
    error ??
    (loading
      ? "Verificando sua ativação financeira…"
      : openingEnabled
        ? `Ativação financeira: ${state ? EFI_STATUS_LABELS[state.status] : "pendente"}. Você pode preparar cadastros e rascunhos.`
        : "Ativação financeira pendente: a equipe CifraMais está configurando sua conta de recebimento. Você pode preparar cadastros e rascunhos.");
  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-950 flex flex-wrap items-center justify-between gap-2"
    >
      <span>{message}</span>
      {openingEnabled && (
        <Link
          className="font-semibold underline underline-offset-4"
          href="/onboarding/efi"
        >
          Continuar ativação
        </Link>
      )}
    </div>
  );
}
