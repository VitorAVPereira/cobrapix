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

const ANY_VARIABLE = /\{\{[^{}]*\}\}/g;
const POSITIONAL_TOKEN = /^\{\{(\d+)\}\}$/;
/** Meta named parameters: lowercase letters, digits and underscores. */
const NAMED_TOKEN = /^\{\{([a-z_][a-z0-9_]*)\}\}$/;

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
 * Strict reader of the formats this version sends: BODY with positional ({{1}}) or named
 * ({{nome}}) variables as the provider declares, optional text FOOTER, at most one
 * dynamic URL button pointing at the payment page, at most one "Copy Pix code" payment
 * request button and static quick reply buttons. Anything else is reported with the
 * blocking component; nothing is rewritten to look compatible.
 */
export function parseTemplate(input: TemplateComponentsInput): ParseResult {
  const format = (input.parameterFormat ?? 'POSITIONAL').toUpperCase();
  if (format !== 'POSITIONAL' && format !== 'NAMED')
    return unsupported(`Formato de parâmetros ${format} não suportado.`);
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
  let variables: string[];
  if (format === 'NAMED') {
    // The declared format decides: a positional or malformed token is never guessed.
    const names = tokens.map((token) => NAMED_TOKEN.exec(token)?.[1]);
    if (names.some((name) => name === undefined))
      return unsupported(
        'BODY de template nomeado contém variáveis posicionais ou malformadas; use {{nome}} com letras minúsculas, números e _.',
      );
    variables = [...new Set(names as string[])];
  } else {
    const numbers = tokens.map((token) => POSITIONAL_TOKEN.exec(token)?.[1]);
    if (numbers.some((number) => number === undefined))
      return unsupported(
        'BODY contém variáveis nomeadas ou malformadas; apenas {{1}}, {{2}}... são suportadas.',
      );
    const positions = [...new Set(numbers.map(Number))].sort((a, b) => a - b);
    if (positions.some((position, index) => position !== index + 1))
      return unsupported(
        'Variáveis do BODY devem começar em {{1}} e não ter lacunas.',
      );
    variables = positions.map(String);
  }

  let paymentButton: { index: number; label: string; url: string } | null =
    null;
  let pixButton: { index: number; label: string } | null = null;
  const quickReplies: string[] = [];
  if (buttons !== null) {
    if (!buttons.length) return unsupported('BUTTONS sem botões.');
    for (const [index, button] of buttons.entries()) {
      if (!isRecord(button) || typeof button.text !== 'string')
        return unsupported('Botão sem tipo ou texto.');
      const type = String(button.type).toUpperCase();
      if (type === 'QUICK_REPLY') {
        if (/\{\{[^{}]*\}\}/.test(button.text))
          return unsupported('Resposta rápida com variáveis não é suportada.');
        quickReplies.push(button.text);
      } else if (type === 'URL') {
        if (paymentButton)
          return unsupported('Apenas um botão de URL (pagamento) é suportado.');
        if (typeof button.url !== 'string')
          return unsupported('Botão URL sem URL.');
        const expected = `${input.paymentBaseUrl.replace(/\/+$/, '')}/{{1}}`;
        if (button.url !== expected)
          return unsupported(
            `Botão URL deve apontar para ${expected}; URL aprovada diverge do link de pagamento.`,
          );
        paymentButton = { index, label: button.text, url: button.url };
      } else if (type === 'PAYMENT_REQUEST') {
        // The payment kind is declared by the provider, never guessed from the label.
        const setting = isRecord(button.payment_setting)
          ? button.payment_setting
          : undefined;
        const kind =
          typeof setting?.type === 'string' ? setting.type.toLowerCase() : '';
        if (kind !== 'pix_dynamic_code')
          return unsupported(
            `Botão de pagamento do tipo ${kind || 'não informado'} não é suportado; apenas o botão de copiar código Pix.`,
          );
        if (pixButton)
          return unsupported('Apenas um botão de código Pix é suportado.');
        pixButton = { index, label: button.text };
      } else
        return unsupported(
          `Botão do tipo ${type} não é suportado; use o link de pagamento, o botão de código Pix e respostas rápidas.`,
        );
    }
  }

  return {
    supported: true,
    template: {
      body,
      parameterFormat: format,
      variables,
      footer,
      paymentButton,
      pixButton,
      quickReplies,
      fingerprint: templateFingerprint(input),
    },
  };
}

/** Payment page prefix used by generated links: FRONTEND_URL + /pagar. */
export function paymentPageBaseUrl(frontendUrl: string | undefined): string {
  return `${(frontendUrl || 'http://localhost:3000').replace(/\/+$/, '')}/pagar`;
}

/** Re-parses a stored catalog row exactly as the sync classified it. */
export function parseStoredTemplate(
  row: {
    metaComponents: unknown;
    parameterFormat: string | null;
    metaLanguage: string;
    metaProviderCategory: string | null;
  },
  frontendUrl: string | undefined,
): ParseResult {
  return parseTemplate({
    components: row.metaComponents,
    parameterFormat: row.parameterFormat,
    language: row.metaLanguage,
    category: row.metaProviderCategory ?? 'UNKNOWN',
    paymentBaseUrl: paymentPageBaseUrl(frontendUrl),
  });
}
