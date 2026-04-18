/**
 * Pool de templates Spintax para mensagens de cobrança.
 *
 * Cada template é resolvido pelo `spin()` a cada envio, produzindo variações
 * superficiais (saudação, conectivo, despedida) que mantêm o mesmo conteúdo
 * legal/informativo — mas evitam que a conta do WhatsApp seja flagada por
 * enviar strings idênticas em sequência.
 *
 * Placeholders disponíveis (formato `{{chave}}`):
 *   - {{debtorName}}
 *   - {{amount}}       (já formatado como BRL)
 *   - {{dueDate}}      (já formatado dd/MM/yyyy)
 *   - {{companyName}}
 *
 * Convenção: templates usam `\n` para quebras de linha. Evitar `{` e `}`
 * fora do Spintax para não confundir o parser.
 */

export const COLLECTION_TEMPLATES: string[] = [
  // Template 1 — formal tradicional
  [
    "{Prezado(a)|Caro(a)|Olá,} {{debtorName}},",
    "",
    "{Informamos|Comunicamos|Gostaríamos de informar} que consta em nosso sistema uma fatura em seu nome no valor de {{amount}}, com vencimento em {{dueDate}}.",
    "",
    "{Solicitamos a gentileza de regularizar|Pedimos que regularize|Agradecemos que efetue} o pagamento {o mais breve possível|assim que possível|na maior brevidade}.",
    "",
    "{Em caso de dúvidas,|Para qualquer esclarecimento,|Se precisar de ajuda,} entre em contato conosco.",
    "",
    "Atenciosamente,",
    "{{companyName}}",
  ].join("\n"),

  // Template 2 — direto, tom de lembrete
  [
    "{Olá|Oi}, {{debtorName}}! Tudo bem?",
    "",
    "{Passando|Estamos passando} aqui para {lembrar|avisar} sobre sua fatura de {{amount}} {com vencimento|que vence|que venceu} em {{dueDate}}.",
    "",
    "{Caso já tenha efetuado o pagamento,|Se o pagamento já foi feito,|Se já quitou,} {desconsidere esta mensagem|pode desconsiderar}. Obrigado!",
    "",
    "{Qualquer dúvida,|Dúvidas?|Se precisar,} {estamos à disposição|é só responder|fale conosco}.",
    "",
    "{{companyName}}",
  ].join("\n"),

  // Template 3 — cordial / call to action
  [
    "Olá, {{debtorName}}.",
    "",
    "{Identificamos|Notamos|Localizamos} em nosso sistema uma pendência no valor de {{amount}}, {cujo vencimento foi em|com data de vencimento|que venceu em} {{dueDate}}.",
    "",
    "{Para regularizar|Para resolver|Para quitar}, basta {responder esta mensagem|entrar em contato|nos chamar aqui}.",
    "",
    "{Agradecemos a atenção|Obrigado pela atenção|Ficamos no aguardo}.",
    "",
    "{{companyName}}",
  ].join("\n"),

  // Template 4 — curto e objetivo
  [
    "{Oi|Olá}, {{debtorName}}.",
    "",
    "{Fatura|Cobrança|Pendência} em aberto: {{amount}} — {venc.|vencimento|vencida em} {{dueDate}}.",
    "",
    "{Pode nos chamar aqui|Responda esta mensagem|Entre em contato} {para regularizar|para acertar|caso precise de ajuda}.",
    "",
    "{{companyName}}",
  ].join("\n"),
];

/**
 * Escolhe um template do pool de forma aleatória.
 * A seed opcional permite testes determinísticos.
 */
export function pickCollectionTemplate(
  rng: () => number = Math.random
): string {
  const index = Math.floor(rng() * COLLECTION_TEMPLATES.length);
  return COLLECTION_TEMPLATES[index];
}
