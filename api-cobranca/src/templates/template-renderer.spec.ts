import { parseTemplate } from './template-components';
import type { ParsedTemplate, TemplateMapping } from './template-contracts';
import {
  formatAmount,
  formatCivilDate,
  mappingSources,
  renderTemplate,
  validateMapping,
} from './template-renderer';

const BASE = 'https://app.test/pagar';

function parsed(
  body: string,
  button = true,
  parameterFormat = 'POSITIONAL',
): ParsedTemplate {
  const result = parseTemplate({
    parameterFormat,
    components: [
      { type: 'BODY', text: body },
      ...(button
        ? [
            {
              type: 'BUTTONS',
              buttons: [{ type: 'URL', text: 'Pagar', url: `${BASE}/{{1}}` }],
            },
          ]
        : []),
    ],
    language: 'pt_BR',
    category: 'UTILITY',
    paymentBaseUrl: BASE,
  });
  if (!result.supported) throw new Error(result.reason);
  return result.template;
}

const mapping: TemplateMapping = {
  body: {
    '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' },
    '2': { kind: 'SOURCE', source: 'AMOUNT' },
  },
  paymentButton: { index: 0, source: 'PAYMENT_URL_SUFFIX' },
};

describe('renderTemplate', () => {
  it('fills repeated positions once and keeps the button index independent', () => {
    const rendered = renderTemplate(
      parsed('Olá {{1}}, valor {{2}}. Até logo, {{1}}.'),
      mapping,
      { DEBTOR_NAME: 'Maria Exemplo', AMOUNT: 'R$ 150,00' },
      `${BASE}/token-da-fatura`,
    );
    expect(rendered).toMatchObject({
      ok: true,
      body: 'Olá Maria Exemplo, valor R$ 150,00. Até logo, Maria Exemplo.',
      bodyParameters: ['Maria Exemplo', 'R$ 150,00'],
      paymentButtonSuffix: 'token-da-fatura',
    });
  });

  it('named templates send each value with its parameter name', () => {
    const template = parsed(
      'Olá {{nome_devedor}}, valor {{valor}}. Até logo, {{nome_devedor}}.',
      false,
      'NAMED',
    );
    const named: TemplateMapping = {
      body: {
        nome_devedor: { kind: 'SOURCE', source: 'DEBTOR_NAME' },
        valor: { kind: 'LITERAL', value: 'R$ 150,00' },
      },
    };
    expect(
      renderTemplate(template, named, { DEBTOR_NAME: 'Maria Exemplo' }),
    ).toEqual({
      ok: true,
      body: 'Olá Maria Exemplo, valor R$ 150,00. Até logo, Maria Exemplo.',
      bodyParameters: ['Maria Exemplo', 'R$ 150,00'],
      bodyParameterNames: ['nome_devedor', 'valor'],
    });
    // Positional keys do not fit a named template, and vice versa.
    expect(validateMapping(template, mapping)).toMatchObject({ ok: false });
    expect(
      validateMapping(parsed('Olá {{1}}', false), {
        body: { nome_devedor: { kind: 'SOURCE', source: 'DEBTOR_NAME' } },
      }),
    ).toMatchObject({ ok: false, field: 'body.nome_devedor' });
  });

  it('never sends empty, undefined or partial values', () => {
    const missing = renderTemplate(
      parsed('Olá {{1}}, valor {{2}}.'),
      mapping,
      { DEBTOR_NAME: 'Maria', AMOUNT: '  ' },
      `${BASE}/token`,
    );
    expect(missing).toMatchObject({
      ok: false,
      code: 'VALUE_MISSING',
      field: 'AMOUNT',
    });
    expect(
      renderTemplate(parsed('Olá {{1}}, valor {{2}}.'), mapping, {
        DEBTOR_NAME: 'Maria',
        AMOUNT: 'R$ 1,00',
      }),
    ).toMatchObject({ ok: false, code: 'VALUE_MISSING', field: 'PAYMENT_URL' });
  });

  it('uses literals and rejects a payment URL outside the approved base', () => {
    const literal: TemplateMapping = {
      body: { '1': { kind: 'LITERAL', value: 'Equipe Financeira' } },
    };
    expect(
      renderTemplate(parsed('Assinado: {{1}}.', false), literal, {}),
    ).toMatchObject({ ok: true, bodyParameters: ['Equipe Financeira'] });
    for (const url of [
      'https://evil.test/pagar/token',
      `${BASE}/`,
      `${BASE}/a/b`,
      `${BASE}/token?x=1`,
    ])
      expect(
        renderTemplate(
          parsed('Olá {{1}}, valor {{2}}.'),
          mapping,
          { DEBTOR_NAME: 'Maria', AMOUNT: 'R$ 1,00' },
          url,
        ),
      ).toMatchObject({ ok: false, code: 'UNSUPPORTED', field: 'PAYMENT_URL' });
  });

  it('fills the Pix button with the invoice code only, never empty', () => {
    const result = parseTemplate({
      parameterFormat: 'NAMED',
      components: [
        { type: 'BODY', text: 'Olá {{nome_devedor}}' },
        {
          type: 'BUTTONS',
          buttons: [
            {
              type: 'PAYMENT_REQUEST',
              text: 'Copiar código Pix',
              payment_setting: {
                type: 'pix_dynamic_code',
                pix_dynamic_code: { code: '000201exemplo' },
              },
            },
          ],
        },
      ],
      language: 'pt_BR',
      category: 'UTILITY',
      paymentBaseUrl: BASE,
    });
    if (!result.supported) throw new Error(result.reason);
    const template = result.template;
    const pixMapping: TemplateMapping = {
      body: { nome_devedor: { kind: 'SOURCE', source: 'DEBTOR_NAME' } },
      pixButton: { index: 0, source: 'PIX_COPY_PASTE' },
    };
    expect(mappingSources(pixMapping)).toEqual([
      'DEBTOR_NAME',
      'PIX_COPY_PASTE',
    ]);
    expect(
      renderTemplate(template, pixMapping, {
        DEBTOR_NAME: 'Maria',
        PIX_COPY_PASTE: '00020101021226860014br.gov.bcb.pix2564cobranca',
      }),
    ).toEqual({
      ok: true,
      body: 'Olá Maria',
      bodyParameters: ['Maria'],
      bodyParameterNames: ['nome_devedor'],
      pixButtonCode: '00020101021226860014br.gov.bcb.pix2564cobranca',
    });
    // A boleto-only invoice has no Pix code: the send waits instead of going out.
    expect(
      renderTemplate(template, pixMapping, { DEBTOR_NAME: 'Maria' }),
    ).toEqual({ ok: false, code: 'VALUE_MISSING', field: 'PIX_COPY_PASTE' });
    expect(
      renderTemplate(template, pixMapping, {
        DEBTOR_NAME: 'Maria',
        PIX_COPY_PASTE: '000201\n6304ABCD',
      }),
    ).toEqual({ ok: false, code: 'UNSUPPORTED', field: 'PIX_COPY_PASTE' });
    // The binding is required, fixed to the invoice code and at the approved position.
    for (const pixButton of [
      undefined,
      { index: 1, source: 'PIX_COPY_PASTE' },
      { index: 0, source: 'BOLETO_LINE' },
      { index: 0, source: 'PIX_COPY_PASTE', code: 'fixo' },
    ])
      expect(
        validateMapping(template, { ...pixMapping, pixButton }),
      ).toMatchObject({ ok: false, field: 'pixButton' });
    expect(
      validateMapping(parsed('Olá {{1}}, valor {{2}}.'), {
        ...mapping,
        pixButton: { index: 0, source: 'PIX_COPY_PASTE' },
      }),
    ).toMatchObject({ ok: false, field: 'pixButton' });
  });

  it('rejects values the provider does not accept instead of rewriting them', () => {
    expect(
      renderTemplate(
        parsed('Olá {{1}}.', false),
        { body: { '1': mapping.body['1']! } },
        {
          DEBTOR_NAME: 'Maria\nSilva',
        },
      ),
    ).toMatchObject({ ok: false, code: 'UNSUPPORTED', field: 'DEBTOR_NAME' });
  });
});

describe('validateMapping', () => {
  it('requires every position, a closed source list and the button binding', () => {
    const template = parsed('Olá {{1}}, valor {{2}}.');
    expect(validateMapping(template, mapping)).toEqual({ ok: true });
    expect(validateMapping(template, { body: mapping.body })).toMatchObject({
      ok: false,
      field: 'paymentButton',
    });
    expect(
      validateMapping(template, {
        ...mapping,
        body: { '1': mapping.body['1']! },
      }),
    ).toMatchObject({ ok: false, field: 'body.2' });
    expect(
      validateMapping(template, {
        ...mapping,
        body: {
          ...mapping.body,
          '3': { kind: 'LITERAL', value: 'x' },
        },
      }),
    ).toMatchObject({ ok: false, field: 'body.3' });
    for (const binding of [
      { kind: 'SOURCE', source: 'debtor.phoneNumber' },
      { kind: 'LITERAL', value: 'https://evil.test' },
      { kind: 'LITERAL', value: '{{1}}' },
      { kind: 'LITERAL', value: '' },
      { kind: 'EXPRESSION', value: 'process.env' },
    ])
      expect(
        validateMapping(template, {
          ...mapping,
          body: { ...mapping.body, '2': binding as never },
        }),
      ).toMatchObject({ ok: false, field: 'body.2' });
  });
});

describe('Brazilian formatting', () => {
  it('keeps the civil due date and a plain currency space', () => {
    expect(formatCivilDate(new Date('2026-10-05T12:00:00.000Z'))).toBe(
      '05/10/2026',
    );
    expect(formatCivilDate(new Date('2026-10-05T00:00:00.000Z'))).toBe(
      '05/10/2026',
    );
    expect(formatAmount(150)).toBe('R$ 150,00');
    expect(formatAmount(1234.5)).toBe('R$ 1.234,50');
  });
});
