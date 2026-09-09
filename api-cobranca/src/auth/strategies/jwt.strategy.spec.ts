import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth.types';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const userFindFirst = jest.fn();
  const prisma = {
    user: { findFirst: userFindFirst },
  } as unknown as PrismaService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue('a-secure-jwt-secret'),
  } as unknown as ConfigService;
  const payload: JwtPayload = {
    email: 'admin@cliente.com',
    sub: 'user-1',
    companyId: 'company-1',
    role: UserRole.COMPANY_ADMIN,
    mustChangePassword: true,
    tokenVersion: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retorna o estado atual quando a versão do token confere', async () => {
    userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'admin@cliente.com',
      name: 'Admin Cliente',
      companyId: 'company-1',
      role: UserRole.COMPANY_ADMIN,
      mustChangePassword: true,
      tokenVersion: 2,
    });
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      email: 'admin@cliente.com',
      name: 'Admin Cliente',
      companyId: 'company-1',
      role: UserRole.COMPANY_ADMIN,
      mustChangePassword: true,
      tokenVersion: 2,
    });
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', companyId: 'company-1' },
      select: {
        id: true,
        email: true,
        name: true,
        companyId: true,
        role: true,
        mustChangePassword: true,
        tokenVersion: true,
      },
    });
  });

  it('rejeita JWT emitido antes da última troca de senha', async () => {
    userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'admin@cliente.com',
      name: 'Admin Cliente',
      companyId: 'company-1',
      role: UserRole.COMPANY_ADMIN,
      mustChangePassword: false,
      tokenVersion: 3,
    });
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
