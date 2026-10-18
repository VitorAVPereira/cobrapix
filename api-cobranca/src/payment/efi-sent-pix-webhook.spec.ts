import { ConfigService } from '@nestjs/config';
import { EfiService } from './efi.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PaymentCryptoService } from './payment-crypto.service';
import type { PaymentNotificationsService } from './payment-notifications.service';
import type { PaymentChargeService } from './payment-charge.service';

// Payload shapes captured in the Efí homologation (efi-disbursement-validation.md).
describe('Pix webhook: Pix sent by collaborator payments', () => {
  const sent = {
    endToEndId: 'E09089356202610170823APIDICT3fa5',
    chave: 'chave-da-empresa',
    tipo: 'SOLICITACAO',
    status: 'REALIZADO',
    valor: '0.01',
    horario: '2026-10-17T08:23:31.000Z',
    gnExtras: { idEnvio: '0b0bc6de611e4415a2b63768d6d9f155' },
  };
  function fixture(result = 'APPLIED') {
    const prisma = {
      paymentCharge: { findFirst: jest.fn() },
      invoice: { findFirst: jest.fn() },
      paymentWebhookAnomaly: { upsert: jest.fn() },
    };
    const charges = { recordSettlement: jest.fn() };
    const disbursements = {
      apply: jest.fn().mockResolvedValue({ result, companyId: 'company-1' }),
    };
    const service = new EfiService(
      {} as ConfigService,
      prisma as unknown as PrismaService,
      {} as PaymentCryptoService,
      {} as PaymentNotificationsService,
      null,
      charges as unknown as PaymentChargeService,
      undefined,
      disbursements as never,
    );
    return { service, prisma, charges, disbursements };
  }

  it('goes to the collaborator payment and never looks up an invoice', async () => {
    const f = fixture();
    await expect(f.service.handlePixWebhook({ pix: [sent] })).resolves.toEqual({
      processed: true,
    });
    expect(f.disbursements.apply).toHaveBeenCalledWith(sent);
    expect(f.prisma.paymentCharge.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.invoice.findFirst).not.toHaveBeenCalled();
    expect(f.charges.recordSettlement).not.toHaveBeenCalled();
    expect(f.prisma.paymentWebhookAnomaly.upsert).not.toHaveBeenCalled();
  });

  it.each(['UNKNOWN_SEND_ID', 'SEND_KEY_MISMATCH', 'SEND_STATUS_CONFLICT'])(
    '%s is recorded as an anomaly and answered with success',
    async (result) => {
      const f = fixture(result);
      await expect(
        f.service.handlePixWebhook({ pix: [sent] }),
      ).resolves.toEqual({ processed: true });
      expect(f.prisma.paymentWebhookAnomaly.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            source: 'PIX',
            reasonCode: result,
            externalReference: sent.gnExtras.idEnvio,
            companyId: 'company-1',
          }) as unknown,
        }),
      );
    },
  );

  it('a received Pix (txid, no tipo) still follows the invoice path', async () => {
    const f = fixture();
    f.prisma.paymentCharge.findFirst.mockResolvedValue(null);
    f.prisma.invoice.findFirst.mockResolvedValue(null);
    await f.service.handlePixWebhook({
      pix: [{ txid: 'txid-1', valor: '1.00' }],
    });
    expect(f.disbursements.apply).not.toHaveBeenCalled();
    expect(f.prisma.paymentCharge.findFirst).toHaveBeenCalled();
  });

  it('the registration test notice is neither a payment nor an error', async () => {
    const f = fixture();
    await expect(
      f.service.handlePixWebhook({
        evento: 'teste_webhook',
        data_criacao: '2026-10-17T08:22:14.853Z',
      }),
    ).resolves.toEqual({ processed: false });
    expect(f.disbursements.apply).not.toHaveBeenCalled();
  });
});
