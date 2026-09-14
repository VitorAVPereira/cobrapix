export function matchesBoletoMode(
  requested: 'BOLETO' | 'BOLIX',
  pixPayload: string | undefined,
): boolean {
  const hasPix = Boolean(pixPayload?.trim());
  return requested === 'BOLIX' ? hasPix : !hasPix;
}
