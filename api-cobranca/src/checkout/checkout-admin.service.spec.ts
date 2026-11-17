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
  return (mock.mock.calls as [WriteArg][])[0]?.[0] as WriteArg;
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
    checkoutSettings: { updateMany: jest.fn(), count: jest.fn() },
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
    // A new client always sells through its own account: no payout data kept,
    // even when an older screen still sends it.
    expect(tx.checkoutSellerTerms.create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        version: 1,
        accountMode: 'SELLER_ACCOUNT',
        platformFeeBasisPoints: 250,
        payoutDocument: '',
        payoutPixKey: '',
        authorizationReference: null,
        changedByUserId: 'admin-1',
      },
    });
  });

  it('cliente novo guarda a referência do termo de autorização, também na auditoria', async () => {
    await service.create(
      {
        ...dto,
        terms: {
          platformFeeBasisPoints: 150,
          authorizationReference: ' Termo assinado em 16/11 ',
        },
      },
      'admin-1',
    );

    expect(firstArg(tx.checkoutSellerTerms.create).data).toMatchObject({
      accountMode: 'SELLER_ACCOUNT',
      authorizationReference: 'Termo assinado em 16/11',
    });
    expect(firstArg(tx.auditLog.create).data.changes).toEqual({
      version: 1,
      accountMode: 'SELLER_ACCOUNT',
      platformFeeBasisPoints: 150,
      authorizationReference: 'Termo assinado em 16/11',
    });
  });

  it('recusa CPF/CNPJ inválido da empresa', async () => {
    await expect(
      service.create(
        { ...dto, company: { ...dto.company, document: '11.111.111/1111-11' } },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.company.create).not.toHaveBeenCalled();
  });

  it('vendedor da conta Cifra+ continua nesse modo, com os dados de repasse conferidos', async () => {
    tx.company.findFirst.mockResolvedValue({
      checkoutSellerTerms: [{ version: 2, accountMode: 'PLATFORM_ACCOUNT' }],
    });

    await service.updateTerms(
      'company-1',
      { ...dto.terms, expectedVersion: 2 },
      'admin-1',
    );
    expect(firstArg(tx.checkoutSellerTerms.create).data).toMatchObject({
      version: 3,
      accountMode: 'PLATFORM_ACCOUNT',
      payoutDocument: '11222333000181',
      payoutPixKey: '52998224725',
      authorizationReference: null,
    });
    // The audit keeps neither the full document nor the Pix key.
    const { changes } = firstArg(tx.auditLog.create).data;
    expect(changes).toEqual({
      version: 3,
      accountMode: 'PLATFORM_ACCOUNT',
      platformFeeBasisPoints: 250,
      payoutDocument: '•••0181',
    });
    expect(JSON.stringify(changes)).not.toContain('52998224725');

    for (const terms of [
      { ...dto.terms, payoutPixKey: '11999999999' },
      { platformFeeBasisPoints: 250 },
    ])
      await expect(
        service.updateTerms(
          'company-1',
          { ...terms, expectedVersion: 2 },
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.checkoutSellerTerms.create).toHaveBeenCalledTimes(1);
  });

  it('vendedor na conta própria: a referência do termo fica se a nova versão não trouxer outra', async () => {
    tx.company.findFirst.mockResolvedValue({
      checkoutSellerTerms: [
        {
          version: 1,
          accountMode: 'SELLER_ACCOUNT',
          authorizationReference: 'Termo de 16/11',
        },
      ],
    });

    await service.updateTerms(
      'company-1',
      { platformFeeBasisPoints: 200, expectedVersion: 1 },
      'admin-1',
    );
    expect(firstArg(tx.checkoutSellerTerms.create).data).toMatchObject({
      version: 2,
      accountMode: 'SELLER_ACCOUNT',
      platformFeeBasisPoints: 200,
      authorizationReference: 'Termo de 16/11',
    });

    await service.updateTerms(
      'company-1',
      {
        platformFeeBasisPoints: 200,
        authorizationReference: 'Aditivo de 01/12',
        expectedVersion: 1,
      },
      'admin-1',
    );
    expect(
      (tx.checkoutSellerTerms.create.mock.calls as [WriteArg][])[1]?.[0].data,
    ).toMatchObject({ authorizationReference: 'Aditivo de 01/12' });
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

  it('pausar o cartão grava a data e o motivo na auditoria; repetir não audita de novo', async () => {
    prisma.company.findFirst.mockResolvedValue({
      id: 'company-1',
      checkoutSellerTerms: [],
      checkoutSettings: { cardEnabled: true, cardPausedAt: new Date() },
    });
    tx.checkoutSettings.updateMany.mockResolvedValueOnce({ count: 1 });
    const view = await service.setCardPause(
      'company-1',
      true,
      'Chargeback acima de 1%',
      'admin',
    );
    expect(view.card.pausedAt).toBeInstanceOf(Date);
    expect(firstArg(tx.auditLog.create).data).toMatchObject({
      action: 'CHECKOUT_CARD_PAUSED',
      changes: { reason: 'Chargeback acima de 1%' },
    });

    jest.clearAllMocks();
    prisma.company.findFirst.mockResolvedValue({
      id: 'company-1',
      checkoutSellerTerms: [],
      checkoutSettings: null,
    });
    tx.checkoutSettings.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.checkoutSettings.count.mockResolvedValueOnce(1);
    await service.setCardPause('company-1', true, 'De novo', 'admin');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
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
