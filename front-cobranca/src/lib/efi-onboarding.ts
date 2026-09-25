export type EfiOnboardingStatus =
  | "DRAFT"
  | "NOTICE_PENDING"
  | "AWAITING_REPRESENTATIVE"
  | "EFI_PROCESSING"
  | "SUBMISSION_UNCERTAIN"
  | "PROVISIONING"
  | "ACTIVE"
  | "REFUSED"
  | "CORRECTION_REQUIRED"
  | "CONFIGURATION_ERROR"
  | "DISCONNECTED";
export interface EfiOnboardingState {
  status: EfiOnboardingStatus;
  revision: number;
  company: {
    corporateName: string;
    tradeName: string | null;
    document: string;
    addressPostalCode: string | null;
    addressStreet: string | null;
    addressNumber: string | null;
    addressDistrict: string | null;
    addressCity: string | null;
    addressState: string | null;
  };
  representativeProvided: boolean;
  consentAcceptedAt: string | null;
  legalVersions: { authorization: string; terms: string; privacy: string };
  reason: string | null;
  submittedAt: string | null;
  activatedAt: string | null;
  lastReminderAt: string | null;
  reminderAttempts: number;
  retryBlockedUntil: string | null;
  timeline: Array<{ action: string; createdAt: string }>;
  actions: { canEdit: boolean; canSubmit: boolean; canRetry: boolean };
}
export interface EfiDraftInput {
  revision?: number;
  corporateName?: string;
  tradeName?: string;
  document?: string;
  address?: {
    postalCode?: string;
    street?: string;
    number?: string;
    district?: string;
    city?: string;
    state?: string;
  };
  representative?: {
    name?: string;
    cpf?: string;
    birthDate?: string;
    motherName?: string;
    email?: string;
    phone?: string;
  };
  consent?: {
    authorized: true;
    termsAccepted: true;
    privacyAccepted: true;
    authorizationVersion: string;
    termsVersion: string;
    privacyVersion: string;
  };
}
export const EFI_STATUS_LABELS: Record<EfiOnboardingStatus, string> = {
  DRAFT: "Rascunho",
  NOTICE_PENDING: "Enviando aviso ao representante",
  AWAITING_REPRESENTATIVE: "Aguardando confirmação do representante",
  EFI_PROCESSING: "Em análise na Efí",
  SUBMISSION_UNCERTAIN: "Envio em verificação pela CifraMais",
  PROVISIONING: "Configurando sua conta",
  ACTIVE: "Conta ativa",
  REFUSED: "Solicitação recusada",
  CORRECTION_REQUIRED: "Correção necessária",
  CONFIGURATION_ERROR: "Configuração em revisão",
  DISCONNECTED: "Integração desligada",
};
export function companyLoginDestination(
  mustChangePassword: boolean,
  role: string,
  passwordJustChanged: boolean,
): string {
  if (mustChangePassword) return "/primeiro-acesso";
  if (role === "PLATFORM_ADMIN") return "/admin/clientes";
  return passwordJustChanged ? "/onboarding/efi" : "/cobrancas";
}

export function certificateExpirationNotice(expiresAt: string | null | undefined, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const days = Math.ceil((Date.parse(expiresAt) - now) / 86_400_000);
  if (!Number.isFinite(days) || days > 30) return null;
  return days <= 0 ? "Certificado vencido. Renove e valide a integração antes de emitir." : `Certificado vence em ${days} dia(s). Verifique a renovação da integração.`;
}
