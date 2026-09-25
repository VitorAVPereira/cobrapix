import { HttpException } from '@nestjs/common';

export type TransportErrorKind =
  | 'CONFIGURATION'
  | 'RATE_LIMIT'
  | 'REJECTED'
  | 'UNCERTAIN'
  | 'TEMPORARY';
export type TransportOutcome = 'NOT_SENT' | 'REJECTED' | 'UNCERTAIN';

/** Contains only locally generated descriptions and allowlisted diagnostics. */
export class WhatsappTransportError extends HttpException {
  constructor(
    message: string,
    public readonly kind: TransportErrorKind,
    public readonly outcome: TransportOutcome,
    public readonly providerStatus?: number,
    public readonly providerCode?: number,
    public readonly retryAfterSeconds?: number,
    /** Stable local reason stored on the intent and shown to the admin (never provider text). */
    public readonly reasonCode?: string,
  ) {
    super(
      message,
      kind === 'RATE_LIMIT' ? 429 : kind === 'REJECTED' ? 400 : 502,
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function configError(): WhatsappTransportError {
  return new WhatsappTransportError(
    'Configuracao do canal WhatsApp invalida ou divergente. Confira os IDs e credenciais no servidor.',
    'CONFIGURATION',
    'NOT_SENT',
  );
}

export function invalidResponse(mutating: boolean): WhatsappTransportError {
  return new WhatsappTransportError(
    mutating
      ? 'Resultado da operacao WhatsApp incerto. Confira o envio antes de tentar novamente.'
      : 'Resposta invalida do provedor WhatsApp.',
    mutating ? 'UNCERTAIN' : 'TEMPORARY',
    mutating ? 'UNCERTAIN' : 'NOT_SENT',
  );
}

export function providerError(
  status: number,
  payload: unknown,
  mutating: boolean,
  retryAfter: string | null,
): WhatsappTransportError {
  const record = isRecord(payload) ? payload : {};
  const meta = isRecord(record.error) ? record.error : {};
  const code =
    typeof meta.code === 'number' && Number.isSafeInteger(meta.code)
      ? meta.code
      : undefined;
  const subcode =
    typeof meta.error_subcode === 'number' &&
    Number.isSafeInteger(meta.error_subcode)
      ? meta.error_subcode
      : undefined;
  const diagnostics = [
    code === undefined ? '' : `codigo ${code}`,
    subcode === undefined ? '' : `subcode ${subcode}`,
  ]
    .filter(Boolean)
    .join(' | ');
  const suffix = diagnostics ? ` (${diagnostics})` : '';
  if (status === 401 || status === 402 || status === 403) {
    const reason =
      status === 402
        ? 'Assinatura do provedor inativa.'
        : 'Credenciais ou permissoes do canal recusadas.';
    return new WhatsappTransportError(
      `${reason} Solicite revisao ao administrador.${suffix}`,
      'CONFIGURATION',
      mutating ? 'REJECTED' : 'NOT_SENT',
      status,
      code,
    );
  }
  if (status === 429) {
    const waitText =
      retryAfter ??
      (typeof record.message === 'string'
        ? /\bem (\d+)s\b/i.exec(record.message)?.[1]
        : undefined);
    const seconds =
      waitText && /^\d+$/.test(waitText) ? Number(waitText) : undefined;
    const wait =
      seconds !== undefined && seconds > 0 && seconds <= 86400
        ? seconds
        : undefined;
    return new WhatsappTransportError(
      'Limite do canal atingido. Aguarde antes de tentar novamente.',
      'RATE_LIMIT',
      mutating ? 'REJECTED' : 'NOT_SENT',
      status,
      code,
      wait,
    );
  }
  if (status >= 500 || status === 408 || status < 400) {
    const error = invalidResponse(mutating);
    return new WhatsappTransportError(
      error.message,
      error.kind,
      error.outcome,
      status,
      code,
    );
  }
  const reason =
    code === 131047
      ? 'A janela de atendimento encerrou. Utilize um template aprovado.'
      : 'O provedor recusou a operacao. Revise os dados e o template.';
  return new WhatsappTransportError(
    `${reason}${suffix}`,
    'REJECTED',
    mutating ? 'REJECTED' : 'NOT_SENT',
    status,
    code,
  );
}
