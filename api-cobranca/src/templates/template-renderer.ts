import type { BillingMethod } from '@prisma/client';
import { isRecord } from '../whatsapp/transport/whatsapp-transport.error';
import {
  ParsedTemplate,
  RenderResult,
  RenderValues,
  TEMPLATE_LITERAL_MAX_LENGTH,
  TEMPLATE_MAX_BODY_PARAMETERS,
  TEMPLATE_PARAMETER_MAX_LENGTH,
  TEMPLATE_SOURCES,
  TemplateMapping,
  TemplateSource,
} from './template-contracts';

export type MappingCheck =
  | { ok: true }
  | { ok: false; field: string; reason: string };

/** The provider refuses line breaks, tabs and long runs of spaces in parameters. */
function acceptedParameter(value: string): boolean {
  return (
    value.trim().length > 0 &&
    value.length <= TEMPLATE_PARAMETER_MAX_LENGTH &&
    !/[\r\n\t]/.test(value) &&
    !/ {5,}/.test(value)
  );
}

/**
 * Admin mapping of one parsed revision: every variable bound exactly once to a closed
 * source or a bounded literal, and each button bound iff the template has it.
 * No expressions, database paths or URLs are accepted.
 */
export function validateMapping(
  parsed: ParsedTemplate,
  mapping: unknown,
): MappingCheck {
  const fail = (field: string, reason: string): MappingCheck => ({
    ok: false,
    field,
    reason,
  });
  if (!isRecord(mapping) || !isRecord(mapping.body))
    return fail('body', 'Mapa inválido.');
  if (parsed.variables.length > TEMPLATE_MAX_BODY_PARAMETERS)
    return fail('body', 'Quantidade de variáveis acima do suportado.');
  const allowedKeys = new Set([
    'body',
    'paymentButton',
    'pixButton',
    'boletoButton',
  ]);
  const extra = Object.keys(mapping).find((key) => !allowedKeys.has(key));
  if (extra) return fail(extra, 'Campo não suportado.');
  const variables = new Set(parsed.variables);
  for (const key of Object.keys(mapping.body))
    if (!variables.has(key))
      return fail(`body.${key}`, 'Variável inexistente no template.');
  for (const variable of parsed.variables) {
    const field = `body.${variable}`;
    const binding = mapping.body[variable];
    if (!isRecord(binding)) return fail(field, 'Variável sem fonte.');
    if (binding.kind === 'SOURCE') {
      if (
        Object.keys(binding).length !== 2 ||
        !(TEMPLATE_SOURCES as readonly unknown[]).includes(binding.source)
      )
        return fail(field, 'Fonte fora da lista permitida.');
    } else if (binding.kind === 'LITERAL') {
      const value = binding.value;
      if (
        Object.keys(binding).length !== 2 ||
        typeof value !== 'string' ||
        value.length > TEMPLATE_LITERAL_MAX_LENGTH ||
        !acceptedParameter(value) ||
        /\{\{|\}\}|https?:\/\/|www\./i.test(value)
      )
        return fail(
          field,
          'Texto fixo deve ser curto, sem variáveis, links ou quebras de linha.',
        );
    } else return fail(field, 'Tipo de vínculo não suportado.');
  }
  const button = mapping.paymentButton;
  if (parsed.paymentButton) {
    if (
      !isRecord(button) ||
      button.index !== parsed.paymentButton.index ||
      button.source !== 'PAYMENT_URL_SUFFIX' ||
      Object.keys(button).length !== 2
    )
      return fail('paymentButton', 'Botão exige o link desta cobrança.');
  } else if (button !== undefined)
    return fail('paymentButton', 'O template aprovado não tem botão.');
  const pix = mapping.pixButton;
  if (parsed.pixButton) {
    if (
      !isRecord(pix) ||
      pix.index !== parsed.pixButton.index ||
      pix.source !== 'PIX_COPY_PASTE' ||
      Object.keys(pix).length !== 2
    )
      return fail(
        'pixButton',
        'Botão exige o Pix copia e cola desta cobrança.',
      );
  } else if (pix !== undefined)
    return fail(
      'pixButton',
      'O template aprovado não tem botão de código Pix.',
    );
  const boleto = mapping.boletoButton;
  if (parsed.boletoButton) {
    if (
      !isRecord(boleto) ||
      boleto.index !== parsed.boletoButton.index ||
      boleto.source !== 'BOLETO_LINE' ||
      Object.keys(boleto).length !== 2
    )
      return fail(
        'boletoButton',
        'Botão exige a linha digitável desta cobrança.',
      );
  } else if (boleto !== undefined)
    return fail(
      'boletoButton',
      'O template aprovado não tem botão de código do boleto.',
    );
  return { ok: true };
}

/** Sources a mapping reads; the context loader fetches only these. */
export function mappingSources(mapping: TemplateMapping): TemplateSource[] {
  return [
    ...new Set([
      ...Object.values(mapping.body).flatMap((binding) =>
        binding.kind === 'SOURCE' ? [binding.source] : [],
      ),
      ...(mapping.pixButton ? [mapping.pixButton.source] : []),
      ...(mapping.boletoButton ? [mapping.boletoButton.source] : []),
    ]),
  ];
}

const BOLETO_SOURCES: readonly TemplateSource[] = [
  'BOLETO_LINE',
  'BOLETO_LINK',
  'BOLETO_PDF',
];

/** Charge data a mapped template reads: the Pix code and/or the boleto (buttons included). */
export function templateDataNeeds(mapping: TemplateMapping): {
  pix: boolean;
  boleto: boolean;
} {
  const sources = mappingSources(mapping);
  return {
    pix: sources.includes('PIX_COPY_PASTE'),
    boleto: sources.some((source) => BOLETO_SOURCES.includes(source)),
  };
}

/** A Pix charge has no boleto and a boleto charge no Pix code; BOLIX has both. */
export function methodCanFill(
  method: BillingMethod,
  needs: { pix: boolean; boleto: boolean },
): boolean {
  if (method === 'CREDIT_CARD') return !needs.pix && !needs.boleto;
  if (method === 'PIX') return !needs.boleto;
  if (method === 'BOLETO') return !needs.pix;
  return true;
}

/**
 * Parameters of the approved revision from server-resolved values. Missing or refused
 * values fail the whole render: nothing is sent empty, undefined or partially.
 */
export function renderTemplate(
  parsed: ParsedTemplate,
  mapping: TemplateMapping,
  values: RenderValues,
  paymentUrl?: string,
): RenderResult {
  const check = validateMapping(parsed, mapping);
  if (!check.ok) return { ok: false, code: 'UNSUPPORTED', field: check.field };
  const byVariable = new Map<string, string>();
  for (const variable of parsed.variables) {
    const binding = mapping.body[variable]!;
    const field =
      binding.kind === 'SOURCE' ? binding.source : `body.${variable}`;
    const value =
      binding.kind === 'SOURCE' ? values[binding.source] : binding.value;
    if (value === undefined || !value.trim())
      return { ok: false, code: 'VALUE_MISSING', field };
    if (!acceptedParameter(value))
      return { ok: false, code: 'UNSUPPORTED', field };
    byVariable.set(variable, value);
  }
  let paymentButtonSuffix: string | undefined;
  if (parsed.paymentButton) {
    if (!paymentUrl)
      return { ok: false, code: 'VALUE_MISSING', field: 'PAYMENT_URL' };
    const prefix = parsed.paymentButton.url.slice(0, -'{{1}}'.length);
    const suffix = paymentUrl.startsWith(prefix)
      ? paymentUrl.slice(prefix.length)
      : '';
    // The approved base plus one opaque path segment for this invoice; nothing else.
    if (!/^[A-Za-z0-9._~-]{1,1024}$/.test(suffix))
      return { ok: false, code: 'UNSUPPORTED', field: 'PAYMENT_URL' };
    paymentButtonSuffix = suffix;
  }
  let pixButtonCode: string | undefined;
  if (parsed.pixButton) {
    // Only the code of this invoice; without it the send waits, never goes out empty.
    const code = values.PIX_COPY_PASTE;
    if (code === undefined || !code.trim())
      return { ok: false, code: 'VALUE_MISSING', field: 'PIX_COPY_PASTE' };
    if (!acceptedParameter(code))
      return { ok: false, code: 'UNSUPPORTED', field: 'PIX_COPY_PASTE' };
    pixButtonCode = code;
  }
  let boletoButtonCode: string | undefined;
  if (parsed.boletoButton) {
    const line = values.BOLETO_LINE;
    if (line === undefined || !line.trim())
      return { ok: false, code: 'VALUE_MISSING', field: 'BOLETO_LINE' };
    // The provider copies the 47 digits of a bank boleto; Efí formats them with dots.
    const digits = line.replace(/[\s.]/g, '');
    if (!/^\d{47}$/.test(digits))
      return { ok: false, code: 'UNSUPPORTED', field: 'BOLETO_LINE' };
    boletoButtonCode = digits;
  }
  const body = parsed.body.replace(
    /\{\{([a-z0-9_]+)\}\}/g,
    (match: string, variable: string) => byVariable.get(variable) ?? match,
  );
  return {
    ok: true,
    body,
    bodyParameters: parsed.variables.map(
      (variable) => byVariable.get(variable)!,
    ),
    ...(parsed.parameterFormat === 'NAMED'
      ? { bodyParameterNames: [...parsed.variables] }
      : {}),
    ...(paymentButtonSuffix ? { paymentButtonSuffix } : {}),
    ...(pixButtonCode ? { pixButtonCode } : {}),
    ...(boletoButtonCode ? { boletoButtonCode } : {}),
  };
}

/** Due dates are stored at 12:00 UTC of the civil day; never shift the day by time zone. */
export function formatCivilDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export function formatAmount(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(value)
    .replace(/\s/g, ' ');
}

/** Synthetic values of the admin preview; never real customer data. */
export function syntheticValues(paymentBaseUrl: string): {
  values: Required<RenderValues>;
  paymentUrl: string;
} {
  const paymentUrl = `${paymentBaseUrl}/exemplo-token`;
  return {
    paymentUrl,
    values: {
      DEBTOR_NAME: 'Maria Exemplo',
      COMPANY_NAME: 'Empresa Exemplo',
      AMOUNT: formatAmount(150),
      DUE_DATE: '05/10/2026',
      PAYMENT_LINK: paymentUrl,
      PIX_COPY_PASTE: '00020101021226860014br.gov.bcb.pix2564exemplo',
      BOLETO_LINE: '34191.79001 01043.510047 91020.150008 1 98760000015050',
      BOLETO_LINK: 'https://boleto.exemplo/cobranca',
      BOLETO_PDF: 'https://boleto.exemplo/cobranca.pdf',
      REPRESENTATIVE_NAME: 'Ana Representante',
    },
  };
}
