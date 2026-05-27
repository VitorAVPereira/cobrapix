import {
  TEMPLATE_DEFINITIONS,
  TEMPLATE_SLUGS,
  TEMPLATE_VARIABLE_TAGS,
} from '../templates/template-catalog';

export { TEMPLATE_SLUGS, TEMPLATE_VARIABLE_TAGS };

export interface EmailTemplateDefinition {
  readonly slug: string;
  readonly name: string;
  readonly subject: string;
  readonly content: string;
}

const defaultBodyBySlug: Record<string, string> = {
  'cobranca-emissao':
    'Ola, {{nome_devedor}}.\n\nSua cobranca de {{valor}} da {{nome_empresa}} foi emitida com vencimento em {{data_vencimento}}.\n\nAcesse a pagina segura para pagar por {{metodo_pagamento}}: {{payment_link}}',
  'pre-vencimento':
    'Ola, {{nome_devedor}}.\n\nEstamos passando para lembrar que a cobranca de {{valor}} da {{nome_empresa}} vence em {{data_vencimento}}.\n\nPara pagar com seguranca, acesse: {{payment_link}}',
  'vencimento-hoje':
    'Ola, {{nome_devedor}}.\n\nSua cobranca de {{valor}} da {{nome_empresa}} vence hoje, {{data_vencimento}}.\n\nPara evitar atraso, acesse a pagina segura de pagamento: {{payment_link}}',
  'atraso-primeiro-aviso':
    'Ola, {{nome_devedor}}.\n\nIdentificamos uma cobranca em aberto de {{valor}} da {{nome_empresa}}, vencida em {{data_vencimento}}.\n\nRegularize com seguranca por aqui: {{payment_link}}',
  'atraso-recorrente':
    'Ola, {{nome_devedor}}.\n\nAinda consta uma cobranca pendente de {{valor}} da {{nome_empresa}}, com vencimento em {{data_vencimento}}.\n\nAcesse a pagina de pagamento: {{payment_link}}',
  'atraso-critico':
    'Ola, {{nome_devedor}}.\n\nSua cobranca de {{valor}} da {{nome_empresa}} segue pendente desde {{data_vencimento}}.\n\nAcesse a pagina segura para regularizar: {{payment_link}}',
};

const subjectBySlug: Record<string, string> = {
  'cobranca-emissao': '{{nome_empresa}}: cobranca emitida',
  'pre-vencimento': '{{nome_empresa}}: lembrete de vencimento',
  'vencimento-hoje': '{{nome_empresa}}: sua cobranca vence hoje',
  'atraso-primeiro-aviso': '{{nome_empresa}}: cobranca em aberto',
  'atraso-recorrente': '{{nome_empresa}}: lembrete de cobranca pendente',
  'atraso-critico': '{{nome_empresa}}: regularizacao de cobranca',
};

export const EMAIL_TEMPLATE_DEFINITIONS: readonly EmailTemplateDefinition[] =
  TEMPLATE_DEFINITIONS.map((definition) => ({
    slug: definition.slug,
    name: definition.name,
    subject: subjectBySlug[definition.slug] ?? '{{nome_empresa}}: cobranca',
    content:
      defaultBodyBySlug[definition.slug] ??
      'Ola, {{nome_devedor}}.\n\nVoce tem uma cobranca de {{valor}} da {{nome_empresa}} com vencimento em {{data_vencimento}}.\n\nAcesse: {{payment_link}}',
  }));

export const DEFAULT_EMAIL_TEMPLATE_DEFINITION: EmailTemplateDefinition =
  EMAIL_TEMPLATE_DEFINITIONS[0] ?? {
    slug: 'cobranca-emissao',
    name: 'Cobranca na emissao',
    subject: '{{nome_empresa}}: cobranca emitida',
    content:
      'Ola, {{nome_devedor}}.\n\nVoce tem uma cobranca de {{valor}} da {{nome_empresa}} com vencimento em {{data_vencimento}}.\n\nAcesse: {{payment_link}}',
  };

export function getEmailTemplateDefinition(
  slug: string,
): EmailTemplateDefinition | null {
  return (
    EMAIL_TEMPLATE_DEFINITIONS.find(
      (definition) => definition.slug === slug,
    ) ?? null
  );
}
