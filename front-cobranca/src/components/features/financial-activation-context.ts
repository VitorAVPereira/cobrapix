"use client";

import { createContext, useContext } from "react";
import type { EfiOnboardingState } from "@/lib/efi-onboarding";
import type { CompanyFinancialProfile } from "@/lib/financial-activation";

export interface FinancialActivationContextValue {
  state: EfiOnboardingState | null;
  profile?: CompanyFinancialProfile | null;
  // Self-service account opening is offered only when the server enables it.
  openingEnabled?: boolean;
  loading: boolean;
  error: string | null;
  canIssue: boolean;
  refresh: () => Promise<void>;
}

export const FinancialActivationContext =
  createContext<FinancialActivationContextValue>({
    state: null,
    profile: null,
    openingEnabled: false,
    loading: true,
    error: null,
    canIssue: false,
    refresh: async (): Promise<void> => {},
  });

export function useFinancialActivation(): FinancialActivationContextValue {
  return useContext(FinancialActivationContext);
}
