import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';

describe('SettlementsController', () => {
  const list = jest.fn().mockResolvedValue({ data: [] });
  const controller = new SettlementsController({
    list,
  } as unknown as SettlementsService);

  it('is restricted to the platform admin', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SettlementsController,
    ) as unknown[];
    expect(guards).toContain(PlatformAdminGuard);
  });

  it('normalizes pagination and rejects invalid filters', async () => {
    await controller.list(undefined, 'DIVERGENT', '0', '1000');
    expect(list).toHaveBeenCalledWith({
      companyId: undefined,
      status: 'DIVERGENT',
      page: 1,
      pageSize: 100,
    });
    expect(() => controller.list('not-a-uuid')).toThrow();
    expect(() => controller.list(undefined, 'PAID')).toThrow();
  });
});
