import {
  normalizeWhatsAppNumber,
  normalizeWhatsAppNumberForTransport,
} from './whatsapp-number';

describe('whatsapp-number', () => {
  it('usa +55 quando o codigo do pais nao foi informado', () => {
    expect(normalizeWhatsAppNumber('(11) 99999-9999')).toBe(
      '+5511999999999',
    );
  });

  it('preserva codigo do pais informado explicitamente', () => {
    expect(normalizeWhatsAppNumber('+1 (212) 555-1234')).toBe('+12125551234');
  });

  it('remove o sinal de mais para envio ao WhatsApp', () => {
    expect(normalizeWhatsAppNumberForTransport('+55 (11) 99999-9999')).toBe(
      '5511999999999',
    );
  });
});
