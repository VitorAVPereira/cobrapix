import type { TemplatePurpose } from './template-contracts';

/** Placeholders accepted by the email catalog (WhatsApp uses admin mappings instead). */
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

/**
 * Commercial kinds of collection messages. They name the email templates and map to the
 * WhatsApp purposes; they no longer seed any WhatsApp template.
 */
export interface CollectionTemplateKind {
  readonly slug: string;
  readonly name: string;
  readonly purpose: TemplatePurpose;
}

export const TEMPLATE_DEFINITIONS: readonly CollectionTemplateKind[] = [
  {
    slug: 'cobranca-emissao',
    name: 'Cobranca na emissao',
    purpose: 'EMISSION',
  },
  { slug: 'vencimento-hoje', name: 'Vencimento hoje', purpose: 'DUE_TODAY' },
  {
    slug: 'pre-vencimento',
    name: 'Lembrete antes do vencimento',
    purpose: 'BEFORE_DUE',
  },
  {
    slug: 'atraso-primeiro-aviso',
    name: 'Primeiro aviso de atraso',
    purpose: 'FIRST_OVERDUE',
  },
  {
    slug: 'atraso-recorrente',
    name: 'Atraso recorrente',
    purpose: 'RECURRING_OVERDUE',
  },
  {
    slug: 'atraso-critico',
    name: 'Atraso critico',
    purpose: 'CRITICAL_OVERDUE',
  },
] as const;

export const TEMPLATE_SLUGS = TEMPLATE_DEFINITIONS.map(
  (definition) => definition.slug,
);
