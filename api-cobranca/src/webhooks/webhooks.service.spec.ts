import { PrismaService } from '../prisma/prisma.service';
import { EfiService } from '../payment/efi.service';
import { CheckoutPaymentsService } from '../checkout/checkout-payments.service';
import { CheckoutCardService } from '../checkout/checkout-card.service';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService (charges)', () => {
  const efi = { handleChargesWebhook: jest.fn() };
  const card = { handleNotification: jest.fn() };
  const prisma = { efiAccountIdentity: { findUnique: jest.fn() } };
  const service = new WebhooksService(
    efi as unknown as EfiService,
    {} as CheckoutPaymentsService,
    card as unknown as CheckoutCardService,
    prisma as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('aviso de cartão da conta Cifra+ vai para o checkout, não para a cobrança', async () => {
    prisma.efiAccountIdentity.findUnique.mockResolvedValue({
      ownership: 'PLATFORM',
    });
    card.handleNotification.mockResolvedValue(true);

    await expect(
      service.handleEfiChargesWebhook(
        { notification: 'tok-1' },
        undefined,
        'identity-cifra',
      ),
    ).resolves.toEqual({ processed: true });
    expect(card.handleNotification).toHaveBeenCalledWith(
      'identity-cifra',
      'tok-1',
    );
    expect(efi.handleChargesWebhook).not.toHaveBeenCalled();
  });

  it('conta de empresa continua no fluxo da cobrança', async () => {
    prisma.efiAccountIdentity.findUnique.mockResolvedValue({
      ownership: 'COMPANY',
    });
    efi.handleChargesWebhook.mockResolvedValue({ processed: true });

    await service.handleEfiChargesWebhook(
      { notification: 'tok-2' },
      undefined,
      'identity-empresa',
    );
    expect(efi.handleChargesWebhook).toHaveBeenCalledWith(
      { notification: 'tok-2' },
      undefined,
      'identity-empresa',
    );
    expect(card.handleNotification).not.toHaveBeenCalled();
  });
});
