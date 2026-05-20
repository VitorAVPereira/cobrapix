import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService roles', () => {
  it('inclui role no token e no usuario retornado no login', async () => {
    const password = await bcrypt.hash('senha123', 4);
    const sign = jest.fn().mockReturnValue('signed-token');
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'admin@cobrapix.com',
          password,
          name: 'Admin CobraPix',
          companyId: 'company-1',
          role: UserRole.PLATFORM_ADMIN,
          company: { id: 'company-1' },
        }),
      },
    } as unknown as PrismaService;

    const service = new AuthService(prisma, { sign } as never);
    const result = await service.login({
      email: 'admin@cobrapix.com',
      password: 'senha123',
    });

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        role: UserRole.PLATFORM_ADMIN,
        companyId: 'company-1',
      }),
      { expiresIn: '7d' },
    );
    expect(result.user).toEqual(
      expect.objectContaining({
        id: 'user-1',
        role: UserRole.PLATFORM_ADMIN,
      }),
    );
  });
});
