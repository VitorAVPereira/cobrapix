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
] as const;

export type TemplateVariableTag = (typeof TEMPLATE_VARIABLE_TAGS)[number];

export interface TemplateDefinition {
  readonly slug: string;
  readonly name: string;
  readonly defaultContent: string;
}

export const TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  {
    slug: 'vencimento-hoje',
    name: 'Vencimento hoje',
    defaultContent:
      '{Ola|Oi|Tudo bem}, {{nome_devedor}}. Sua cobranca de {{valor}} da {{nome_empresa}} vence hoje ({{data_vencimento}}).\n\nForma de pagamento: {{metodo_pagamento}}\nAcesse/pague por aqui: {{payment_link}}\nPix copia e cola: {{pix_copia_e_cola}}\nLinha digitavel: {{boleto_linha_digitavel}}\nBoleto: {{boleto_link}}\nPDF do boleto: {{boleto_pdf}}',
  },
  {
    slug: 'pre-vencimento',
    name: 'Lembrete antes do vencimento',
    defaultContent:
      '{Ola|Oi}, {{nome_devedor}}. Passando para lembrar que a cobranca de {{valor}} da {{nome_empresa}} vence em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\nAcesse/pague por aqui: {{payment_link}}\nPix copia e cola: {{pix_copia_e_cola}}\nLinha digitavel: {{boleto_linha_digitavel}}\nBoleto: {{boleto_link}}\nPDF do boleto: {{boleto_pdf}}',
  },
  {
    slug: 'atraso-primeiro-aviso',
    name: 'Primeiro aviso de atraso',
    defaultContent:
      '{Ola|Oi}, {{nome_devedor}}. Identificamos uma cobranca em aberto de {{valor}} da {{nome_empresa}}, vencida em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\nAcesse/pague por aqui: {{payment_link}}\nPix copia e cola: {{pix_copia_e_cola}}\nLinha digitavel: {{boleto_linha_digitavel}}\nBoleto: {{boleto_link}}\nPDF do boleto: {{boleto_pdf}}',
  },
  {
    slug: 'atraso-recorrente',
    name: 'Atraso recorrente',
    defaultContent:
      '{Ola|Oi}, {{nome_devedor}}. Ainda consta uma cobranca pendente de {{valor}} da {{nome_empresa}}, com vencimento em {{data_vencimento}}.\n\nForma de pagamento: {{metodo_pagamento}}\nAcesse/pague por aqui: {{payment_link}}\nPix copia e cola: {{pix_copia_e_cola}}\nLinha digitavel: {{boleto_linha_digitavel}}\nBoleto: {{boleto_link}}\nPDF do boleto: {{boleto_pdf}}',
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
