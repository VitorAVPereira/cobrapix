import { createHash } from 'node:crypto';
import { isRecord } from '../whatsapp/transport/whatsapp-transport.error';
import type { ParseResult } from './template-contracts';

export interface TemplateComponentsInput {
  components: unknown;
  parameterFormat?: string | null;
  language: string;
  category: string;
  /** Payment page prefix the button must target, e.g. https://app/pagar. */
  paymentBaseUrl: string;
}

const POSITIONAL = /\{\{(\d+)\}\}/g;
const ANY_VARIABLE = /\{\{[^{}]*\}\}/g;

/** Canonical JSON: sorted keys, provider `example` values dropped (they carry no meaning). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== 'example')
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function componentOrder(value: unknown): string {
  return isRecord(value) && typeof value.type === 'string'
    ? value.type.toUpperCase()
    : '';
}

/**
 * Content identity of an external template: components (order-insensitive by type),
 * language, category and parameter format. Quality or query time never change it.
 */
export function templateFingerprint(
  input: Omit<TemplateComponentsInput, 'paymentBaseUrl'>,
): string {
  const components = Array.isArray(input.components)
    ? (input.components as unknown[])
        .slice()
        .map(canonical)
        .sort((a, b) => componentOrder(a).localeCompare(componentOrder(b)))
    : canonical(input.components);
  return createHash('sha256')
    .update(
      JSON.stringify({
        components,
        language: input.language,
        category: input.category.toUpperCase(),
        parameterFormat: (input.parameterFormat ?? 'POSITIONAL').toUpperCase(),
      }),
    )
    .digest('hex');
}

function unsupported(reason: string): ParseResult {
  return { supported: false, reason };
}

/**
 * Strict reader of the formats this version sends: positional BODY, optional text FOOTER
 * and optionally one dynamic URL button pointing at the payment page. Anything else is
 * reported with the blocking component; nothing is rewritten to look compatible.
 */
export function parseTemplate(input: TemplateComponentsInput): ParseResult {
  const format = (input.parameterFormat ?? 'POSITIONAL').toUpperCase();
  if (format !== 'POSITIONAL')
    return unsupported(
      `Formato de parâmetros ${format} não suportado; use variáveis posicionais.`,
    );
  if (input.category.toUpperCase() === 'AUTHENTICATION')
    return unsupported('Templates de autenticação não são suportados.');
  if (!Array.isArray(input.components) || !input.components.length)
    return unsupported('Componentes do template ausentes ou inválidos.');
  const parts = input.components as unknown[];
  let body: string | null = null;
  let footer: string | null = null;
  let buttons: unknown[] | null = null;
  for (const part of parts) {
    if (!isRecord(part) || typeof part.type !== 'string')
      return unsupported('Componente sem tipo reconhecível.');
    const type = part.type.toUpperCase();
    if (type === 'BODY') {
      if (body !== null) return unsupported('Mais de um componente BODY.');
      if (typeof part.text !== 'string' || !part.text.trim())
        return unsupported('BODY sem texto.');
      body = part.text;
    } else if (type === 'FOOTER') {
      if (footer !== null) return unsupported('Mais de um componente FOOTER.');
      if (typeof part.text !== 'string')
        return unsupported('FOOTER sem texto.');
      if (/\{\{[^{}]*\}\}/.test(part.text))
        return unsupported('FOOTER com variáveis não é suportado.');
      footer = part.text;
    } else if (type === 'BUTTONS') {
      if (buttons !== null)
        return unsupported('Mais de um componente BUTTONS.');
      if (!Array.isArray(part.buttons))
        return unsupported('BUTTONS sem lista de botões.');
      buttons = part.buttons as unknown[];
    } else if (type === 'HEADER') {
      return unsupported(
        'Cabeçalho (HEADER) não é suportado nesta versão, inclusive de mídia.',
      );
    } else return unsupported(`Componente ${type} não é suportado.`);
  }
  if (body === null) return unsupported('Template sem componente BODY.');

  const tokens = Array.from(body.matchAll(ANY_VARIABLE), (match) => match[0]);
  if (tokens.some((token) => !/^\{\{\d+\}\}$/.test(token)))
    return unsupported(
      'BODY contém variáveis nomeadas ou malformadas; apenas {{1}}, {{2}}... são suportadas.',
    );
  const positions = [
    ...new Set(
      Array.from(body.matchAll(POSITIONAL), (match) => Number(match[1])),
    ),
  ].sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index + 1))
    return unsupported(
      'Variáveis do BODY devem começar em {{1}} e não ter lacunas.',
    );

  let paymentButton: { index: 0; label: string; url: string } | null = null;
  if (buttons !== null) {
    if (buttons.length !== 1)
      return unsupported('Apenas um botão de pagamento é suportado.');
    const button = buttons[0];
    if (!isRecord(button) || String(button.type).toUpperCase() !== 'URL')
      return unsupported('Apenas botão do tipo URL é suportado.');
    if (typeof button.text !== 'string' || typeof button.url !== 'string')
      return unsupported('Botão URL sem texto ou URL.');
    const expected = `${input.paymentBaseUrl.replace(/\/+$/, '')}/{{1}}`;
    if (button.url !== expected)
      return unsupported(
        `Botão URL deve apontar para ${expected}; URL aprovada diverge do link de pagamento.`,
      );
    paymentButton = { index: 0, label: button.text, url: button.url };
  }

  return {
    supported: true,
    template: {
      body,
      positions,
      footer,
      paymentButton,
      fingerprint: templateFingerprint(input),
    },
  };
}

/** Payment page prefix used by generated links: FRONTEND_URL + /pagar. */
export function paymentPageBaseUrl(frontendUrl: string | undefined): string {
  return `${(frontendUrl || 'http://localhost:3000').replace(/\/+$/, '')}/pagar`;
}
