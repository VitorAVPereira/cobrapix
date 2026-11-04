import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanyProduct, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth.types';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../decorators/allow-password-change-required.decorator';
import { COMPANY_PRODUCTS_KEY } from '../decorators/company-products.decorator';
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
    companyProduct: 'BILLING',
    mustChangePassword: true,
    tokenVersion: 0,
  };
  const ready: AuthenticatedUser = { ...user, mustChangePassword: false };

  function routeMetadata(options: {
    allowPasswordChange?: boolean;
    products?: CompanyProduct[];
  }): void {
    getAllAndOverride.mockImplementation((key: string) => {
      if (key === ALLOW_PASSWORD_CHANGE_REQUIRED_KEY)
        return options.allowPasswordChange;
      if (key === COMPANY_PRODUCTS_KEY) return options.products;
      return undefined;
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bloqueia endpoint comum durante o primeiro acesso', () => {
    routeMetadata({ allowPasswordChange: false });
    const guard = new JwtAuthGuard(reflector);

    expect(() =>
      guard.handleRequest<AuthenticatedUser>(null, user, null, context),
    ).toThrow(ForbiddenException);
  });

  it('permite endpoint explicitamente liberado durante o primeiro acesso', () => {
    routeMetadata({ allowPasswordChange: true });
    const guard = new JwtAuthGuard(reflector);

    expect(
      guard.handleRequest<AuthenticatedUser>(null, user, null, context),
    ).toEqual(user);
  });

  it('rota sem produto declarado é de cobrança', () => {
    routeMetadata({});
    const guard = new JwtAuthGuard(reflector);

    expect(
      guard.handleRequest<AuthenticatedUser>(null, ready, null, context),
    ).toEqual(ready);
    expect(() =>
      guard.handleRequest<AuthenticatedUser>(
        null,
        { ...ready, companyProduct: 'CHECKOUT' },
        null,
        context,
      ),
    ).toThrow(NotFoundException);
  });

  it('rota do checkout recusa empresa de cobrança com 404', () => {
    routeMetadata({ products: ['CHECKOUT'] });
    const guard = new JwtAuthGuard(reflector);
    const seller = { ...ready, companyProduct: 'CHECKOUT' as const };

    expect(
      guard.handleRequest<AuthenticatedUser>(null, seller, null, context),
    ).toEqual(seller);
    expect(() =>
      guard.handleRequest<AuthenticatedUser>(null, ready, null, context),
    ).toThrow(NotFoundException);
  });

  it('rotas de sessão valem para os dois produtos', () => {
    routeMetadata({ products: ['BILLING', 'CHECKOUT'] });
    const guard = new JwtAuthGuard(reflector);
    const seller = { ...ready, companyProduct: 'CHECKOUT' as const };

    expect(
      guard.handleRequest<AuthenticatedUser>(null, seller, null, context),
    ).toEqual(seller);
    expect(
      guard.handleRequest<AuthenticatedUser>(null, ready, null, context),
    ).toEqual(ready);
  });

  it('admin da plataforma não é afetado pelo produto da rota', () => {
    routeMetadata({ products: ['CHECKOUT'] });
    const guard = new JwtAuthGuard(reflector);
    const admin = { ...ready, role: UserRole.PLATFORM_ADMIN };

    expect(
      guard.handleRequest<AuthenticatedUser>(null, admin, null, context),
    ).toEqual(admin);
  });
});
