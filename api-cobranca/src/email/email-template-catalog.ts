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
    '{{saudacao}}, {{nome_devedor}}.\n\nSua cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, foi emitida com vencimento em {{data_vencimento}}.\n\n{{instrucoes}}\n\n{{assinatura}}',
  'pre-vencimento':
    '{{saudacao}}, {{nome_devedor}}.\n\nLembramos que sua cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, vence em {{data_vencimento}}.\n\n{{instrucoes}}\n\n{{assinatura}}',
  'vencimento-hoje':
    '{{saudacao}}, {{nome_devedor}}.\n\nSua cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, vence hoje, {{data_vencimento}}.\n\n{{instrucoes}}\n\n{{assinatura}}',
  'atraso-primeiro-aviso':
    '{{saudacao}}, {{nome_devedor}}.\n\nIdentificamos uma cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, vencida em {{data_vencimento}}.\n\n{{instrucoes}}\n\n{{assinatura}}',
  'atraso-recorrente':
    '{{saudacao}}, {{nome_devedor}}.\n\nAinda consta uma cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, com vencimento em {{data_vencimento}}.\n\n{{instrucoes}}\n\n{{assinatura}}',
  'atraso-critico':
    '{{saudacao}}, {{nome_devedor}}.\n\nSua cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, segue pendente desde {{data_vencimento}}.\n\n{{instrucoes}}\n\n{{assinatura}}',
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
      '{{saudacao}}, {{nome_devedor}}.\n\nVocê tem uma cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, com vencimento em {{data_vencimento}}.\n\n{{instrucoes}}\n\n{{assinatura}}',
  }));

export const DEFAULT_EMAIL_TEMPLATE_DEFINITION: EmailTemplateDefinition =
  EMAIL_TEMPLATE_DEFINITIONS[0] ?? {
    slug: 'cobranca-emissao',
    name: 'Cobranca na emissao',
    subject: '{{nome_empresa}}: cobranca emitida',
    content:
      '{{saudacao}}, {{nome_devedor}}.\n\nVocê tem uma cobrança de {{nome_empresa}} via CifraMais, no valor de {{valor}}, com vencimento em {{data_vencimento}}.\n\n{{instrucoes}}\n\n{{assinatura}}',
  };

export function getEmailTemplateDefinition(
  slug: string,
): EmailTemplateDefinition | null {
  return (
    EMAIL_TEMPLATE_DEFINITIONS.find((definition) => definition.slug === slug) ??
    null
  );
}
