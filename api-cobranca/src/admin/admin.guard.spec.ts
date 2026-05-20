import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

function buildContext(role?: UserRole): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('PlatformAdminGuard', () => {
  it('permite usuarios PLATFORM_ADMIN', () => {
    const guard = new PlatformAdminGuard();

    expect(guard.canActivate(buildContext(UserRole.PLATFORM_ADMIN))).toBe(true);
  });

  it('bloqueia usuarios COMPANY_ADMIN', () => {
    const guard = new PlatformAdminGuard();

    expect(() =>
      guard.canActivate(buildContext(UserRole.COMPANY_ADMIN)),
    ).toThrow(ForbiddenException);
  });
});
