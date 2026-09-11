export const TEMPLATE_VARIABLE_TAGS = [
  'nome_devedor',
  'nome_empresa',
  'valor',
  'data_vencimento',
  'metodo_pagamento',
  'payment_link',
  'pix_copia_e_cola',
  'boleto_linha_digitavel',
  'boleto_link',
  'boleto_pdf',
  'saudacao',
  'instrucoes',
  'assinatura',
] as const;

export type TemplateVariableTag = (typeof TEMPLATE_VARIABLE_TAGS)[number];

export interface TemplateDefinition {
  readonly slug: string;
  readonly name: string;
  readonly defaultContent: string;
  readonly footerText: string;
  readonly paymentButtonEnabled: boolean;
  readonly paymentButtonLabel: string;
  readonly copyCodeButtonEnabled: boolean;
  readonly copyCodeSource: 'AUTO' | 'PIX_COPY_PASTE' | 'BOLETO_LINE_DIGITABLE';
}

export const TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  {
    slug: 'cobranca-emissao',
    name: 'Cobranca na emissao',
    defaultContent:
      '{{saudacao}}, {{nome_devedor}}. Sua cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, foi emitida com vencimento em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\n{{instrucoes}}\n\n{{assinatura}}',
    footerText: 'Respostas são atendidas pela central CifraMais.',
    paymentButtonEnabled: true,
    paymentButtonLabel: 'Abrir pagamento',
    copyCodeButtonEnabled: false,
    copyCodeSource: 'AUTO',
  },
  {
    slug: 'vencimento-hoje',
    name: 'Vencimento hoje',
    defaultContent:
      '{{saudacao}}, {{nome_devedor}}. Sua cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, vence hoje ({{data_vencimento}}).\n\nForma de pagamento: {{metodo_pagamento}}\n{{instrucoes}}\n\n{{assinatura}}',
    footerText: 'Respostas são atendidas pela central CifraMais.',
    paymentButtonEnabled: true,
    paymentButtonLabel: 'Abrir pagamento',
    copyCodeButtonEnabled: false,
    copyCodeSource: 'AUTO',
  },
  {
    slug: 'pre-vencimento',
    name: 'Lembrete antes do vencimento',
    defaultContent:
      '{{saudacao}}, {{nome_devedor}}. Lembramos que sua cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, vence em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\n{{instrucoes}}\n\n{{assinatura}}',
    footerText: 'Respostas são atendidas pela central CifraMais.',
    paymentButtonEnabled: true,
    paymentButtonLabel: 'Abrir pagamento',
    copyCodeButtonEnabled: false,
    copyCodeSource: 'AUTO',
  },
  {
    slug: 'atraso-primeiro-aviso',
    name: 'Primeiro aviso de atraso',
    defaultContent:
      '{{saudacao}}, {{nome_devedor}}. Identificamos uma cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, vencida em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\n{{instrucoes}}\n\n{{assinatura}}',
    footerText: 'Respostas são atendidas pela central CifraMais.',
    paymentButtonEnabled: true,
    paymentButtonLabel: 'Regularizar agora',
    copyCodeButtonEnabled: false,
    copyCodeSource: 'AUTO',
  },
  {
    slug: 'atraso-recorrente',
    name: 'Atraso recorrente',
    defaultContent:
      '{{saudacao}}, {{nome_devedor}}. Ainda consta uma cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, com vencimento em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\n{{instrucoes}}\n\n{{assinatura}}',
    footerText: 'Respostas são atendidas pela central CifraMais.',
    paymentButtonEnabled: true,
    paymentButtonLabel: 'Regularizar agora',
    copyCodeButtonEnabled: false,
    copyCodeSource: 'AUTO',
  },
  {
    slug: 'atraso-critico',
    name: 'Atraso critico',
    defaultContent:
      '{{saudacao}}, {{nome_devedor}}. Sua cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, segue pendente desde {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\n{{instrucoes}}\n\n{{assinatura}}',
    footerText: 'Respostas são atendidas pela central CifraMais.',
    paymentButtonEnabled: true,
    paymentButtonLabel: 'Regularizar agora',
    copyCodeButtonEnabled: false,
    copyCodeSource: 'AUTO',
  },
] as const;

export const TEMPLATE_SLUGS = TEMPLATE_DEFINITIONS.map(
  (definition) => definition.slug,
);

export function getTemplateDefinition(slug: string): TemplateDefinition | null {
  return (
    TEMPLATE_DEFINITIONS.find((definition) => definition.slug === slug) ?? null
  );
}
