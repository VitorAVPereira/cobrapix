import { BadRequestException } from '@nestjs/common';
import { PaymentNotificationsController } from './payment-notifications.controller';
import type { PaymentNotificationsService } from './payment-notifications.service';

describe('PaymentNotificationsController', () => {
  const user = { companyId: 'company-1' };

  function build() {
    const service = {
      markManyAsRead: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const controller = new PaymentNotificationsController(
      service as unknown as PaymentNotificationsService,
    );
    return { controller, service };
  }

  it('marks the selected rows of the company from the token', async () => {
    const { controller, service } = build();

    await expect(
      controller.markManyAsRead(user, { ids: ['id-1', 'id-2'] }),
    ).resolves.toEqual({ count: 2 });
    expect(service.markManyAsRead).toHaveBeenCalledWith('company-1', {
      ids: ['id-1', 'id-2'],
    });
  });

  it('marks all of a filter only up to the moment of the list', async () => {
    const { controller, service } = build();

    await controller.markManyAsRead(user, {
      state: 'unread',
      billingType: 'PIX',
      asOf: '2026-10-18T18:00:00.000Z',
    });

    expect(service.markManyAsRead).toHaveBeenCalledWith('company-1', {
      filter: { state: 'unread', billingType: 'PIX' },
      asOf: new Date('2026-10-18T18:00:00.000Z'),
    });
  });

  it.each([
    ['nothing', {}],
    [
      'rows and a whole filter at once',
      { ids: ['id-1'], asOf: '2026-10-18T18:00:00.000Z' },
    ],
  ])('refuses %s', async (_label, body) => {
    const { controller, service } = build();

    await expect(controller.markManyAsRead(user, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.markManyAsRead).not.toHaveBeenCalled();
  });
});
