import { ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  apiKeyHash,
  CheckoutApiKeysService,
  MAX_API_KEYS,
} from './checkout-api-keys.service';
import { CheckoutApiKeyGuard } from './checkout-api.controller';

const now = new Date('2026-11-11T12:00:00Z');

describe('CheckoutApiKeysService', () => {
  const tx = {
    checkoutApiKey: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    checkoutApiKey: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new CheckoutApiKeysService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (client: typeof tx) => unknown)(tx)
        : Promise.all(arg as unknown[]),
    );
    tx.checkoutApiKey.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'k1',
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
        ...data,
      }),
    );
  });

  it('a chave aparece só na criação; o banco e a auditoria guardam só o hash e o prefixo', async () => {
    prisma.checkoutApiKey.count.mockResolvedValue(0);

    const created = await service.create('c1', 'u1', ' ERP ');

    expect(created.key).toMatch(/^ckapi_[A-Za-z0-9_-]{43}$/);
    const [{ data }] = tx.checkoutApiKey.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toEqual({
      companyId: 'c1',
      name: 'ERP',
      prefix: created.key.slice(0, 12),
      keyHash: apiKeyHash(created.key),
      createdByUserId: 'u1',
    });
    expect(created).not.toHaveProperty('keyHash');
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(
      created.key,
    );
    const [{ data: audit }] = tx.auditLog.create.mock.calls[0] as [
      { data: { action: string } },
    ];
    expect(audit.action).toBe('CHECKOUT_API_KEY_CREATED');
  });

  it('até 5 chaves ativas', async () => {
    prisma.checkoutApiKey.count.mockResolvedValue(MAX_API_KEYS);
    await expect(service.create('c1', 'u1', 'ERP')).rejects.toMatchObject({
      response: { code: 'CHECKOUT_API_KEY_LIMIT' },
    });
    expect(prisma.checkoutApiKey.count).toHaveBeenCalledWith({
      where: { companyId: 'c1', revokedAt: null },
    });
  });

  it('revogar chave de outra empresa responde 404', async () => {
    prisma.checkoutApiKey.findFirst.mockResolvedValue(null);
    await expect(service.revoke('c2', 'u2', 'k1', now)).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.checkoutApiKey.findFirst).toHaveBeenCalledWith({
      where: { id: 'k1', companyId: 'c2' },
    });
  });

  it('revogar grava a data e a auditoria uma vez', async () => {
    prisma.checkoutApiKey.findFirst.mockResolvedValue({
      id: 'k1',
      name: 'ERP',
      prefix: 'ckapi_abcdef',
      revokedAt: null,
    });
    await service.revoke('c1', 'u1', 'k1', now);
    expect(prisma.checkoutApiKey.updateMany).toHaveBeenCalledWith({
      where: { id: 'k1', revokedAt: null },
      data: { revokedAt: now },
    });

    prisma.checkoutApiKey.findFirst.mockResolvedValue({
      id: 'k1',
      revokedAt: now,
    });
    prisma.checkoutApiKey.updateMany.mockClear();
    await service.revoke('c1', 'u1', 'k1', now);
    expect(prisma.checkoutApiKey.updateMany).not.toHaveBeenCalled();
  });

  it('autentica só chave válida de empresa de checkout, gravando o uso no máximo por minuto', async () => {
    const key = {
      id: 'k1',
      companyId: 'c1',
      revokedAt: null,
      lastUsedAt: new Date(now.getTime() - 30_000),
      company: { product: 'CHECKOUT' },
    };
    prisma.checkoutApiKey.findUnique.mockResolvedValue(key);
    await expect(service.authenticate('ckapi_x', now)).resolves.toEqual({
      keyId: 'k1',
      companyId: 'c1',
    });
    expect(prisma.checkoutApiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: apiKeyHash('ckapi_x') },
      include: { company: { select: { product: true } } },
    });
    expect(prisma.checkoutApiKey.update).not.toHaveBeenCalled();

    prisma.checkoutApiKey.findUnique.mockResolvedValue({
      ...key,
      lastUsedAt: null,
    });
    await service.authenticate('ckapi_x', now);
    expect(prisma.checkoutApiKey.update).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { lastUsedAt: now },
    });

    prisma.checkoutApiKey.findUnique.mockResolvedValue({
      ...key,
      revokedAt: now,
    });
    await expect(service.authenticate('ckapi_x', now)).resolves.toBeNull();
    prisma.checkoutApiKey.findUnique.mockResolvedValue({
      ...key,
      company: { product: 'BILLING' },
    });
    await expect(service.authenticate('ckapi_x', now)).resolves.toBeNull();
  });
});

describe('CheckoutApiKeyGuard', () => {
  const keys = { authenticate: jest.fn() };
  const guard = new CheckoutApiKeyGuard(keys as never);
  const context = (authorization?: string) => {
    const request: Record<string, unknown> = {
      headers: authorization ? { authorization } : {},
    };
    return {
      request,
      ctx: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext,
    };
  };

  it('sem chave, ou chave recusada, responde 401 com código estável', async () => {
    const missing = context();
    await expect(guard.canActivate(missing.ctx)).rejects.toMatchObject({
      status: 401,
      response: { code: 'CHECKOUT_API_KEY_INVALID' },
    });
    expect(keys.authenticate).not.toHaveBeenCalled();

    keys.authenticate.mockResolvedValue(null);
    await expect(
      guard.canActivate(context('Bearer ckapi_errada').ctx),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('a empresa vem só da chave', async () => {
    keys.authenticate.mockResolvedValue({ keyId: 'k1', companyId: 'c1' });
    const valid = context('Bearer ckapi_certa');
    await expect(guard.canActivate(valid.ctx)).resolves.toBe(true);
    expect(keys.authenticate).toHaveBeenCalledWith('ckapi_certa');
    expect(valid.request.checkoutApi).toEqual({ keyId: 'k1', companyId: 'c1' });
  });
});
