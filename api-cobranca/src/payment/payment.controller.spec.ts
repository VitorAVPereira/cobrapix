import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { EfiService } from './efi.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentNotificationsService } from './payment-notifications.service';

describe('Manual payment status', () => {
  it('cannot forge provider-confirmed settlement', async () => {
    const prisma = {
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'invoice', status: 'PENDING' }),
        updateMany: jest.fn(),
      },
      collectionLog: { create: jest.fn() },
    };
    const controller = new PaymentController(
      {} as PaymentService,
      {} as EfiService,
      prisma as unknown as PrismaService,
      {
        notifyPaidInvoice: jest.fn(),
      } as unknown as PaymentNotificationsService,
    );
    await expect(
      controller.updateInvoiceStatus(
        { userId: 'user', companyId: 'company', email: 'user@example.test' },
        'invoice',
        { status: 'PAID' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });
});
