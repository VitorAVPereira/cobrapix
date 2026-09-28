import { parseTemplate, templateFingerprint } from './template-components';

const BASE = 'https://app.ciframais.test/pagar';

const BODY_TEXT =
  'Olá {{1}}, sua cobrança de {{2}} está disponível. Obrigado, {{1}}!';
const approved = [
  {
    type: 'BODY',
    text: BODY_TEXT,
    example: { body_text: [['Maria', 'R$ 10,00']] },
  },
  { type: 'FOOTER', text: 'CifraMais' },
  {
    type: 'BUTTONS',
    buttons: [{ type: 'URL', text: 'Pagar', url: `${BASE}/{{1}}` }],
  },
];

const input = (components: unknown, extra: Record<string, unknown> = {}) => ({
  components,
  language: 'pt_BR',
  category: 'UTILITY',
  paymentBaseUrl: BASE,
  ...extra,
});

describe('parseTemplate', () => {
  it('positional_body_and_payment_button', () => {
    const parsed = parseTemplate(input(approved));
    expect(parsed).toMatchObject({
      supported: true,
      template: {
        parameterFormat: 'POSITIONAL',
        variables: ['1', '2'],
        footer: 'CifraMais',
        paymentButton: { index: 0, label: 'Pagar', url: `${BASE}/{{1}}` },
      },
    });
  });

  it('accepts body only and positional format declared explicitly', () => {
    const parsed = parseTemplate(
      input([{ type: 'BODY', text: 'Aviso sem variáveis.' }], {
        parameterFormat: 'POSITIONAL',
      }),
    );
    expect(parsed).toMatchObject({
      supported: true,
      template: { variables: [], footer: null, paymentButton: null },
    });
  });

  it('named parameters follow the declared format, in order of first use', () => {
    const named = parseTemplate(
      input(
        [
          {
            type: 'BODY',
            text: 'Olá, {{nome_devedor}}. Valor {{valor}}; até logo, {{nome_devedor}}.',
          },
        ],
        { parameterFormat: 'NAMED' },
      ),
    );
    expect(named).toMatchObject({
      supported: true,
      template: {
        parameterFormat: 'NAMED',
        variables: ['nome_devedor', 'valor'],
      },
    });
    // Without the declared format a name is never guessed.
    const inferred = parseTemplate(
      input([{ type: 'BODY', text: 'Olá {{nome}}' }]),
    );
    expect(inferred).toMatchObject({ supported: false });
    // A named template never mixes positions or malformed names.
    for (const text of ['Olá {{nome}} {{1}}', 'Olá {{Nome}}', 'Olá {{nome-x}}'])
      expect(
        parseTemplate(
          input([{ type: 'BODY', text }], { parameterFormat: 'NAMED' }),
        ).supported,
      ).toBe(false);
    expect(
      parseTemplate(
        input([{ type: 'BODY', text: 'Olá {{nome}}' }], {
          parameterFormat: 'OTHER',
        }),
      ).supported,
    ).toBe(false);
  });

  it('unknown_component_is_not_dropped', () => {
    const unknownHeader = parseTemplate(
      input([{ type: 'HEADER', format: 'IMAGE' }, ...approved]),
    );
    expect(unknownHeader.supported).toBe(false);
    expect(!unknownHeader.supported && unknownHeader.reason).toMatch(/HEADER/);
    const carousel = parseTemplate(input([...approved, { type: 'CAROUSEL' }]));
    expect(carousel.supported).toBe(false);
  });

  it('rejects gaps, extra buttons, static or foreign URLs and footer variables', () => {
    const cases = [
      [{ type: 'BODY', text: 'A {{1}} e {{3}}' }],
      [
        approved[0],
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Pagar', url: `${BASE}/{{1}}` },
            { type: 'QUICK_REPLY', text: 'Falar' },
          ],
        },
      ],
      [
        approved[0],
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'Pagar', url: BASE }],
        },
      ],
      [
        approved[0],
        {
          type: 'BUTTONS',
          buttons: [
            {
              type: 'URL',
              text: 'Pagar',
              url: 'https://evil.test/pagar/{{1}}',
            },
          ],
        },
      ],
      [approved[0], { type: 'FOOTER', text: 'Rodapé {{1}}' }],
      [approved[0], approved[0]],
      'not-an-array',
    ];
    for (const components of cases)
      expect(parseTemplate(input(components)).supported).toBe(false);
  });

  it('same_name_different_account_or_language', () => {
    const pt = parseTemplate(input(approved));
    const en = parseTemplate(input(approved, { language: 'en_US' }));
    const marketing = parseTemplate(input(approved, { category: 'MARKETING' }));
    if (!pt.supported || !en.supported || !marketing.supported)
      throw new Error();
    expect(pt.template.fingerprint).not.toBe(en.template.fingerprint);
    expect(pt.template.fingerprint).not.toBe(marketing.template.fingerprint);
  });

  it('fingerprint ignores provider key order and examples, not content', () => {
    const parsed = parseTemplate(input(approved));
    const reorderedProviderObject = parseTemplate(
      input([
        {
          buttons: [{ url: `${BASE}/{{1}}`, text: 'Pagar', type: 'URL' }],
          type: 'BUTTONS',
        },
        { text: BODY_TEXT, type: 'BODY' },
        { text: 'CifraMais', type: 'FOOTER' },
      ]),
    );
    if (!parsed.supported || !reorderedProviderObject.supported)
      throw new Error('expected supported');
    expect(reorderedProviderObject.template.fingerprint).toBe(
      parsed.template.fingerprint,
    );
    const changed = templateFingerprint(
      input([
        { ...approved[0], text: 'Outro texto {{1}} {{2}}' },
        ...approved.slice(1),
      ]),
    );
    expect(changed).not.toBe(parsed.template.fingerprint);
    // Unsupported templates still have a stable fingerprint to detect changes.
    expect(templateFingerprint(input([{ type: 'HEADER' }]))).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
