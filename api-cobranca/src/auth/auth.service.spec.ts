import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import {
  ResendMailerService,
  SendResendEmailInput,
  SendResendEmailResult,
} from '../common/resend-mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

interface TransactionClientMock {
  passwordResetToken: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
    upsert: jest.Mock;
  };
  user: {
    updateMany: jest.Mock;
  };
}

interface PasswordResetUpsertInput {
  create: {
    companyId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  };
  update: Record<string, never>;
  where: { companyId_tokenHash: { companyId: string; tokenHash: string } };
}

interface UserPasswordUpdateManyInput {
  where: { id: string; companyId: string; tokenVersion?: number };
  data: {
    password: string;
    mustChangePassword: boolean;
    tokenVersion: { increment: number };
  };
}

interface RecoveryJobData {
  email: string;
  requestId: string;
}

interface RecoveryJobOptions {
  deduplication?: { id: string };
}

describe('AuthService', () => {
  const userFindFirst = jest.fn();
  const passwordResetDeleteMany = jest.fn();
  const passwordResetUpsert = jest.fn<
    Promise<{ id: string }>,
    [PasswordResetUpsertInput]
  >();
  const tokenFindFirst = jest.fn();
  const tokenUpdateMany = jest.fn();
  const transactionUserUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [UserPasswordUpdateManyInput]
  >();
  const sign = jest.fn().mockReturnValue('signed-token');
  const sendEmail = jest.fn<
    Promise<SendResendEmailResult>,
    [SendResendEmailInput]
  >();
  const addRecoveryJob = jest.fn<
    Promise<void>,
    [string, RecoveryJobData, RecoveryJobOptions]
  >();
  const configValues: Record<string, string> = {
    FRONTEND_URL: 'http://localhost:3000',
    AUTH_RESEND_API_KEY: 're_test_key',
    AUTH_EMAIL_FROM: 'CobraPix <acesso@cobrapix.test>',
    JWT_SECRET: 'jwt_secret_with_at_least_32_characters',
  };
  const transactionClient: TransactionClientMock = {
    passwordResetToken: {
      findFirst: tokenFindFirst,
      updateMany: tokenUpdateMany,
      deleteMany: passwordResetDeleteMany,
      upsert: passwordResetUpsert,
    },
    user: {
      updateMany: transactionUserUpdateMany,
    },
  };
  const transaction = jest.fn(
    async <T>(callback: (client: TransactionClientMock) => Promise<T>) =>
      callback(transactionClient),
  );
  const prisma = {
    user: {
      findFirst: userFindFirst,
    },
    $transaction: transaction,
  } as unknown as PrismaService;
  const configService = {
    get: jest.fn((key: string): string | undefined => configValues[key]),
  } as unknown as ConfigService;
  const mailer = { sendEmail } as unknown as ResendMailerService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    sign.mockReturnValue('signed-token');
    addRecoveryJob.mockResolvedValue(undefined);
    sendEmail.mockResolvedValue({ id: 'email-1' });
    service = new AuthService(
      prisma,
      { sign } as never,
      configService,
      mailer,
      { add: addRecoveryJob } as never,
    );
  });

  it('inclui estado de primeiro acesso e versão no token de login', async () => {
    const password = await bcrypt.hash('senha123', 4);
    userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'admin@cobrapix.com',
      password,
      name: 'Admin CobraPix',
      companyId: 'company-1',
      role: UserRole.COMPANY_ADMIN,
      mustChangePassword: true,
      tokenVersion: 3,
      company: { id: 'company-1' },
    });

    const result = await service.login({
      email: '  ADMIN@COBRAPIX.COM ',
      password: 'senha123',
    });

    expect(userFindFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'admin@cobrapix.com', mode: 'insensitive' },
      },
      include: { company: true },
    });

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        mustChangePassword: true,
        tokenVersion: 3,
      }),
      { expiresIn: '7d' },
    );
    expect(result.user.mustChangePassword).toBe(true);
  });

  it('não revela quando o e-mail de recuperação não existe', async () => {
    const result = await service.forgotPassword({
      email: 'ausente@cobrapix.com',
    });

    expect(result).toEqual({
      message:
        'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.',
    });
    expect(addRecoveryJob).toHaveBeenCalledWith(
      'send-password-reset',
      {
        email: 'ausente@cobrapix.com',
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ) as string,
      },
      expect.objectContaining({
        attempts: 3,
        deduplication: {
          id: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
        },
      }),
    );
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it('deduplica solicitações concorrentes para o mesmo e-mail na fila', async () => {
    await Promise.all([
      service.forgotPassword({ email: 'Admin@Cliente.com' }),
      service.forgotPassword({ email: 'admin@cliente.com' }),
    ]);

    const firstOptions = addRecoveryJob.mock.calls[0]?.[2];
    const secondOptions = addRecoveryJob.mock.calls[1]?.[2];
    expect(firstOptions?.deduplication?.id).toBeDefined();
    expect(secondOptions?.deduplication?.id).toBe(
      firstOptions?.deduplication?.id,
    );
  });

  it('processa silenciosamente um e-mail de recuperação inexistente', async () => {
    userFindFirst.mockResolvedValue(null);

    await service.processPasswordRecovery(
      'ausente@cobrapix.com',
      '123e4567-e89b-42d3-a456-426614174000',
    );

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('persiste somente o hash do token e envia o link de recuperação', async () => {
    userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'Admin@Cliente.com',
      name: 'Admin Cliente',
      companyId: 'company-1',
    });
    passwordResetDeleteMany.mockResolvedValue({ count: 1 });
    passwordResetUpsert.mockResolvedValue({ id: 'reset-1' });

    await service.processPasswordRecovery(
      'ADMIN@CLIENTE.COM',
      '123e4567-e89b-42d3-a456-426614174000',
    );

    expect(userFindFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'admin@cliente.com', mode: 'insensitive' },
      },
      select: { id: true, email: true, name: true, companyId: true },
    });

    const createInput = passwordResetUpsert.mock.calls[0]?.[0];
    expect(createInput).toBeDefined();
    if (!createInput) throw new Error('Token de recuperação não persistido');
    expect(createInput.create.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createInput.create).toEqual(
      expect.objectContaining({ companyId: 'company-1', userId: 'user-1' }),
    );

    const emailInput = sendEmail.mock.calls[0]?.[0];
    expect(emailInput).toBeDefined();
    if (!emailInput) throw new Error('E-mail de recuperação não enviado');
    expect(emailInput.html).toContain(
      'http://localhost:3000/redefinir-senha?token=company-1.',
    );
    expect(emailInput.html).not.toContain(createInput.create.tokenHash);
    expect(passwordResetDeleteMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        userId: 'user-1',
        tokenHash: { not: createInput.create.tokenHash },
      },
    });
  });

  it('reutiliza o mesmo token no retry e preserva links anteriores enquanto o e-mail falha', async () => {
    userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'admin@cliente.com',
      name: 'Admin Cliente',
      companyId: 'company-1',
    });
    passwordResetUpsert.mockResolvedValue({ id: 'reset-1' });
    sendEmail.mockRejectedValue(new Error('resend indisponível'));
    const requestId = '123e4567-e89b-42d3-a456-426614174000';

    await expect(
      service.processPasswordRecovery('admin@cliente.com', requestId),
    ).rejects.toThrow('resend indisponível');
    await expect(
      service.processPasswordRecovery('admin@cliente.com', requestId),
    ).rejects.toThrow('resend indisponível');

    expect(passwordResetUpsert).toHaveBeenCalledTimes(2);
    expect(passwordResetUpsert.mock.calls[0]?.[0].create.tokenHash).toBe(
      passwordResetUpsert.mock.calls[1]?.[0].create.tokenHash,
    );
    expect(passwordResetDeleteMany).not.toHaveBeenCalled();
  });

  it('consome token válido, troca a senha e revoga sessões anteriores', async () => {
    const secret = 'segredo-recuperacao';
    const tokenHash = createHash('sha256').update(secret).digest('hex');
    tokenFindFirst.mockResolvedValue({
      id: 'reset-1',
      companyId: 'company-1',
      userId: 'user-1',
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    tokenUpdateMany.mockResolvedValue({ count: 1 });
    transactionUserUpdateMany.mockResolvedValue({ count: 1 });

    const result = await service.resetPassword({
      token: `company-1.${secret}`,
      password: 'NovaSenha1',
      passwordConfirmation: 'NovaSenha1',
    });

    expect(result).toEqual({ message: 'Senha redefinida com sucesso.' });
    expect(tokenFindFirst).toHaveBeenCalledWith({
      where: { companyId: 'company-1', tokenHash, usedAt: null },
    });
    expect(transactionUserUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', companyId: 'company-1' },
      data: {
        password: expect.any(String) as string,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    });
    expect(passwordResetDeleteMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', userId: 'user-1' },
    });
    const updateInput = transactionUserUpdateMany.mock.calls[0]?.[0];
    expect(updateInput).toBeDefined();
    if (!updateInput) throw new Error('Senha do usuário não atualizada');
    await expect(
      bcrypt.compare('NovaSenha1', updateInput.data.password),
    ).resolves.toBe(true);
  });

  it('rejeita token de recuperação expirado', async () => {
    tokenFindFirst.mockResolvedValue({
      id: 'reset-1',
      companyId: 'company-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() - 1_000),
      usedAt: null,
    });

    await expect(
      service.resetPassword({
        token: 'company-1.segredo',
        password: 'NovaSenha1',
        passwordConfirmation: 'NovaSenha1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionUserUpdateMany).not.toHaveBeenCalled();
  });

  it('troca a senha temporária somente quando a senha atual confere', async () => {
    const currentHash = await bcrypt.hash('Temporaria1', 4);
    userFindFirst.mockResolvedValue({
      id: 'user-1',
      companyId: 'company-1',
      password: currentHash,
    });
    transactionUserUpdateMany.mockResolvedValue({ count: 1 });
    passwordResetDeleteMany.mockResolvedValue({ count: 2 });

    const result = await service.changePassword(
      {
        userId: 'user-1',
        email: 'admin@cliente.com',
        name: 'Admin Cliente',
        companyId: 'company-1',
        role: UserRole.COMPANY_ADMIN,
        mustChangePassword: true,
        tokenVersion: 0,
      },
      {
        currentPassword: 'Temporaria1',
        password: 'Definitiva1',
        passwordConfirmation: 'Definitiva1',
      },
    );

    expect(result).toEqual({ message: 'Senha alterada com sucesso.' });
    expect(transactionUserUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', companyId: 'company-1', tokenVersion: 0 },
      data: {
        password: expect.any(String) as string,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    });
    expect(passwordResetDeleteMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', userId: 'user-1' },
    });
  });

  it('rejeita a troca quando a senha temporária está incorreta', async () => {
    const currentHash = await bcrypt.hash('Temporaria1', 4);
    userFindFirst.mockResolvedValue({
      id: 'user-1',
      companyId: 'company-1',
      password: currentHash,
    });

    await expect(
      service.changePassword(
        {
          userId: 'user-1',
          email: 'admin@cliente.com',
          companyId: 'company-1',
          role: UserRole.COMPANY_ADMIN,
          mustChangePassword: true,
          tokenVersion: 0,
        },
        {
          currentPassword: 'Errada1',
          password: 'Definitiva1',
          passwordConfirmation: 'Definitiva1',
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
