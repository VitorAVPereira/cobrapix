export const TEMPLATE_VARIABLE_TAGS = [
  'debtorName',
  'originalAmount',
  'dueDate',
  'companyName',
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
      '{Ola|Oi|Tudo bem}, {debtorName}. A cobranca de {originalAmount} da {companyName} vence hoje ({dueDate}).',
  },
  {
    slug: 'pre-vencimento',
    name: 'Lembrete antes do vencimento',
    defaultContent:
      '{Ola|Oi}, {debtorName}. Passando para lembrar que a cobranca de {originalAmount} da {companyName} vence em {dueDate}.',
  },
  {
    slug: 'atraso-primeiro-aviso',
    name: 'Primeiro aviso de atraso',
    defaultContent:
      '{Ola|Oi}, {debtorName}. Identificamos uma cobranca em aberto de {originalAmount} da {companyName}, vencida em {dueDate}.',
  },
  {
    slug: 'atraso-recorrente',
    name: 'Atraso recorrente',
    defaultContent:
      '{Ola|Oi}, {debtorName}. Ainda consta uma cobranca pendente de {originalAmount} da {companyName}, com vencimento em {dueDate}.',
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
