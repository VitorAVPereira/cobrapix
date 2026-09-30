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
        quickReplies: [],
      },
    });
  });

  it('accepts static quick replies next to the payment button, in any order', () => {
    const body = { type: 'BODY', text: 'Olá {{nome_devedor}}' };
    const payment = {
      type: 'URL',
      text: 'Link do pagamento',
      url: `${BASE}/{{1}}`,
    };
    const help = { type: 'QUICK_REPLY', text: 'Preciso de ajuda' };
    const named = { parameterFormat: 'NAMED' };
    expect(
      parseTemplate(
        input([body, { type: 'BUTTONS', buttons: [payment, help] }], named),
      ),
    ).toMatchObject({
      supported: true,
      template: {
        paymentButton: { index: 0, label: 'Link do pagamento' },
        quickReplies: ['Preciso de ajuda'],
      },
    });
    expect(
      parseTemplate(
        input([body, { type: 'BUTTONS', buttons: [help, payment] }], named),
      ),
    ).toMatchObject({
      supported: true,
      template: {
        paymentButton: { index: 1 },
        quickReplies: ['Preciso de ajuda'],
      },
    });
    expect(
      parseTemplate(input([body, { type: 'BUTTONS', buttons: [help] }], named)),
    ).toMatchObject({
      supported: true,
      template: { paymentButton: null, quickReplies: ['Preciso de ajuda'] },
    });
  });

  it('accepts the "Copy Pix code" payment request button, declared by the provider', () => {
    const pix = {
      type: 'PAYMENT_REQUEST',
      text: 'Copiar código Pix',
      payment_setting: {
        type: 'pix_dynamic_code',
        pix_dynamic_code: {
          code: '00020101021226700014br.gov.bcb.pix2548exemplo',
        },
      },
    };
    const components = [
      {
        type: 'BODY',
        text: 'Boa tarde, {{nome_devedor}}. Valor {{valor}}, vence em {{data_vencimento}}.',
      },
      {
        type: 'FOOTER',
        text: 'Caso já tenha realizado o pagamento, desconsidere!',
      },
      {
        type: 'BUTTONS',
        buttons: [pix, { type: 'QUICK_REPLY', text: 'Preciso de ajuda' }],
      },
    ];
    expect(
      parseTemplate(input(components, { parameterFormat: 'NAMED' })),
    ).toMatchObject({
      supported: true,
      template: {
        variables: ['nome_devedor', 'valor', 'data_vencimento'],
        paymentButton: null,
        pixButton: { index: 0, label: 'Copiar código Pix' },
        quickReplies: ['Preciso de ajuda'],
      },
    });
    // Next to the payment link, in its own position.
    const payment = { type: 'URL', text: 'Pagar', url: `${BASE}/{{1}}` };
    expect(
      parseTemplate(
        input([approved[0], { type: 'BUTTONS', buttons: [payment, pix] }]),
      ),
    ).toMatchObject({
      supported: true,
      template: {
        paymentButton: { index: 0 },
        pixButton: { index: 1 },
      },
    });
    // Other payment kinds, an undeclared kind or a second Pix button are not guessed.
    const refused = [
      [
        {
          type: 'PAYMENT_REQUEST',
          text: 'Copiar código do boleto',
          payment_setting: {
            type: 'boleto',
            boleto: {
              digitable_line: '03399026944140000002628346101018898510000008848',
            },
          },
        },
      ],
      [
        {
          type: 'PAYMENT_REQUEST',
          text: 'Abrir link de pagamento',
          payment_setting: {
            type: 'payment_link',
            payment_link: { uri: 'https://pagamento.test' },
          },
        },
      ],
      [{ type: 'PAYMENT_REQUEST', text: 'Copiar código Pix' }],
      [pix, pix],
    ];
    for (const buttons of refused) {
      const parsed = parseTemplate(
        input([approved[0], { type: 'BUTTONS', buttons }]),
      );
      expect(parsed.supported).toBe(false);
    }
    const boleto = parseTemplate(
      input([approved[0], { type: 'BUTTONS', buttons: refused[0] }]),
    );
    expect(!boleto.supported && boleto.reason).toMatch(/boleto/);
  });

  it('accepts body only and positional format declared explicitly', () => {
    const parsed = parseTemplate(
      input([{ type: 'BODY', text: 'Aviso sem variáveis.' }], {
        parameterFormat: 'POSITIONAL',
      }),
    );
    expect(parsed).toMatchObject({
      supported: true,
      template: {
        variables: [],
        footer: null,
        paymentButton: null,
        pixButton: null,
      },
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

  it('rejects gaps, other buttons, static or foreign URLs and footer variables', () => {
    const payment = { type: 'URL', text: 'Pagar', url: `${BASE}/{{1}}` };
    const cases = [
      [{ type: 'BODY', text: 'A {{1}} e {{3}}' }],
      [approved[0], { type: 'BUTTONS', buttons: [payment, payment] }],
      [
        approved[0],
        {
          type: 'BUTTONS',
          buttons: [
            payment,
            { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5511' },
          ],
        },
      ],
      [
        approved[0],
        {
          type: 'BUTTONS',
          buttons: [payment, { type: 'QUICK_REPLY', text: 'Falar {{1}}' }],
        },
      ],
      [approved[0], { type: 'BUTTONS', buttons: [] }],
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
