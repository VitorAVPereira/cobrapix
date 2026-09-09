import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const getAllAndOverride = jest.fn();
  const reflector = {
    getAllAndOverride,
  } as unknown as Reflector;
  const handler = (): void => undefined;
  class TestController {}
  const context = {
    getHandler: (): typeof handler => handler,
    getClass: (): typeof TestController => TestController,
  } as unknown as ExecutionContext;
  const user: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@cliente.com',
    name: 'Admin Cliente',
    companyId: 'company-1',
    role: UserRole.COMPANY_ADMIN,
    mustChangePassword: true,
    tokenVersion: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bloqueia endpoint comum durante o primeiro acesso', () => {
    getAllAndOverride.mockReturnValue(false);
    const guard = new JwtAuthGuard(reflector);

    expect(() =>
      guard.handleRequest<AuthenticatedUser>(null, user, null, context),
    ).toThrow(ForbiddenException);
  });

  it('permite endpoint explicitamente liberado durante o primeiro acesso', () => {
    getAllAndOverride.mockReturnValue(true);
    const guard = new JwtAuthGuard(reflector);

    expect(
      guard.handleRequest<AuthenticatedUser>(null, user, null, context),
    ).toEqual(user);
  });
});
