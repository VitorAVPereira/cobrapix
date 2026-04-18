/**
 * Parser Spintax minimalista para variar mensagens de WhatsApp.
 *
 * Sintaxe: `{opcao1|opcao2|opcao3}` — a cada chamada de `spin()` uma das
 * opções é escolhida aleatoriamente. Suporta aninhamento:
 *
 *   "Olá {caro|prezado{,| amigo}} cliente"
 *
 * Os separadores `|` dentro de um grupo aninhado pertencem ao grupo interno.
 *
 * Motivação: variar o texto entre envios reduz a chance do WhatsApp marcar
 * a conta como spam por mensagens idênticas em sequência.
 */

/**
 * Resolve recursivamente todos os grupos Spintax do template, do mais interno
 * para o mais externo. Cada grupo é substituído por uma das suas opções,
 * escolhida aleatoriamente.
 */
export function spin(template: string, rng: () => number = Math.random): string {
  // Trava contra templates patológicos / loops.
  const MAX_ITERATIONS = 1000;
  let current = template;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Encontra o grupo mais interno: { seguido de conteúdo SEM chaves, depois }.
    // Isso garante que aninhamentos sejam resolvidos bottom-up.
    const match = current.match(/\{([^{}]*)\}/);
    if (!match) {
      return current;
    }

    const [full, inner] = match;
    const options = inner.split("|");
    const picked = options[Math.floor(rng() * options.length)];

    current =
      current.slice(0, match.index) +
      picked +
      current.slice((match.index ?? 0) + full.length);
  }

  throw new Error(
    "spintax: limite de iterações atingido — template provavelmente mal formado"
  );
}

/**
 * Interpola placeholders no formato `{{chave}}`. Chaves desconhecidas ficam
 * intactas para ajudar no debug.
 *
 * Importante: roda ANTES do `spin()` para que o conteúdo interpolado não
 * seja interpretado como Spintax (caso contenha `|`).
 */
export function interpolate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (full, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : full
  );
}
