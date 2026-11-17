import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { EfiCardClient } from '../payment/efi-card.client';
import { checkoutCardNotificationUrl } from '../checkout/efi-checkout-card.client';
import { EfiWebhookGuard } from './efi-webhook.guard';

/**
 * The URL a card charge gives the Efí must get through the guard of the
 * route it points to: a notice the guard refuses never reaches the system.
 */
describe('URL de aviso do cartão', () => {
  const SECRET = 'efi_webhook_secret_with_more_than_32_chars';
  const configOf = (env: Record<string, string | undefined>) =>
    ({
      get: (key: string) => env[key],
      getOrThrow: (key: string) => {
        if (!env[key]) throw new Error(key);
        return env[key];
      },
    }) as unknown as ConfigService;
  const config = configOf({
    EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.com',
    EFI_WEBHOOK_SECRET: SECRET,
  });
  const billing = (from: ConfigService) =>
    new EfiCardClient(
      {} as PrismaService,
      {} as PaymentCryptoService,
      from,
    ).notificationUrl('conta-1');

  /** What the guard decides for a request to this URL. */
  const accepted = (url: string): boolean => {
    const target = new URL(url);
    const request = {
      header: () => undefined,
      query: Object.fromEntries(target.searchParams),
    };
    return new EfiWebhookGuard(config).canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext);
  };

  it.each([
    ['checkout', () => checkoutCardNotificationUrl(config, 'conta-1')],
    ['cobrança', () => billing(config)],
  ])('%s: passa pelo guard e diz a conta emissora', (_name, build) => {
    const url = build();
    expect(url).not.toBeNull();
    const target = new URL(url as string);
    expect(target.origin + target.pathname).toBe(
      'https://api.example.com/webhooks/efi/cobrancas',
    );
    expect(target.searchParams.get('account')).toBe('conta-1');
    expect(accepted(url as string)).toBe(true);
  });

  it('sem o segredo ou com endereço inválido, o cartão não fica disponível', () => {
    for (const env of [
      { EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.com' },
      {
        EFI_CHARGES_WEBHOOK_BASE_URL: 'http://api.example.com',
        EFI_WEBHOOK_SECRET: SECRET,
      },
      {
        EFI_CHARGES_WEBHOOK_BASE_URL: 'https://api.example.com/x',
        EFI_WEBHOOK_SECRET: SECRET,
      },
      { EFI_WEBHOOK_SECRET: SECRET },
    ]) {
      expect(checkoutCardNotificationUrl(configOf(env), 'conta-1')).toBeNull();
      expect(() => billing(configOf(env))).toThrow();
    }
  });
});
