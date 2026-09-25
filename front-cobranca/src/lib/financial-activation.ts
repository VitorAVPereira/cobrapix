// Company view: summary of its own activation, no credentials.
export interface CompanyFinancialProfile {
  openingEnabled: boolean;
  canIssue: boolean;
  status: "ACTIVE" | "PENDING";
  accountMode: string | null;
  enabledMethods: string[];
  activatedAt: string | null;
  issuerAccount: string | null;
}

export type FinancialMethod = "PIX" | "BOLIX";
export type FinancialEnvironment = "HOMOLOGATION" | "PRODUCTION";
export type FinancialProfileStatus =
  | "DRAFT"
  | "VALIDATING"
  | "READY"
  | "VALIDATION_FAILED"
  | "ACTIVE"
  | "SUPERSEDED"
  | "CANCELED"
  | "EXPIRED";

export interface ValidationStep {
  code: string;
  status: "PENDING" | "PASSED" | "FAILED" | "SKIPPED" | "NOT_VERIFIABLE";
  effect: "NONE" | "PIX_WEBHOOK_CONFIGURED" | "VALIDATION_SPLIT_CONFIGURED";
  errorCode?: string;
}

export interface ValidationAttempt {
  id: string;
  profileRevision: number;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  steps: ValidationStep[];
  attempts: number;
  errorCode: string | null;
  validUntil: string | null;
}

// Admin view. Secrets are write-only: the server never returns them.
export interface FinancialProfile {
  id: string;
  version: number;
  revision: number;
  status: FinancialProfileStatus;
  accountMode: string;
  payoutMode: string;
  environment: FinancialEnvironment;
  enabledMethods: FinancialMethod[];
  authorization: { reference: string | null; validUntil: string | null };
  ownership: { verifiedAt: string | null; evidenceReference: string | null };
  issuer: {
    holderDocument: string;
    efiAccountNumber: string;
    payeeCode: string | null;
    pixKey: string | null;
  } | null;
  credential: {
    version: number;
    status: string;
    certificateFingerprint: string;
    certificateExpiresAt: string;
  } | null;
  validatedAt: string | null;
  activatedAt: string | null;
  latestValidation?: ValidationAttempt | null;
}

export interface FinancialOverview {
  companyId: string;
  company: { corporateName: string; document: string };
  manualActivationReleased: boolean;
  active: FinancialProfile | null;
  candidate: FinancialProfile | null;
}

export const PROFILE_STATUS_LABELS: Record<FinancialProfileStatus, string> = {
  DRAFT: "Em preparação",
  VALIDATING: "Validando integração",
  READY: "Validada — pronta para ativar",
  VALIDATION_FAILED: "Validação com falha",
  ACTIVE: "Ativa",
  SUPERSEDED: "Substituída",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada",
};

export const STEP_LABELS: Record<string, string> = {
  CERTIFICATE: "Certificado",
  FEE_VERSIONS: "Tarifas vigentes",
  PLATFORM_RECIPIENT: "Conta de comissão da CifraMais",
  PIX_AUTH: "Autenticação Pix",
  PIX_WEBHOOK: "Webhook Pix",
  PIX_SPLIT: "Permissão de split Pix",
  CHARGES_AUTH: "Autenticação API Cobranças",
  CHARGES_WEBHOOK_URL: "Webhook de Cobranças",
  BOLIX_ISSUANCE: "Emissão de BOLIX",
  BOLIX_SPLIT: "Split do BOLIX",
};

export const STEP_STATUS_LABELS: Record<ValidationStep["status"], string> = {
  PENDING: "Pendente",
  PASSED: "Aprovado",
  FAILED: "Falhou",
  SKIPPED: "Não se aplica",
  NOT_VERIFIABLE: "Não comprovável sem emitir",
};
