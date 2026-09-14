import { matchesBoletoMode } from './efi-boleto-mode';

describe('provider boleto modality', () => {
  it.each([
    ['BOLETO', undefined, true],
    ['BOLETO', 'pix-code', false],
    ['BOLIX', 'pix-code', true],
    ['BOLIX', undefined, false],
  ] as const)(
    'validates %s against the actual QR payload',
    (method, payload, matches) => {
      expect(matchesBoletoMode(method, payload)).toBe(matches);
    },
  );
});
