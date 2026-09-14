import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlatformAdminGuard } from '../admin/guards/platform-admin.guard';
import { CommunicationsController } from './communications.controller';

describe('CommunicationsController', () => {
  it('protects the reply endpoint with PlatformAdminGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      Reflect.get(CommunicationsController.prototype, 'reply'),
    ) as unknown[];
    expect(guards).toContain(PlatformAdminGuard);
  });
});
