import { parseTemplate } from './template-components';
import type { ParsedTemplate, TemplateMapping } from './template-contracts';
import {
  formatAmount,
  formatCivilDate,
  renderTemplate,
  validateMapping,
} from './template-renderer';

const BASE = 'https://app.test/pagar';

function parsed(body: string, button = true): ParsedTemplate {
  const result = parseTemplate({
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
