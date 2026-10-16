import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DisbursementsController } from './disbursements.controller';

describe('DisbursementsController', () => {
  const user = { userId: 'user', companyId: 'session-company' } as never;
  const settings = { companyStatus: jest.fn() };
  const recipients = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    import: jest.fn(),
  };
  const batches = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
    retryFailed: jest.fn(),
  };
  const controller = new DisbursementsController(
    settings as never,
    recipients as never,
    batches as never,
  );
  const row = { name: 'Ana', document: '52998224725', pixKey: '52998224725' };

  it('requires an authenticated session', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DisbursementsController),
    ).toEqual([JwtAuthGuard]);
  });

  it('always uses the company of the session', async () => {
    await controller.status(user);
    await controller.listRecipients(user, { page: 1, pageSize: 20 });
    await controller.createRecipient(user, row);
    await controller.updateRecipient(user, 'id', {
      ...row,
      expectedVersion: 1,
      active: true,
    });
    await controller.importRecipients(user, { rows: [row] });
    const batch = {
      reference: 'Folha',
      items: [{ recipientId: 'r', amountCents: 1 }],
    };
    await controller.listBatches(user, { page: 1, pageSize: 20 });
    await controller.getBatch(user, 'id');
    await controller.createBatch(user, batch);
    await controller.updateBatch(user, 'id', { ...batch, expectedVersion: 1 });
    await controller.cancelBatch(user, 'id');
    await controller.retryFailed(user, 'id');
    for (const call of [
      settings.companyStatus,
      recipients.list,
      recipients.create,
      recipients.update,
      recipients.import,
      ...Object.values(batches),
    ])
      expect((call.mock.calls as unknown[][])[0][0]).toBe('session-company');
  });
});
