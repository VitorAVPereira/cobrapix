/**
 * Cliente HTTP para API Nest.
 * O frontend nao acessa banco diretamente; toda persistencia passa por aqui.
 */

import type {
  CompanyFinancialProfile,
  FinancialEnvironment,
  FinancialMethod,
  FinancialOverview,
  FinancialProfile,
  ValidationAttempt,
} from "./financial-activation";
import type { EfiDraftInput, EfiOnboardingState } from "./efi-onboarding";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

interface ApiErrorBody {
  message?: string | string[];
}

interface ApiClientOptions {
  requireAuth?: boolean;
}

/** Query string from defined values only, so omitted filters are not sent. */
function query(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface BillingRunSummary {
  total: number;
  queued: number;
  skipped: number;
}

export interface BillingResponse {
  success: boolean;
  summary: BillingRunSummary;
  message: string;
}

export type CollectionChannel = "EMAIL" | "WHATSAPP";

export interface SelectedBillingContactInput {
  invoiceId: string;
  email?: string;
  phoneNumber?: string;
  whatsappOptIn?: boolean;
}

export interface RunSelectedBillingInput {
  invoiceIds: string[];
  channels?: CollectionChannel[];
  contacts?: SelectedBillingContactInput[];
}

export interface CreatePaymentInput {
  invoiceId: string;
  billingType?: BillingMethod;
}

export interface CreatePaymentResponse {
  success: boolean;
  invoiceId: string;
  billingType: BillingMethod;
  gateway: "efi";
  gatewayId?: string | null;
  txid?: string | null;
  chargeId?: string | null;
  pixPayload?: string | null;
  pixCopyPaste?: string | null;
  pixExpiresAt?: string | null;
  expiresAt?: string | null;
  boletoCode?: string | null;
  boletoLink?: string | null;
  boletoPdf?: string | null;
  paymentLink?: string | null;
}

export interface PaymentFeeQuote {
  billingMethod: BillingMethod;
  grossAmountCents: number;
  totalFeeCents: number;
  netAmountCents: number;
  feeLabel: string;
}

export interface InvoicePaymentStatusResponse {
  invoiceId: string;
  status: string;
  gateway: "efi";
  gatewayId: string | null;
  txid: string | null;
  chargeId: string | null;
  pixPayload: string | null;
  pixCopyPaste: string | null;
  pixExpiresAt: string | null;
  boletoCode: string | null;
  boletoLink: string | null;
  boletoPdf: string | null;
  gatewayStatusRaw: unknown;
  originalAmount: number | string;
  dueDate: string;
  paidAt: string | null;
  studentName: string | null;
  studentEnrollment: string | null;
  studentGroup: string | null;
}

export interface BillingSettings {
  preferredBillingMethod: BillingMethod;
  enabledBillingMethods: BillingMethod[];
  collectionReminderDays: number[];
  autoGenerateFirstCharge: boolean;
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: number | null;
  autoDiscountPercentage: number | null;
  businessSegment: BusinessSegment;
  paymentNotificationEnabled: boolean;
  paymentNotificationEmails: string[];
  // Company defaults for new charges: percent fine, percent interest per
  // month and days accepting payment after the due date.
  lateFinePercentage: number;
  lateInterestMonthlyPercentage: number;
  paymentDaysAfterDue: number;
  tariffs: Record<
    BillingMethod,
    {
      method: BillingMethod;
      combinedLabel: string;
      configured: boolean;
    }
  >;
}

export interface UpdateBillingSettingsInput {
  preferredBillingMethod: BillingMethod;
  collectionReminderDays: number[];
  autoGenerateFirstCharge: boolean;
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: number | null;
  autoDiscountPercentage: number | null;
  businessSegment?: BusinessSegment;
  paymentNotificationEnabled?: boolean;
  paymentNotificationEmails?: string[];
  lateFinePercentage?: number;
  lateInterestMonthlyPercentage?: number;
  paymentDaysAfterDue?: number;
}

export interface LateTerms {
  late_fine_percentage: number;
  late_interest_monthly_percentage: number;
  payment_days_after_due: number;
}

export type BillingMethod = "PIX" | "BOLETO" | "BOLIX";
export type UserRole = "PLATFORM_ADMIN" | "COMPANY_ADMIN";
export type CompanyStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";
export type BusinessSegment = "GENERAL" | "EDUCATION";
export type WhatsappProvider = "META_CLOUD";
export type WhatsappStatus = "CONNECTED" | "DISCONNECTED" | "PENDING";
export type MessagingLimitTier =
  | "TIER_50"
  | "TIER_250"
  | "TIER_1K"
  | "TIER_10K"
  | "TIER_100K"
  | "TIER_UNLIMITED";
export type PaymentNotificationStatus = "PENDING" | "SENT" | "FAILED" | "READ";
export type RecurringInvoiceStatus = "ACTIVE" | "PAUSED";
export type DashboardPeriod = "today" | "7d" | "30d" | "year";
export type CollectionProfileType = "NEW" | "GOOD" | "DOUBTFUL" | "BAD";
export type PaymentTimeliness = "EARLY" | "ON_DUE_DATE" | "OVERDUE" | "UNKNOWN";

export interface BillingMetrics {
  period: DashboardPeriod;
  activeCharges: number;
  pendingAmount: number;
  recoveredAmount: number;
  recoveryRate: number;
  paidCharges: number;
  overdueCharges: number;
  generatedPayments: number;
  queuedMessages: number;
  sentMessages: number;
}

export interface InvoicePaymentSummary {
  financialSummary?: {
    grossAmountCents: number;
    totalFeeCents: number;
    netAmountCents: number;
    estimated: boolean;
    status: string;
  } | null;
  generated: boolean;
  method: BillingMethod;
  pixCopyPaste: string | null;
  boletoLine: string | null;
  boletoUrl: string | null;
  boletoPdf: string | null;
  paymentLink: string | null;
  expiresAt: string | null;
}

export interface InvoiceListItem {
  id: string;
  invoiceId: string;
  name: string;
  document?: string;
  phone_number: string;
  email?: string;
  original_amount: number;
  due_date: string;
  status?: string;
  debtorId: string;
  whatsapp_opt_in: boolean;
  gatewayId: string | null;
  pixPayload: string | null;
  billing_type: BillingMethod;
  studentName: string | null;
  studentEnrollment: string | null;
  studentGroup: string | null;
  paidAt: string | null;
  payment: InvoicePaymentSummary;
  lateTerms?: LateTerms;
  createdAt: string;
  recurrence?: {
    recurrenceId: string;
    period: string;
    dueDay: number;
    status: RecurringInvoiceStatus;
  };
  collectionProfile?: {
    id: string;
    name: string;
    profileType: CollectionProfileType;
  } | null;
}

export interface CreateInvoiceInput {
  debtorId?: string;
  name?: string;
  document?: string;
  phone_number?: string;
  email?: string;
  whatsappOptIn?: boolean;
  original_amount: number;
  due_date?: string;
  billing_type: BillingMethod;
  recurring?: boolean;
  due_day?: number;
  studentName?: string;
  studentEnrollment?: string;
  studentGroup?: string;
  // Empty (null/absent) uses the company default; zero means none.
  late_fine_percentage?: number | null;
  late_interest_monthly_percentage?: number | null;
  payment_days_after_due?: number | null;
}

export interface RecurringInvoice {
  recurrenceId: string;
  debtor: {
    debtorId: string;
    name: string;
    document?: string;
    phone_number: string;
    email?: string;
  };
  amount: number;
  billingType: BillingMethod;
  dueDay: number;
  status: RecurringInvoiceStatus;
  lateTerms?: LateTerms;
  nextDueDate: string | null;
  lastGeneratedPeriod: string | null;
  pendingInvoice: {
    invoiceId: string;
    dueDate: string;
    amount: number;
    status: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateRecurringInvoiceInput {
  amount: number;
  billingType: BillingMethod;
  dueDay: number;
  lateFinePercentage?: number;
  lateInterestMonthlyPercentage?: number;
  paymentDaysAfterDue?: number;
}

export interface PaymentNotificationItem {
  id: string;
  invoiceId: string;
  status: PaymentNotificationStatus;
  recipientEmails: string[];
  errorMessage: string | null;
  debtorName: string;
  debtorEmail: string | null;
  amount: number;
  billingType: string;
  dueDate: string;
  paidAt: string | null;
  studentName: string | null;
  studentEnrollment: string | null;
  studentGroup: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
  summary: unknown;
}

export interface PaymentNotificationListResponse {
  data: PaymentNotificationItem[];
  unreadCount: number;
}

export type DebtorPaymentStatusFilter = "all" | "open" | "paid" | "no_open";

export interface DebtorCollectionProfile {
  id: string;
  name: string;
  profileType: CollectionProfileType;
}

export interface DebtorListItem {
  debtorId: string;
  name: string;
  document: string;
  phone_number: string;
  email: string | null;
  whatsapp_opt_in: boolean;
  whatsappOptInAt: string | null;
  collectionProfile: DebtorCollectionProfile;
  openInvoicesCount: number;
  openInvoicesAmount: number;
  paidInvoicesCount: number;
  paidInvoicesAmount: number;
  lastInvoiceAt: string | null;
  lastPaymentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DebtorListSummary {
  totalDebtors: number;
  openInvoiceAmount: number;
  openInvoiceCount: number;
  paidInvoiceAmount: number;
  paidInvoiceCount: number;
}

export interface DebtorListResponse {
  data: DebtorListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: DebtorListSummary;
}

export interface CreateDebtorInput {
  name: string;
  document: string;
  phone_number: string;
  email?: string | null;
  whatsappOptIn?: boolean;
  collectionProfileId?: string;
}

export interface UpdateDebtorInput {
  name?: string;
  document?: string;
  phone_number?: string;
  email?: string | null;
  whatsappOptIn?: boolean;
  collectionProfileId?: string;
}

export interface DebtorBillingSettings {
  debtorId: string;
  debtorName: string;
  document: string | null;
  whatsappOptIn: boolean;
  whatsappOptInAt: string | null;
  whatsappOptInSource: string | null;
  collectionProfile: {
    id: string;
    name: string;
    profileType: CollectionProfileType;
  } | null;
  useGlobalBillingSettings: boolean;
  customPreferredBillingMethod: BillingMethod | null;
  customCollectionReminderDays: number[];
  customAutoGenerateFirstCharge: boolean | null;
  customAutoDiscountEnabled: boolean | null;
  customAutoDiscountDaysAfterDue: number | null;
  customAutoDiscountPercentage: number | null;
  globalSettings: BillingSettings;
  effectiveSettings: BillingSettings;
  updatedAt: string;
}

export interface DebtorPaymentHistoryItem {
  invoiceId: string;
  amount: number;
  billingType: string;
  dueDate: string;
  paidAt: string | null;
  paidDate: string | null;
  paidOnOrBeforeDueDate: boolean | null;
  timeliness: PaymentTimeliness;
  daysFromDueDate: number | null;
  daysAfterDue: number | null;
  daysBeforeDue: number | null;
  gatewayId: string | null;
  studentName: string | null;
  studentEnrollment: string | null;
  studentGroup: string | null;
}

export interface DebtorPaymentHistoryResponse {
  debtor: {
    debtorId: string;
    name: string;
    phone_number: string;
    email?: string;
  };
  summary: {
    totalPaidInvoices: number;
    totalPaidAmount: number;
    paidOnOrBeforeDueDate: number;
    paidEarly: number;
    paidOnDueDate: number;
    paidOverdue: number;
    unknownTiming: number;
    averageDaysAfterDue: number;
    maxDaysAfterDue: number;
    lastPaymentAt: string | null;
  };
  payments: DebtorPaymentHistoryItem[];
}

export interface UpdateDebtorBillingSettingsInput {
  document?: string | null;
  useGlobalBillingSettings?: boolean;
  whatsappOptIn?: boolean;
  preferredBillingMethod?: BillingMethod | null;
  collectionReminderDays?: number[] | null;
  autoGenerateFirstCharge?: boolean | null;
  autoDiscountEnabled?: boolean | null;
  autoDiscountDaysAfterDue?: number | null;
  autoDiscountPercentage?: number | null;
  collectionProfileId?: string | null;
}

export interface WhatsAppUsageResponse {
  tier: string;
  dailyLimit: number;
  dailyUsage: number;
  remaining: number;
  interactions: {
    outbound: number;
    delivered: number;
    read: number;
    inbound: number;
    failed: number;
  };
}

export interface CollectionRuleStep {
  id: string;
  profileId: string;
  stepOrder: number;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string | null;
  template?: { id: string; name: string } | null;
  delayDays: number;
  sendTimeStart: string | null;
  sendTimeEnd: string | null;
  isActive: boolean;
}

export interface CollectionRuleProfile {
  id: string;
  companyId: string;
  name: string;
  profileType: CollectionProfileType;
  isDefault: boolean;
  isActive: boolean;
  daysOverdueMin: number | null;
  daysOverdueMax: number | null;
  steps: CollectionRuleStep[];
  _count?: { debtors: number };
  createdAt: string;
  updatedAt: string;
}

export interface CollectionAttempt {
  id: string;
  channel: "EMAIL" | "WHATSAPP";
  status: string;
  externalMessageId: string | null;
  errorDetails: string | null;
  createdAt: string;
  ruleStep?: {
    stepOrder: number;
    channel: string;
    delayDays: number;
  } | null;
}

export type ConversationStatus = "NEW" | "IN_PROGRESS" | "CLOSED";

export type CommunicationChannel = "WHATSAPP" | "EMAIL";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface InvoiceSummary {
  id: string;
  dueDate: string;
  originalAmount: string | number;
  status: string;
}

export interface MessageAttachmentSummary {
  id: string;
  contentType: string | null;
  sizeBytes: number | null;
  state: "PENDING" | "READY" | "UNAVAILABLE" | "EXPIRED";
  /** Local reason when unavailable (e.g. FILE_TOO_LARGE); never provider text. */
  errorCode?: string | null;
}

/** Message as a company sees it: only its own context, no provider IDs. */
export interface ConversationMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  messageType: string | null;
  status: string | null;
  createdAt: string;
  invoice: InvoiceSummary | null;
  debtor: { id: string; name: string } | null;
  attachments: MessageAttachmentSummary[];
  replyTo?: { id: string; direction: string; excerpt: string } | null;
}

export interface TenantContact {
  name: string | null;
  address: string | null;
}

export interface CompanyConversation {
  id: string;
  channel: CommunicationChannel;
  contact: TenantContact;
  lastMessageAt: string;
  messageCount: number;
  lastMessage: {
    direction: string;
    preview: string;
    status: string | null;
    messageType: string | null;
  } | null;
}

export interface CompanyConversationMessages extends CursorPage<ConversationMessage> {
  conversation: {
    id: string;
    channel: CommunicationChannel;
    contact: TenantContact;
  };
}

export type AttributionMethod =
  | "UNASSIGNED"
  | "OUTBOUND_CONTEXT"
  | "REPLY_CONTEXT"
  | "INTERACTIVE_CONTEXT"
  | "MANUAL";

export interface AdminConversationMessage extends ConversationMessage {
  companyId: string | null;
  invoiceId: string | null;
  debtorId: string | null;
  company: { id: string; corporateName: string; tradeName: string | null } | null;
  externalMessageId: string | null;
  replyToMessageId: string | null;
  source: "LEGACY" | "LIVE" | "IMPORTED";
  attributionMethod: AttributionMethod | null;
  attributionRevision: number;
  outboundIntent: { state: string; lastErrorCode: string | null } | null;
  readAt: string | null;
}

export interface AdminConversationSummary {
  id: string;
  channel: CommunicationChannel;
  recipient: string | null;
  status: ConversationStatus;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  serviceWindowExpiresAt: string | null;
  updatedAt: string;
  unclassifiedCount: number;
}

export interface AdminConversationDetail {
  id: string;
  channel: CommunicationChannel;
  recipient: string | null;
  status: ConversationStatus;
  unreadCount: number;
  lastInboundAt: string | null;
  serviceWindowExpiresAt: string | null;
  updatedAt: string;
  /** Oldest first; `nextCursor` loads older messages. */
  messages: AdminConversationMessage[];
  nextCursor: string | null;
}

/** `companyId: null` means the message stays with the platform team only. */
export interface MessageContextInput {
  companyId: string | null;
  invoiceId?: string;
  debtorId?: string;
}

export interface ContextOption {
  company: { id: string; name: string };
  debtor: { id: string; name: string } | null;
  invoices: InvoiceSummary[];
}

export interface QueuedReply {
  id: string;
  status: string;
  externalMessageId: string | null;
}

export interface MessageTemplate {
  id: string;
  name: string;
  slug: string;
  content: string;
  footerText: string | null;
  paymentButtonEnabled: boolean;
  paymentButtonLabel: string;
  copyCodeButtonEnabled: boolean;
  copyCodeSource: MessageTemplateCopyCodeSource;
  isActive: boolean;
  metaTemplateName: string | null;
  metaLanguage: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  metaStatus: string;
  metaRejectedReason: string | null;
  lastMetaSyncAt: string | null;
  /** Provider changed content or category; not sent until the admin concludes the review. */
  metaReviewRequired?: boolean;
  metaQuality?: string | null;
  metaProviderCategory?: string | null;
  greeting?: string;
  instructions?: string;
  signature?: string;
  companyId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  slug: string;
  subject: string;
  content: string;
  isActive: boolean;
  resendTemplateId: string | null;
  resendAlias: string | null;
  resendStatus: string;
  resendPublishedAt: string | null;
  lastResendSyncAt: string | null;
  resendError: string | null;
  greeting: string;
  instructions: string;
  signature: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageTemplateCopyCodeSource =
  "AUTO" | "PIX_COPY_PASTE" | "BOLETO_LINE_DIGITABLE";

export type MessageTemplateSlug =
  | "cobranca-emissao"
  | "vencimento-hoje"
  | "pre-vencimento"
  | "atraso-primeiro-aviso"
  | "atraso-recorrente"
  | "atraso-critico";

export interface SaveMessageTemplateInput {
  isActive?: boolean;
  greeting?: string;
  instructions?: string;
  signature?: string;
}

export interface SaveEmailTemplateInput {
  isActive?: boolean;
  greeting?: string;
  instructions?: string;
  signature?: string;
}

export interface GatewayAccountInput {
  corporateName: string;
  cnpj: string;
  email: string;
  phoneNumber: string;
  legalRepresentative: string;
  legalRepresentativeCpf: string;
  legalRepresentativeBirthDate: string;
  postalCode: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  bankAccountDigit: string;
  bankAccountType: "CHECKING" | "SAVINGS";
  environment: "homologation" | "production";
  efiClientId: string;
  efiClientSecret: string;
  efiPayeeCode: string;
  efiAccountNumber: string;
  efiAccountDigit: string;
  efiPixKey: string;
  efiCertificatePath: string;
  efiCertificatePassword: string;
  efiCertificateBase64?: string;
  gatewayStatus: "PENDING" | "ACTIVE" | "REJECTED" | "DISABLED";
}

export interface GatewayAccountStatus {
  provider: string;
  accountId: string | null;
  environment: string | null;
  status: string;
  hasApiKey: boolean;
  company: {
    corporateName: string;
    cnpj: string;
    email: string;
    phoneNumber: string;
  };
  legalRepresentative: {
    name: string | null;
    cpf: string | null;
    birthDate: string | null;
  };
  address: {
    postalCode: string | null;
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
  };
  bank: {
    name: string | null;
    agency: string | null;
    account: string | null;
    accountDigit: string | null;
    accountType: string | null;
    holderName: string | null;
    holderDocument: string | null;
  };
  efi: {
    payeeCode: string | null;
    accountNumber: string | null;
    accountDigit: string | null;
    pixKey: string | null;
    hasCertificate: boolean;
  };
}

export interface AdminClient {
  id: string;
  corporateName: string;
  document: string;
  email: string;
  phoneNumber: string;
  status: CompanyStatus;
  gatewayProvider?: string;
  enabledBillingMethods: BillingMethod[];
  preferredBillingMethod: BillingMethod;
  maxDiscountsPerDebtor?: number;
  discountTriggerDay?: number;
  collectionReminderDays?: number[];
  autoGenerateFirstCharge?: boolean;
  autoDiscountEnabled?: boolean;
  autoDiscountDaysAfterDue?: number | null;
  autoDiscountPercentage?: number | null;
  businessSegment?: BusinessSegment;
  paymentNotificationEnabled?: boolean;
  paymentNotificationEmails?: string[];
  gatewayStatus: string;
  legalRepresentative?: string | null;
  legalRepresentativeCpf?: string | null;
  legalRepresentativeBirthDate?: string | null;
  addressPostalCode?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressDistrict?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  bankName?: string | null;
  bankAgency?: string | null;
  bankAccount?: string | null;
  whatsappProvider?: WhatsappProvider;
  whatsappInstanceId?: string | null;
  whatsappStatus: string;
  metaPhoneNumberId?: string | null;
  metaBusinessAccountId?: string | null;
  metaBusinessPhoneNumber?: string | null;
  metaDefaultLanguage?: string;
  messagingLimitTier?: MessagingLimitTier | null;
  messagingLimitUpdatedAt?: string | null;
  resendFromEmail?: string | null;
  erpWebhookUrl?: string | null;
  erpEnabledEvents?: string[];
  hasMetaAccessToken?: boolean;
  hasResendApiKey?: boolean;
  hasResendWebhookSecret?: boolean;
  hasErpApiKey?: boolean;
  hasEfiClientId?: boolean;
  hasEfiClientSecret?: boolean;
  hasEfiCertificate?: boolean;
  hasEfiCertificatePassword?: boolean;
  firstUser: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
  } | null;
  efi: {
    configured: boolean;
    provider?: string | null;
    status: string | null;
    environment: string | null;
    payeeCode?: string | null;
    accountNumber?: string | null;
    accountDigit?: string | null;
    pixKey?: string | null;
    certificatePath?: string | null;
    lastError?: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export type AdminAnalyticsPeriod =
  "current_month" | "today" | "7d" | "30d" | "year" | "custom";

export interface AdminClientAnalyticsMetrics {
  totalChargedAmount: number;
  activeChargesCount: number;
  overduePendingChargesCount: number;
  canceledChargesCount: number;
  pendingTotalAmount: number;
  overduePendingAmount: number;
  whatsappSentCount: number;
  whatsappCostAmount: number;
  emailSentCount: number;
  emailCostAmount: number;
  averageTicketAmount: number;
  recoveredChargesCount: number;
  recoveredAmount: number;
}

export interface AdminClientAnalyticsRow {
  companyId: string;
  corporateName: string;
  document: string;
  email: string;
  status: CompanyStatus;
  metrics: AdminClientAnalyticsMetrics;
}

export interface AdminClientAnalyticsResponse {
  period: {
    key: AdminAnalyticsPeriod;
    startDate: string;
    endDate: string;
  };
  totals: AdminClientAnalyticsMetrics;
  clients: AdminClientAnalyticsRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface AdminClientAnalyticsParams {
  period?: AdminAnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  companyId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateAdminClientInput {
  company: {
    corporateName: string;
    document: string;
    email: string;
    phoneNumber: string;
    status?: CompanyStatus;
  };
  firstUser: {
    name: string;
    email: string;
  };
  billing: {
    enabledBillingMethods: BillingMethod[];
    preferredBillingMethod: BillingMethod;
  };
  efi?: GatewayAccountInput;
  integrations?: {
    resendApiKey?: string;
    resendWebhookSecret?: string;
    resendFromEmail?: string | null;
    erpApiKey?: string;
    erpWebhookUrl?: string | null;
    erpEnabledEvents?: string[];
  };
}

export interface MessageResponse {
  message: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
  passwordConfirmation: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  password: string;
  passwordConfirmation: string;
}

export interface CreateAdminClientResponse {
  client: AdminClient;
  temporaryPassword: string;
  integrationWarnings: string[];
}

export interface UpdateAdminClientInput {
  company?: {
    corporateName?: string;
    document?: string;
    email?: string;
    phoneNumber?: string;
    status?: CompanyStatus;
    gatewayProvider?: string;
    gatewayStatus?: string;
    legalRepresentative?: string | null;
    legalRepresentativeCpf?: string | null;
    legalRepresentativeBirthDate?: string | null;
    addressPostalCode?: string | null;
    addressStreet?: string | null;
    addressNumber?: string | null;
    addressDistrict?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
    bankName?: string | null;
    bankAgency?: string | null;
    bankAccount?: string | null;
  };
  billing?: {
    enabledBillingMethods?: BillingMethod[];
    preferredBillingMethod?: BillingMethod;
    maxDiscountsPerDebtor?: number;
    discountTriggerDay?: number;
    collectionReminderDays?: number[];
    autoGenerateFirstCharge?: boolean;
    autoDiscountEnabled?: boolean;
    autoDiscountDaysAfterDue?: number | null;
    autoDiscountPercentage?: number | null;
  };
  notifications?: {
    businessSegment?: BusinessSegment;
    paymentNotificationEnabled?: boolean;
    paymentNotificationEmails?: string[];
  };
  whatsapp?: {
    whatsappProvider?: WhatsappProvider;
    whatsappInstanceId?: string | null;
    whatsappStatus?: WhatsappStatus;
    metaPhoneNumberId?: string | null;
    metaBusinessAccountId?: string | null;
    metaBusinessPhoneNumber?: string | null;
    metaDefaultLanguage?: string;
    messagingLimitTier?: MessagingLimitTier | null;
  };
  integrations?: {
    resendApiKey?: string;
    resendWebhookSecret?: string;
    resendFromEmail?: string | null;
    erpApiKey?: string;
    erpWebhookUrl?: string | null;
    erpEnabledEvents?: string[];
  };
  efi?: Partial<GatewayAccountInput>;
}

function normalizeGatewayAccountPayload<T extends Partial<GatewayAccountInput>>(
  data: T,
): T {
  return {
    ...data,
    efiCertificatePath: data.efiCertificateBase64
      ? ""
      : data.efiCertificatePath,
    efiCertificateBase64: data.efiCertificateBase64 || undefined,
  };
}

function normalizeCreateAdminClientPayload(
  data: CreateAdminClientInput,
): CreateAdminClientInput {
  if (!data.efi) {
    return data;
  }

  return {
    ...data,
    efi: normalizeGatewayAccountPayload(data.efi),
  };
}

function normalizeUpdateAdminClientPayload(
  data: UpdateAdminClientInput,
): UpdateAdminClientInput {
  if (!data.efi) {
    return data;
  }

  return {
    ...data,
    efi: normalizeGatewayAccountPayload(data.efi),
  };
}

class ApiClient {
  getEfiOnboarding(): Promise<EfiOnboardingState> {
    return this.fetch("/onboarding/efi");
  }
  saveEfiDraft(input: EfiDraftInput): Promise<EfiOnboardingState> {
    return this.fetch("/onboarding/efi/draft", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }
  submitEfiOnboarding(retry = false): Promise<EfiOnboardingState> {
    return this.fetch(`/onboarding/efi/${retry ? "retry" : "submit"}`, {
      method: "POST",
    });
  }
  getFinancialProfile(): Promise<CompanyFinancialProfile> {
    return this.fetch("/financial-profile");
  }
  getFinancialOverview(companyId: string): Promise<FinancialOverview> {
    return this.fetch(
      `/admin/companies/${encodeURIComponent(companyId)}/financial-profile`,
    );
  }
  createFinancialActivation(
    companyId: string,
    input: {
      idempotencyKey: string;
      environment: FinancialEnvironment;
      enabledMethods: FinancialMethod[];
    },
  ): Promise<FinancialProfile> {
    return this.fetch(
      `/admin/companies/${encodeURIComponent(companyId)}/financial-activations`,
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          accountMode: "CUSTOMER_ACCOUNT",
          payoutMode: "DIRECT_TO_CUSTOMER",
        }),
      },
    );
  }
  getFinancialActivation(id: string): Promise<FinancialProfile> {
    return this.fetch(`/admin/financial-activations/${encodeURIComponent(id)}`);
  }
  updateFinancialConfiguration(
    id: string,
    input: Record<string, unknown>,
  ): Promise<FinancialProfile> {
    return this.fetch(
      `/admin/financial-activations/${encodeURIComponent(id)}/configuration`,
      { method: "PUT", body: JSON.stringify(input) },
    );
  }
  /** Multipart upload; the browser sets the boundary. */
  uploadFinancialCredentials(
    id: string,
    form: FormData,
  ): Promise<FinancialProfile> {
    return this.fetch(
      `/admin/financial-activations/${encodeURIComponent(id)}/credentials`,
      { method: "PUT", body: form },
    );
  }
  requestFinancialValidation(
    id: string,
    input: { expectedRevision: number; idempotencyKey: string },
  ): Promise<ValidationAttempt> {
    return this.fetch(
      `/admin/financial-activations/${encodeURIComponent(id)}/validate`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }
  activateFinancialProfile(
    id: string,
    input: {
      expectedRevision: number;
      validationAttemptId: string;
      idempotencyKey: string;
      confirmEffects: true;
      acknowledgeUnverifiedSteps: boolean;
    },
  ): Promise<FinancialProfile> {
    return this.fetch(
      `/admin/financial-activations/${encodeURIComponent(id)}/activate`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }
  cancelFinancialActivation(
    id: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<FinancialProfile> {
    return this.fetch(
      `/admin/financial-activations/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }
  financialAdmin<T>(
    path: string,
    method: "GET" | "POST" | "PUT" | "PATCH" = "GET",
    body?: unknown,
  ): Promise<T> {
    return this.fetch(path, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  private baseUrl: string;
  private token: string | null;
  private requireAuth: boolean;

  constructor(
    baseUrl: string = API_URL,
    token: string | null = null,
    options: ApiClientOptions = {},
  ) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.requireAuth = options.requireAuth ?? false;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private getAuthHeader(): string | null {
    return this.token;
  }

  private buildQueryString(
    params: Record<string, string | number | undefined>,
  ): string {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === "") {
        return;
      }

      searchParams.set(key, String(value));
    });

    const query = searchParams.toString();
    return query ? `?${query}` : "";
  }

  private buildMissingAuthError(): ApiError {
    const error: ApiError = new Error(
      "Sessao autenticada ainda nao carregada.",
    );
    error.status = 401;
    error.data = { message: error.message };
    return error;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await this.send(endpoint, options);

    if (response.status === 204) {
      return null as T;
    }

    return response.json() as Promise<T>;
  }

  /** Authenticated request; a non-2xx response becomes an ApiError with status and body. */
  private async send(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    const token = this.getAuthHeader();

    if (this.requireAuth && !token) {
      throw this.buildMissingAuthError();
    }

    const headers: Record<string, string> = {
      // FormData needs the browser-generated multipart boundary.
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.headers as Record<string, string> | undefined),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      // Read once: a failed json() would leave the body consumed for text().
      const text = await response.text().catch(() => "");
      let data: unknown = text;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        /* keep the text body */
      }

      const errorBody = (data ?? {}) as ApiErrorBody;
      const errorMessage =
        errorBody.message ||
        `API Error: ${response.status} ${response.statusText}`;

      const error: ApiError = new Error(
        Array.isArray(errorMessage) ? errorMessage[0] : errorMessage,
      );

      error.status = response.status;
      error.data = data;
      throw error;
    }

    return response;
  }

  /** Attachment bytes through the authenticated API; the provider URL never reaches the browser. */
  async fetchAttachment(
    messageId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const response = await this.send(
      `/communications/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { signal, cache: "no-store" },
    );
    return response.blob();
  }

  // Auth
  async login(email: string, password: string): Promise<unknown> {
    return this.fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async forgotPassword(email: string): Promise<MessageResponse> {
    return this.fetch<MessageResponse>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(data: ResetPasswordInput): Promise<MessageResponse> {
    return this.fetch<MessageResponse>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async changePassword(data: ChangePasswordInput): Promise<MessageResponse> {
    return this.fetch<MessageResponse>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async logout(): Promise<unknown> {
    return this.fetch("/auth/logout", {
      method: "POST",
    });
  }

  async getSession(): Promise<unknown> {
    return this.fetch("/auth/session", {
      method: "POST",
    });
  }

  // Invoices
  async getInvoices(
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      status?: string;
      debtorId?: string;
    } = {},
  ): Promise<{
    data: InvoiceListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.search) qs.set("search", params.search);
    if (params.status) qs.set("status", params.status);
    if (params.debtorId) qs.set("debtorId", params.debtorId);

    const qsStr = qs.toString();
    return this.fetch<{
      data: InvoiceListItem[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/invoices${qsStr ? `?${qsStr}` : ""}`);
  }

  async importInvoices(data: ReadonlyArray<unknown>): Promise<unknown> {
    return this.fetch("/invoices/import", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createInvoice(data: CreateInvoiceInput): Promise<InvoiceListItem> {
    return this.fetch<InvoiceListItem>("/invoices", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async cancelInvoice(invoiceId: string): Promise<InvoiceListItem> {
    return this.fetch<InvoiceListItem>(`/invoices/${invoiceId}/cancel`, {
      method: "POST",
    });
  }

  async createDebtorInvoice(
    debtorId: string,
    data: Omit<
      CreateInvoiceInput,
      "debtorId" | "name" | "document" | "phone_number" | "email"
    >,
  ): Promise<InvoiceListItem> {
    return this.fetch<InvoiceListItem>(
      `/invoices/debtors/${debtorId}/invoices`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  async getDebtors(
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      profileId?: string;
      paymentStatus?: DebtorPaymentStatusFilter;
    } = {},
  ): Promise<DebtorListResponse> {
    return this.fetch<DebtorListResponse>(
      `/invoices/debtors${this.buildQueryString(params)}`,
    );
  }

  async createDebtor(data: CreateDebtorInput): Promise<DebtorListItem> {
    return this.fetch<DebtorListItem>("/invoices/debtors", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDebtor(
    debtorId: string,
    data: UpdateDebtorInput,
  ): Promise<DebtorListItem> {
    return this.fetch<DebtorListItem>(`/invoices/debtors/${debtorId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getRecurringInvoices(): Promise<RecurringInvoice[]> {
    return this.fetch<RecurringInvoice[]>("/invoices/recurring");
  }

  async updateRecurringInvoice(
    recurrenceId: string,
    data: UpdateRecurringInvoiceInput,
  ): Promise<RecurringInvoice> {
    return this.fetch<RecurringInvoice>(`/invoices/recurring/${recurrenceId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async pauseRecurringInvoice(recurrenceId: string): Promise<RecurringInvoice> {
    return this.fetch<RecurringInvoice>(
      `/invoices/recurring/${recurrenceId}/pause`,
      { method: "POST" },
    );
  }

  async activateRecurringInvoice(
    recurrenceId: string,
  ): Promise<RecurringInvoice> {
    return this.fetch<RecurringInvoice>(
      `/invoices/recurring/${recurrenceId}/activate`,
      { method: "POST" },
    );
  }

  // WhatsApp (canal central Datafy, administrado pela plataforma)
  async getWhatsappUsage(): Promise<WhatsAppUsageResponse> {
    return this.fetch<WhatsAppUsageResponse>("/whatsapp/usage");
  }

  // Email
  async getEmailStats(period: string = "30d"): Promise<{
    period: string;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    failed: number;
  }> {
    return this.fetch(`/email/stats?period=${period}`);
  }

  // Billing
  async runBilling(): Promise<BillingResponse> {
    return this.fetch<BillingResponse>("/billing/run", {
      method: "POST",
    });
  }

  async runSelectedBilling(
    input: string[] | RunSelectedBillingInput,
  ): Promise<BillingResponse> {
    const payload = Array.isArray(input) ? { invoiceIds: input } : input;

    return this.fetch<BillingResponse>("/billing/invoices/run", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async createPayment(
    data: CreatePaymentInput,
  ): Promise<CreatePaymentResponse> {
    return this.fetch<CreatePaymentResponse>("/payments/create", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getPaymentFeeQuote(
    billingMethod: BillingMethod,
    amountCents: number,
  ): Promise<PaymentFeeQuote> {
    const query = new URLSearchParams({
      billingMethod,
      amountCents: String(amountCents),
    });
    return this.fetch<PaymentFeeQuote>(`/payments/fees?${query.toString()}`);
  }

  async replaceExpiredPayment(
    invoiceId: string,
    dueDate: string,
  ): Promise<CreatePaymentResponse> {
    return this.fetch<CreatePaymentResponse>(
      `/payments/invoice/${invoiceId}/replace`,
      { method: "POST", body: JSON.stringify({ dueDate }) },
    );
  }

  async getInvoicePaymentStatus(
    invoiceId: string,
  ): Promise<InvoicePaymentStatusResponse> {
    return this.fetch<InvoicePaymentStatusResponse>(
      `/payments/invoice/${invoiceId}`,
    );
  }

  async getBillingMetrics(period: DashboardPeriod): Promise<BillingMetrics> {
    return this.fetch<BillingMetrics>(`/billing/metrics?period=${period}`);
  }

  async getBillingSettings(): Promise<BillingSettings> {
    return this.fetch<BillingSettings>("/billing/settings");
  }

  // Collection Rules
  async getRules(): Promise<CollectionRuleProfile[]> {
    return this.fetch<CollectionRuleProfile[]>("/billing/rules");
  }

  async createRule(data: {
    name: string;
    profileType: CollectionProfileType;
    isDefault?: boolean;
    daysOverdueMin?: number;
    daysOverdueMax?: number;
  }): Promise<CollectionRuleProfile> {
    return this.fetch<CollectionRuleProfile>("/billing/rules", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateRule(
    profileId: string,
    data: {
      name?: string;
      profileType?: CollectionProfileType;
      isDefault?: boolean;
      daysOverdueMin?: number;
      daysOverdueMax?: number;
    },
  ): Promise<CollectionRuleProfile> {
    return this.fetch<CollectionRuleProfile>(`/billing/rules/${profileId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteRule(profileId: string): Promise<unknown> {
    return this.fetch(`/billing/rules/${profileId}`, {
      method: "DELETE",
    });
  }

  async setRuleSteps(
    profileId: string,
    steps: Array<{
      stepOrder: number;
      channel: "EMAIL" | "WHATSAPP";
      templateId?: string;
      delayDays: number;
      sendTimeStart?: string;
      sendTimeEnd?: string;
    }>,
  ): Promise<CollectionRuleStep[]> {
    return this.fetch<CollectionRuleStep[]>(
      `/billing/rules/${profileId}/steps`,
      {
        method: "PUT",
        body: JSON.stringify({ steps }),
      },
    );
  }

  async classifyDebtors(): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>("/billing/classify-debtors", {
      method: "POST",
    });
  }

  // Conversations. Company routes are scoped by the session on the server.
  async listCompanyConversations(
    params: { cursor?: string; limit?: number; channel?: CommunicationChannel },
    signal?: AbortSignal,
  ): Promise<CursorPage<CompanyConversation>> {
    return this.fetch(`/communications/conversations${query(params)}`, {
      signal,
    });
  }

  async listCompanyConversationMessages(
    conversationId: string,
    params: { cursor?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<CompanyConversationMessages> {
    return this.fetch(
      `/communications/conversations/${encodeURIComponent(conversationId)}/messages${query(params)}`,
      { signal },
    );
  }

  async listAdminConversations(
    params: {
      page?: number;
      pageSize?: number;
      channel?: CommunicationChannel;
      status?: ConversationStatus;
      companyId?: string;
      pendingClassification?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<{ items: AdminConversationSummary[]; total: number }> {
    return this.fetch(`/communications/admin/conversations${query(params)}`, {
      signal,
    });
  }

  async getAdminConversation(
    conversationId: string,
    params: { cursor?: string; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<AdminConversationDetail> {
    return this.fetch(
      `/communications/admin/conversations/${encodeURIComponent(conversationId)}${query(params)}`,
      { signal },
    );
  }

  async getConversationContextOptions(
    conversationId: string,
  ): Promise<{ options: ContextOption[] }> {
    return this.fetch(
      `/communications/admin/conversations/${encodeURIComponent(conversationId)}/context-options`,
    );
  }

  async updateAdminConversationStatus(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<{ id: string; status: ConversationStatus }> {
    return this.fetch(
      `/communications/admin/conversations/${encodeURIComponent(conversationId)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
  }

  async attributeMessage(
    messageId: string,
    data: {
      expectedRevision: number;
      context: MessageContextInput;
      reason: string;
    },
  ): Promise<{ messageId: string; revision: number }> {
    return this.fetch(
      `/communications/admin/messages/${encodeURIComponent(messageId)}/attribution`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
  }

  async replyToAdminConversation(
    conversationId: string,
    data: {
      idempotencyId: string;
      content: string;
      context?: MessageContextInput;
      replyToMessageId?: string;
    },
  ): Promise<QueuedReply> {
    return this.fetch(
      `/communications/admin/conversations/${encodeURIComponent(conversationId)}/replies`,
      { method: "POST", body: JSON.stringify(data) },
    );
  }

  async replyWithTemplate(
    conversationId: string,
    data: {
      idempotencyId: string;
      templateId: string;
      parameters: string[];
      context?: MessageContextInput;
    },
  ): Promise<QueuedReply> {
    return this.fetch(
      `/communications/admin/conversations/${encodeURIComponent(conversationId)}/template-replies`,
      { method: "POST", body: JSON.stringify(data) },
    );
  }

  async getInvoiceAttempts(invoiceId: string): Promise<CollectionAttempt[]> {
    return this.fetch<CollectionAttempt[]>(`/invoices/${invoiceId}/attempts`);
  }

  async updateBillingSettings(
    data: UpdateBillingSettingsInput,
  ): Promise<BillingSettings> {
    return this.fetch<BillingSettings>("/billing/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getPaymentNotifications(): Promise<PaymentNotificationListResponse> {
    return this.fetch<PaymentNotificationListResponse>(
      "/payment-notifications",
    );
  }

  async markPaymentNotificationAsRead(
    notificationId: string,
  ): Promise<PaymentNotificationItem> {
    return this.fetch<PaymentNotificationItem>(
      `/payment-notifications/${notificationId}/read`,
      { method: "POST" },
    );
  }

  async getDebtorBillingSettings(
    debtorId: string,
  ): Promise<DebtorBillingSettings> {
    return this.fetch<DebtorBillingSettings>(
      `/invoices/debtors/${debtorId}/settings`,
    );
  }

  async getDebtorPaymentHistory(
    debtorId: string,
  ): Promise<DebtorPaymentHistoryResponse> {
    return this.fetch<DebtorPaymentHistoryResponse>(
      `/invoices/debtors/${debtorId}/payment-history`,
    );
  }

  async updateDebtorBillingSettings(
    debtorId: string,
    data: UpdateDebtorBillingSettingsInput,
  ): Promise<DebtorBillingSettings> {
    return this.fetch<DebtorBillingSettings>(
      `/invoices/debtors/${debtorId}/settings`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
  }

  // Templates
  async getTemplates(): Promise<MessageTemplate[]> {
    return this.fetch<MessageTemplate[]>("/templates");
  }

  async createTemplate(
    data: SaveMessageTemplateInput,
  ): Promise<MessageTemplate> {
    return this.fetch<MessageTemplate>("/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTemplate(
    id: string,
    data: Partial<SaveMessageTemplateInput>,
  ): Promise<MessageTemplate> {
    return this.fetch<MessageTemplate>(`/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async submitTemplateToMeta(
    id: string,
  ): Promise<{ template: MessageTemplate; meta: unknown }> {
    return this.fetch<{ template: MessageTemplate; meta: unknown }>(
      `/templates/${id}/submit-meta`,
      { method: "POST" },
    );
  }

  /** Re-reads the provider version; released only when it matches the local template. */
  async confirmTemplateReview(id: string): Promise<MessageTemplate> {
    return this.fetch<MessageTemplate>(
      `/templates/${encodeURIComponent(id)}/review`,
      { method: "POST" },
    );
  }

  async syncTemplateMetaStatuses(): Promise<MessageTemplate[]> {
    return this.fetch<MessageTemplate[]>("/templates/sync-meta", {
      method: "POST",
    });
  }

  async getEmailTemplates(): Promise<EmailTemplate[]> {
    return this.fetch<EmailTemplate[]>("/email/templates");
  }

  async createEmailTemplate(
    data: SaveEmailTemplateInput,
  ): Promise<EmailTemplate> {
    return this.fetch<EmailTemplate>("/email/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateEmailTemplate(
    id: string,
    data: Partial<SaveEmailTemplateInput>,
  ): Promise<EmailTemplate> {
    return this.fetch<EmailTemplate>(`/email/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteEmailTemplate(id: string): Promise<void> {
    await this.fetch<void>(`/email/templates/${id}`, {
      method: "DELETE",
    });
  }

  // Payment gateway
  async getGatewayAccount(): Promise<GatewayAccountStatus> {
    return this.fetch<GatewayAccountStatus>("/payments/gateway-account");
  }

  async createGatewayAccount(
    data: GatewayAccountInput,
  ): Promise<GatewayAccountStatus> {
    const payload = normalizeGatewayAccountPayload(data);

    return this.fetch<GatewayAccountStatus>("/payments/gateway-account", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // Admin
  async getAdminClients(): Promise<AdminClient[]> {
    return this.fetch<AdminClient[]>("/admin/clients");
  }

  async getAdminClientAnalytics(
    params: AdminClientAnalyticsParams = {},
  ): Promise<AdminClientAnalyticsResponse> {
    const query = this.buildQueryString({
      period: params.period,
      startDate: params.startDate,
      endDate: params.endDate,
      companyId: params.companyId,
      search: params.search,
      page: params.page,
      pageSize: params.pageSize,
    });

    return this.fetch<AdminClientAnalyticsResponse>(
      `/admin/clients/analytics${query}`,
    );
  }

  async createAdminClient(
    data: CreateAdminClientInput,
  ): Promise<CreateAdminClientResponse> {
    const payload = normalizeCreateAdminClientPayload(data);

    return this.fetch<CreateAdminClientResponse>("/admin/clients", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateAdminClient(
    clientId: string,
    data: UpdateAdminClientInput,
  ): Promise<AdminClient> {
    const payload = normalizeUpdateAdminClientPayload(data);

    return this.fetch<AdminClient>(`/admin/clients/${clientId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async resetAdminClientPassword(
    clientId: string,
  ): Promise<{ userId: string; temporaryPassword: string }> {
    return this.fetch<{ userId: string; temporaryPassword: string }>(
      `/admin/clients/${clientId}/reset-password`,
      { method: "POST", body: JSON.stringify({}) },
    );
  }

  // Health
  async getHealth(): Promise<unknown> {
    return this.fetch("/health");
  }
}

export { ApiClient };
export const apiClient = new ApiClient();
