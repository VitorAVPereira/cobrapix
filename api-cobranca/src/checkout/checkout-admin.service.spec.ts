import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutAdminService } from './checkout-admin.service';
import { productSlug } from './checkout-rules';

const VALID_CNPJ = '11.222.333/0001-81';
const VALID_CPF = '529.982.247-25';

interface WriteArg {
  data: { users?: { create: unknown }; changes?: unknown; action?: unknown };
  where?: unknown;
}

function firstArg(mock: jest.Mock): WriteArg {
  return (mock.mock.calls as WriteArg[][])[0][0];
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('CheckoutAdminService', () => {
  const tx = {
    company: { create: jest.fn(), findFirst: jest.fn() },
    checkoutSellerTerms: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    user: { findFirst: jest.fn() },
    company: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const service = new CheckoutAdminService(prisma as unknown as PrismaService);
  const dto = {
    company: {
      corporateName: 'Treze Digital',
      document: VALID_CNPJ,
      email: 'contato@treze.test',
      phoneNumber: '(11) 99999-9999',
    },
    firstUser: { name: 'Pedro', email: 'Pedro@Treze.test' },
    terms: {
      platformFeeBasisPoints: 250,
      payoutDocument: VALID_CNPJ,
      payoutPixKey: VALID_CPF,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue(null);
    tx.company.create.mockResolvedValue({ id: 'company-1' });
    tx.checkoutSellerTerms.create.mockResolvedValue({ id: 'terms-1' });
    prisma.company.findFirst.mockResolvedValue({
      id: 'company-1',
      checkoutSellerTerms: [],
    });
  });

  it('cria empresa de checkout, usuário, configurações e termos versão 1', async () => {
    const result = await service.create(dto, 'admin-1');

    expect(result.temporaryPassword).toEqual(expect.any(String));
    const { data } = firstArg(tx.company.create);
    expect(data).toMatchObject({
      product: 'CHECKOUT',
      document: '11222333000181',
      phoneNumber: '11999999999',
      checkoutSettings: { create: { displayName: 'Treze Digital' } },
    });
    expect(data.users?.create).toMatchObject({
      email: 'pedro@treze.test',
      mustChangePassword: true,
    });
    expect(tx.checkoutSellerTerms.create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        version: 1,
        platformFeeBasisPoints: 250,
        payoutDocument: '11222333000181',
        payoutPixKey: '52998224725',
        changedByUserId: 'admin-1',
      },
    });
  });

  it('a auditoria não guarda documento completo nem chave Pix', async () => {
    await service.create(dto, 'admin-1');

    const { changes } = firstArg(tx.auditLog.create).data;
    expect(changes).toEqual({
      version: 1,
      platformFeeBasisPoints: 250,
      payoutDocument: '•••0181',
    });
    expect(JSON.stringify(changes)).not.toContain('52998224725');
  });

  it('recusa CPF/CNPJ e chave Pix inválidos', async () => {
    await expect(
      service.create(
        { ...dto, company: { ...dto.company, document: '11.111.111/1111-11' } },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        { ...dto, terms: { ...dto.terms, payoutPixKey: '11999999999' } },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.company.create).not.toHaveBeenCalled();
  });

  it('e-mail de usuário em uso responde 409 sem criar nada', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-x' });

    await expect(service.create(dto, 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('empresa repetida (ou duplo clique) responde 409', async () => {
    tx.company.create.mockRejectedValue(uniqueViolation());

    await expect(service.create(dto, 'admin-1')).rejects.toMatchObject({
      response: { code: 'CHECKOUT_CLIENT_EXISTS' },
    });
  });

  it('nova versão dos termos sem editar a anterior', async () => {
    tx.company.findFirst.mockResolvedValue({
      checkoutSellerTerms: [{ version: 3 }],
    });

    await service.updateTerms(
      'company-1',
      { ...dto.terms, platformFeeBasisPoints: 300, expectedVersion: 3 },
      'admin-1',
    );

    expect(firstArg(tx.checkoutSellerTerms.create).data).toMatchObject({
      version: 4,
      platformFeeBasisPoints: 300,
    });
    expect(firstArg(tx.auditLog.create).data.action).toBe(
      'CHECKOUT_TERMS_CHANGED',
    );
  });

  it('versão esperada antiga ou salva ao mesmo tempo responde VERSION_CHANGED', async () => {
    tx.company.findFirst.mockResolvedValue({
      checkoutSellerTerms: [{ version: 4 }],
    });
    await expect(
      service.updateTerms(
        'company-1',
        { ...dto.terms, expectedVersion: 3 },
        'admin-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });

    tx.company.findFirst.mockResolvedValue({
      checkoutSellerTerms: [{ version: 3 }],
    });
    tx.checkoutSellerTerms.create.mockRejectedValue(uniqueViolation());
    await expect(
      service.updateTerms(
        'company-1',
        { ...dto.terms, expectedVersion: 3 },
        'admin-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CHANGED' } });
  });

  it('empresa de cobrança ou inexistente responde 404', async () => {
    tx.company.findFirst.mockResolvedValue(null);
    await expect(
      service.updateTerms(
        'company-1',
        { ...dto.terms, expectedVersion: 1 },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.company.findFirst.mockResolvedValue(null);
    await expect(service.detail('company-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(firstArg(prisma.company.findFirst).where).toEqual({
      id: 'company-1',
      product: 'CHECKOUT',
    });
  });

  it('lista só empresas de checkout', async () => {
    prisma.company.findMany.mockResolvedValue([]);
    await service.list();
    expect(firstArg(prisma.company.findMany).where).toEqual({
      product: 'CHECKOUT',
    });
  });
});

describe('productSlug', () => {
  it('gera endereço simples com sufixo', () => {
    expect(productSlug('Porquim I.A - Anual!', 'ab12')).toBe(
      'porquim-i-a-anual-ab12',
    );
    expect(productSlug('Educação Financeira', 'zz99')).toBe(
      'educacao-financeira-zz99',
    );
    expect(productSlug('!!!', 'zz99')).toBe('zz99');
  });
});
