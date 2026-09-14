"use client";

import { createContext, useContext } from "react";
import type { EfiOnboardingState } from "@/lib/efi-onboarding";

export interface FinancialActivationContextValue {
  state: EfiOnboardingState | null;
  loading: boolean;
  error: string | null;
  canIssue: boolean;
  refresh: () => Promise<void>;
}

export const FinancialActivationContext =
  createContext<FinancialActivationContextValue>({
    state: null,
    loading: true,
    error: null,
    canIssue: false,
    refresh: async (): Promise<void> => {},
  });

export function useFinancialActivation(): FinancialActivationContextValue {
  return useContext(FinancialActivationContext);
}
