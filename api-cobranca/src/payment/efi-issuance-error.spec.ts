import { HttpException } from '@nestjs/common';
import {
  classifyEfiIssuanceError,
  EfiIssuanceError,
  issuanceFailureOf,
  toIssuanceError,
} from './efi-issuance-error';

// Synthetic shapes of what sdk-node-apis-efi 1.2.x throws: the response body
// for HTTP errors, the OAuth body for credential errors, and plain Errors
// (or a TypeError from the SDK itself) when no response arrived.
const cobrancasValidation = {
  code: 3500034,
  error: 'validation_error',
  error_description: {
    property: '/payment/banking_billet/customer/phone_number',
    message: 'A string não corresponde ao modelo: ^[1-9]{2}9?[0-9]{8}$',
  },
};

describe('classifyEfiIssuanceError', () => {
  it('proves a refusal when Efí rejects the creation payload', () => {
    expect(
      classifyEfiIssuanceError(cobrancasValidation, 'PROVIDER_REQUEST'),
    ).toEqual({
      kind: 'REJECTED',
      code: 'EFI_VALIDATION_REJECTED',
      stage: 'PROVIDER_REQUEST',
      httpStatus: null,
      providerCode: 'validation_error:3500034',
      field: '/payment/banking_billet/customer/phone_number',
      message: expect.stringContaining('telefone do pagador') as unknown,
    });
  });

  it('proves a refusal for Pix schema violations', () => {
    const failure = classifyEfiIssuanceError(
      {
        type: 'https://pix.bcb.gov.br/api/v2/error/CobVOperacaoInvalida',
        title: 'Cobrança inválida.',
        status: 400,
        violacoes: [{ razao: 'inválido', propriedade: 'cobv.devedor.cpf' }],
      },
      'PROVIDER_REQUEST',
    );
    expect(failure).toMatchObject({
      kind: 'REJECTED',
      code: 'EFI_VALIDATION_REJECTED',
      httpStatus: 400,
      providerCode: 'CobVOperacaoInvalida',
      field: 'cobv.devedor.cpf',
    });
    expect(failure.message).toContain('CPF do pagador');
  });

  it('treats a credential refusal as rejected without echoing the provider text', () => {
    const failure = classifyEfiIssuanceError(
      {
        error: 'invalid_client',
        error_description: 'Invalid or inactive credentials for client-123',
      },
      'PROVIDER_REQUEST',
    );
    expect(failure).toMatchObject({
      kind: 'REJECTED',
      code: 'EFI_AUTH_REJECTED',
      providerCode: 'invalid_client',
    });
    expect(JSON.stringify(failure)).not.toContain('client-123');
  });

  it.each([
    [
      'timeout',
      Object.assign(new Error('timeout of 0ms'), { code: 'ECONNABORTED' }),
      'net:ECONNABORTED',
    ],
    [
      'connection reset',
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      'net:ECONNRESET',
    ],
    [
      'SDK crash without response',
      new TypeError(
        "Cannot read properties of undefined (reading 'responseUrl')",
      ),
      null,
    ],
    [
      'server error body',
      { code: 500, error: 'server_error' },
      'server_error:500',
    ],
    [
      'unknown business code',
      { code: 3500010, error: 'property_not_valid' },
      'property_not_valid:3500010',
    ],
    [
      'Pix 5xx with violations',
      { type: 'x/Erro', status: 503, violacoes: [{ propriedade: 'a' }] },
      'Erro',
    ],
    [
      'bare 4xx without validation evidence',
      { type: 'x/CobVOperacaoInvalida', title: 't', status: 400 },
      'CobVOperacaoInvalida',
    ],
    ['SDK string', 'Verifique o atributo sandbox e certificate', null],
    ['empty body', undefined, null],
  ])('keeps %s uncertain', (_name, error, providerCode) => {
    expect(classifyEfiIssuanceError(error, 'PROVIDER_REQUEST')).toMatchObject({
      kind: 'UNCERTAIN',
      code: 'EFI_SUBMISSION_UNCERTAIN',
      providerCode,
    });
  });

  it('keeps a failure after the provider accepted the request uncertain', () => {
    expect(
      classifyEfiIssuanceError(cobrancasValidation, 'PROVIDER_RESPONSE'),
    ).toMatchObject({ kind: 'UNCERTAIN', code: 'EFI_RESPONSE_INCOMPLETE' });
    expect(
      classifyEfiIssuanceError(new Error('deadlock'), 'LOCAL_PERSISTENCE'),
    ).toMatchObject({ kind: 'UNCERTAIN', code: 'LOCAL_PERSISTENCE_FAILED' });
  });

  it('rejects local preconditions that stopped the request before sending', () => {
    expect(
      classifyEfiIssuanceError(
        new HttpException('Recebedor da plataforma inválido para split.', 503),
        'PRE_SUBMISSION',
      ),
    ).toMatchObject({
      kind: 'REJECTED',
      code: 'ISSUANCE_PRECONDITION_FAILED',
      message: 'Recebedor da plataforma inválido para split.',
    });
    expect(
      classifyEfiIssuanceError(
        new HttpException(
          { code: 'EFI_CREDENTIALS_UNAVAILABLE', message: 'x' },
          409,
        ),
        'PRE_SUBMISSION',
      ),
    ).toMatchObject({ kind: 'REJECTED', code: 'EFI_CREDENTIALS_UNAVAILABLE' });
    const configError = classifyEfiIssuanceError(
      new Error('Configuration key "EFI_WEBHOOK_SECRET" does not exist'),
      'PRE_SUBMISSION',
    );
    expect(configError.code).toBe('ISSUANCE_PRECONDITION_FAILED');
    expect(configError.message).not.toContain('EFI_WEBHOOK_SECRET');
  });

  it('never returns certificates, headers, payload or payer data', () => {
    const leaky = {
      error: 'validation_error',
      error_description: {
        property: '/payment/banking_billet/customer/cpf',
        message: 'CPF 529.982.247-25 de Maria Silva inválido',
      },
      config: {
        headers: { Authorization: 'Bearer token-abc' },
        httpsAgent: { pfx: 'MIICERTIFICATE' },
        data: { customer: { name: 'Maria Silva', cpf: '52998224725' } },
      },
    };
    const serialized = JSON.stringify(
      classifyEfiIssuanceError(leaky, 'PROVIDER_REQUEST'),
    );
    for (const secret of [
      'token-abc',
      'MIICERTIFICATE',
      'Maria',
      '52998224725',
      '529.982',
    ])
      expect(serialized).not.toContain(secret);
    expect(
      classifyEfiIssuanceError(
        {
          error: 'validation_error',
          error_description: { property: 'x"; DROP' },
        },
        'PROVIDER_REQUEST',
      ).field,
    ).toBeNull();
  });
});

describe('toIssuanceError', () => {
  it('answers a proven refusal as a business error', () => {
    const error = toIssuanceError(cobrancasValidation, 'PROVIDER_REQUEST');
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({
      code: 'EFI_ISSUANCE_REJECTED',
      reasonCode: 'EFI_VALIDATION_REJECTED',
    });
  });

  it('keeps EFI_SUBMISSION_UNCERTAIN for ambiguous outcomes', () => {
    const error = toIssuanceError(
      new Error('socket hang up'),
      'PROVIDER_REQUEST',
    );
    expect(error.getStatus()).toBe(502);
    expect(error.getResponse()).toMatchObject({
      code: 'EFI_SUBMISSION_UNCERTAIN',
    });
    expect(issuanceFailureOf(error)?.kind).toBe('UNCERTAIN');
  });

  it('keeps the original response of a local precondition', () => {
    const original = new HttpException('CPF/CNPJ do devedor obrigatorio.', 400);
    const error = toIssuanceError(original, 'PRE_SUBMISSION');
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toBe('CPF/CNPJ do devedor obrigatorio.');
    expect(issuanceFailureOf(error)?.kind).toBe('REJECTED');
    expect(toIssuanceError(error, 'LOCAL_PERSISTENCE')).toBe(error);
    expect(error).toBeInstanceOf(EfiIssuanceError);
  });
});
