import { pickCollectionTemplate } from "./collection-templates";
import { interpolate, spin } from "./spintax";

interface CollectionMessageParams {
  debtorName: string;
  originalAmount: number;
  dueDate: Date;
  companyName: string;
}

/**
 * Monta a mensagem de cobrança final.
 *
 * Fluxo:
 *   1. Formata valor (BRL) e data (dd/MM/yyyy, America/Sao_Paulo).
 *   2. Escolhe um template Spintax aleatório do pool.
 *   3. Interpola placeholders `{{...}}` com os dados da fatura.
 *   4. Resolve os grupos Spintax `{a|b}` — cada chamada produz uma variação.
 *
 * Ordem importa: interpolação ANTES do spin para que nomes com caracteres
 * especiais não sejam interpretados como Spintax.
 */
export function buildCollectionMessage(
  params: CollectionMessageParams
): string {
  const { debtorName, originalAmount, dueDate, companyName } = params;

  const amount = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(originalAmount);

  const formattedDueDate = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(dueDate);

  const template = pickCollectionTemplate();
  const interpolated = interpolate(template, {
    debtorName,
    amount,
    dueDate: formattedDueDate,
    companyName,
  });

  return spin(interpolated);
}
