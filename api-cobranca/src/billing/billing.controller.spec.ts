import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { BillingController } from './billing.controller';
import type { BillingService } from './billing.service';
import type { CollectionProfileService } from './collection-profile.service';

function fixture(whatsappStatus = 'DISCONNECTED') {
  const enqueueSelectedInvoices = jest
    .fn()
    .mockResolvedValue({ requested: 1, queued: 1, skipped: 0 });
  const findCompany = jest.fn().mockResolvedValue({
    id: 'company-1',
    whatsappStatus,
    whatsappInstanceId: null,
  });
  const controller = new BillingController(
    { enqueueSelectedInvoices } as unknown as BillingService,
    {} as CollectionProfileService,
    { company: { findUnique: findCompany } } as unknown as PrismaService,
  );
  return { controller, enqueueSelectedInvoices, findCompany };
}

describe('BillingController: envio selecionado pelo canal central', () => {
  it.each(['DISCONNECTED', 'CONNECTED'])(
    'permite a empresa sem instancia propria e com status legado %s',
    async (legacyStatus) => {
      const { controller, enqueueSelectedInvoices } = fixture(legacyStatus);

      await expect(
        controller.runSelectedBilling(
          { companyId: 'company-1' },
          { invoiceIds: ['invoice-1'], channels: ['WHATSAPP'] },
        ),
      ).resolves.toMatchObject({
        success: true,
        summary: { total: 1, queued: 1, skipped: 0 },
      });
      expect(enqueueSelectedInvoices).toHaveBeenCalledWith(
        'company-1',
        ['invoice-1'],
        { channels: ['WHATSAPP'], contacts: [] },
      );
    },
  );

  it('preserva a resposta de canal central pausado', async () => {
    const { controller, enqueueSelectedInvoices } = fixture();
    const paused = new ServiceUnavailableException({
      code: 'CENTRAL_CHANNEL_PAUSED',
      message: 'Este canal de comunicação está temporariamente pausado.',
    });
    enqueueSelectedInvoices.mockRejectedValue(paused);

    await expect(
      controller.runSelectedBilling(
        { companyId: 'company-1' },
        { invoiceIds: ['invoice-1'] },
      ),
    ).rejects.toBe(paused);
  });

  it('nao enfileira para uma empresa inexistente', async () => {
    const { controller, enqueueSelectedInvoices, findCompany } = fixture();
    findCompany.mockResolvedValue(null);

    await expect(
      controller.runSelectedBilling(
        { companyId: 'company-1' },
        { invoiceIds: ['invoice-1'] },
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(enqueueSelectedInvoices).not.toHaveBeenCalled();
  });
});
