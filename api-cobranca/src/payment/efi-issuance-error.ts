import { HttpException, HttpStatus } from '@nestjs/common';

// Where an issuance stopped. Only PRE_SUBMISSION and a provider refusal of
// the creation request prove that no charge exists at Efí.
export type IssuanceStage =
  | 'PRE_SUBMISSION'
  | 'PROVIDER_REQUEST'
  | 'PROVIDER_RESPONSE'
  | 'LOCAL_PERSISTENCE';

export interface IssuanceFailure {
  kind: 'REJECTED' | 'UNCERTAIN';
  code: string;
  stage: IssuanceStage;
  // Only when the provider body carries it (Pix problem+json); the SDK does
  // not expose the HTTP status of Cobranças errors.
  httpStatus: number | null;
  providerCode: string | null;
  // Path of the field Efí refused, never its value.
  field: string | null;
  message: string;
}

export const UNCERTAIN_MESSAGE =
  'A confirmação da emissão está incerta e exige conciliação.';

// Refusals of the creation request itself: validation happens before the
// charge exists, and an authorization error means the POST was never accepted.
const VALIDATION_ERRORS = new Set(['validation_error', 'json_invalido']);
const AUTH_ERRORS = new Set([
  'invalid_client',
  'unauthorized_client',
  'invalid_grant',
  'unauthorized',
  'insufficient_scope',
  'forbidden',
]);

const FIELD_LABELS: Array<[RegExp, string]> = [
  [/phone_number$/, 'telefone do pagador'],
  [/email$/, 'e-mail do pagador'],
  [/corporate_name$/, 'razão social do pagador'],
  [/cnpj$/, 'CNPJ do pagador'],
  [/cpf$/, 'CPF do pagador'],
  [/(customer\/name|devedor\.nome)$/, 'nome do pagador (nome e sobrenome)'],
  [/(zipcode|cep)$/, 'CEP do endereço'],
  [/(address\/state|uf)$/, 'UF do endereço'],
  [/(address|logradouro|cidade)/, 'endereço do pagador'],
  [/(expire_at|dataDeVencimento)/, 'data de vencimento'],
  [/(marketplace|repasses|payee_code|split)/, 'repasse (split) da plataforma'],
  [
    /(configurations|multa|juros|fine|interest)/,
    'multa, juros ou prazo após o vencimento',
  ],
  [/(items|value|valor)/, 'valor da cobrança'],
  [/notification_url/, 'URL de notificação'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeToken(value: unknown, max = 64): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return String(value);
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return /^[A-Za-z0-9_.:-]+$/.test(token) ? token.slice(0, max) : null;
}

function safeField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const field = value.trim();
  return /^[A-Za-z0-9_./[\]-]{1,120}$/.test(field) ? field : null;
}

function fieldLabel(field: string | null): string | null {
  if (!field) return null;
  return FIELD_LABELS.find(([pattern]) => pattern.test(field))?.[1] ?? null;
}

// Efí Cobranças: { code, error, error_description: string | { property } }.
// Efí Pix: { nome, mensagem } or problem+json { type, title, status, violacoes }.
function readProviderError(error: Record<string, unknown>): {
  name: string | null;
  code: string | null;
  field: string | null;
  httpStatus: number | null;
  hasViolations: boolean;
} {
  const typeName =
    typeof error.type === 'string' ? error.type.split('/').at(-1) : null;
  const description = error.error_description;
  const violations = Array.isArray(error.violacoes) ? error.violacoes : [];
  const firstViolation = violations.find(isRecord);
  const status = error.status;
  return {
    name: safeToken(error.error ?? error.nome ?? typeName),
    code: safeToken(error.code),
    field: safeField(
      isRecord(description)
        ? description.property
        : firstViolation?.propriedade,
    ),
    httpStatus:
      typeof error.type === 'string' &&
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? status
        : null,
    hasViolations: violations.length > 0,
  };
}

function ownCode(error: HttpException): string | null {
  const response = error.getResponse();
  if (!isRecord(response) || typeof response.code !== 'string') return null;
  return /^[A-Z0-9_]{3,64}$/.test(response.code) ? response.code : null;
}

function ownMessage(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response.slice(0, 300);
  if (isRecord(response) && typeof response.message === 'string')
    return response.message.slice(0, 300);
  return error.message.slice(0, 300);
}

// Classifies a failed issuance by evidence. The original error is never
// returned: SDK errors may carry certificates, headers or payer data.
export function classifyEfiIssuanceError(
  error: unknown,
  stage: IssuanceStage,
): IssuanceFailure {
  if (stage === 'PRE_SUBMISSION') {
    // Nothing reached the creation endpoint; our own messages are safe.
    return {
      kind: 'REJECTED',
      code:
        (error instanceof HttpException && ownCode(error)) ||
        'ISSUANCE_PRECONDITION_FAILED',
      stage,
      httpStatus: null,
      providerCode: null,
      field: null,
      message:
        error instanceof HttpException
          ? ownMessage(error)
          : 'A emissão foi interrompida antes do envio à Efí por uma configuração local.',
    };
  }
  if (stage !== 'PROVIDER_REQUEST') {
    // The provider accepted the request: the charge may exist.
    return {
      kind: 'UNCERTAIN',
      code:
        stage === 'PROVIDER_RESPONSE'
          ? 'EFI_RESPONSE_INCOMPLETE'
          : 'LOCAL_PERSISTENCE_FAILED',
      stage,
      httpStatus: null,
      providerCode: null,
      field: null,
      message: UNCERTAIN_MESSAGE,
    };
  }
  if (isRecord(error) && !(error instanceof Error)) {
    const provider = readProviderError(error);
    const providerCode =
      [provider.name, provider.code].filter(Boolean).join(':') || null;
    const serverSide =
      provider.httpStatus !== null && provider.httpStatus >= 500;
    // A bare 4xx is not enough: only a schema/validation refusal proves the
    // creation was not accepted.
    if (
      !serverSide &&
      ((provider.name && VALIDATION_ERRORS.has(provider.name)) ||
        provider.hasViolations)
    ) {
      const label = fieldLabel(provider.field);
      return {
        kind: 'REJECTED',
        code: 'EFI_VALIDATION_REJECTED',
        stage,
        httpStatus: provider.httpStatus,
        providerCode,
        field: provider.field,
        message: label
          ? `A Efí recusou os dados da cobrança: ${label}. Corrija o cadastro e emita novamente.`
          : 'A Efí recusou os dados da cobrança. Revise os dados do pagador e da fatura e emita novamente.',
      };
    }
    if (
      !serverSide &&
      ((provider.name && AUTH_ERRORS.has(provider.name)) ||
        provider.httpStatus === 401 ||
        provider.httpStatus === 403)
    )
      return {
        kind: 'REJECTED',
        code: 'EFI_AUTH_REJECTED',
        stage,
        httpStatus: provider.httpStatus,
        providerCode,
        field: null,
        message:
          'A Efí recusou as credenciais ou permissões da conta emissora. Revise a integração antes de emitir novamente.',
      };
    return {
      kind: 'UNCERTAIN',
      code: 'EFI_SUBMISSION_UNCERTAIN',
      stage,
      httpStatus: provider.httpStatus,
      providerCode,
      field: null,
      message: UNCERTAIN_MESSAGE,
    };
  }
  // Timeouts, resets, SDK crashes on a missing response and unknown shapes.
  const networkCode =
    error instanceof Error
      ? safeToken((error as { code?: unknown }).code)
      : null;
  return {
    kind: 'UNCERTAIN',
    code: 'EFI_SUBMISSION_UNCERTAIN',
    stage,
    httpStatus: null,
    providerCode: networkCode ? `net:${networkCode}` : null,
    field: null,
    message: UNCERTAIN_MESSAGE,
  };
}

// An issuance error carrying its classification. Proven refusals are business
// errors; uncertain outcomes keep EFI_SUBMISSION_UNCERTAIN.
export class EfiIssuanceError extends HttpException {
  constructor(
    readonly failure: IssuanceFailure,
    response?: string | Record<string, unknown>,
    status?: number,
  ) {
    super(
      response ?? EfiIssuanceError.defaultResponse(failure),
      status ?? EfiIssuanceError.defaultStatus(failure),
    );
  }

  private static defaultResponse(
    failure: IssuanceFailure,
  ): Record<string, unknown> {
    if (failure.kind === 'UNCERTAIN')
      return {
        code: 'EFI_SUBMISSION_UNCERTAIN',
        reasonCode: failure.code,
        message: failure.message,
      };
    return {
      code:
        failure.stage === 'PRE_SUBMISSION'
          ? failure.code
          : 'EFI_ISSUANCE_REJECTED',
      reasonCode: failure.code,
      field: failure.field,
      message: failure.message,
    };
  }

  private static defaultStatus(failure: IssuanceFailure): number {
    if (failure.kind === 'UNCERTAIN') return HttpStatus.BAD_GATEWAY;
    return failure.code === 'EFI_VALIDATION_REJECTED'
      ? HttpStatus.UNPROCESSABLE_ENTITY
      : HttpStatus.SERVICE_UNAVAILABLE;
  }
}

export function toIssuanceError(
  error: unknown,
  stage: IssuanceStage,
): EfiIssuanceError {
  if (error instanceof EfiIssuanceError) return error;
  const failure = classifyEfiIssuanceError(error, stage);
  // Local preconditions keep the response the caller already expects.
  if (stage === 'PRE_SUBMISSION' && error instanceof HttpException)
    return new EfiIssuanceError(
      failure,
      error.getResponse() as string | Record<string, unknown>,
      error.getStatus(),
    );
  return new EfiIssuanceError(failure);
}

export function issuanceFailureOf(error: unknown): IssuanceFailure | null {
  return error instanceof EfiIssuanceError ? error.failure : null;
}

// Stored in PaymentChargeStatusHistory.sanitizedDetails.
export function issuanceFailureDetails(
  failure: IssuanceFailure,
): Record<string, string | number | null> {
  return {
    event: 'ISSUANCE_FAILURE',
    kind: failure.kind,
    code: failure.code,
    stage: failure.stage,
    httpStatus: failure.httpStatus,
    providerCode: failure.providerCode,
    field: failure.field,
    message: failure.message,
  };
}
