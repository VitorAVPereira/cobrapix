/**
 * Digits of a CPF/CNPJ or phone search, ignoring punctuation. A search with
 * letters is a name: its numbers ("Ana 33") are not a document.
 */
export function searchDigits(search: string): string {
  const digits = search.replace(/\D/g, '');
  return digits && !/\p{L}/u.test(search) ? digits : search;
}
