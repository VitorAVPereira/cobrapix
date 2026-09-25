import { HttpException, HttpStatus } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

const companyUser = { companyId: 'company-1' };
const debtorId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';

function buildController(serviceOverrides: Partial<InvoicesService>) {
  const service = serviceOverrides as InvoicesService;
  return {
    controller: new InvoicesController(service),
    service,
  };
}

describe('InvoicesController debtors', () => {
  it('passes debtorId and status query params to paginated invoices', async () => {
    const findPaginated = jest.fn().mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const { controller } = buildController({ findPaginated });

    await controller.findAll(
      companyUser,
      '1',
      '20',
      undefined,
      'PENDING',
      debtorId,
    );

    expect(findPaginated).toHaveBeenCalledWith('company-1', {
      page: 1,
      pageSize: 20,
      search: undefined,
      status: 'PENDING',
      debtorId,
    });
  });

  it('lists debtors with normalized pagination and filters', async () => {
    const listDebtors = jest.fn().mockResolvedValue({
      data: [],
      total: 0,
      page: 2,
      pageSize: 10,
      summary: {
        totalDebtors: 0,
        openInvoiceAmount: 0,
        openInvoiceCount: 0,
        paidInvoiceAmount: 0,
        paidInvoiceCount: 0,
      },
    });
    const { controller } = buildController({ listDebtors });

    await controller.listDebtors(
      companyUser,
      '2',
      '10',
      ' maria ',
      profileId,
      'open',
    );

    expect(listDebtors).toHaveBeenCalledWith('company-1', {
      page: 2,
      pageSize: 10,
      search: 'maria',
      profileId,
      paymentStatus: 'open',
    });
  });

  it('creates debtors through the authenticated company', async () => {
    const createDebtor = jest.fn().mockResolvedValue({ debtorId });
    const { controller } = buildController({ createDebtor });

    const result = await controller.createDebtor(companyUser, {
      name: 'Maria Silva',
      document: '12345678909',
      phone_number: '11999999999',
      email: undefined,
      whatsappOptIn: true,
      collectionProfileId: profileId,
    });

    expect(result).toEqual({ debtorId });
    expect(createDebtor).toHaveBeenCalledWith('company-1', {
      name: 'Maria Silva',
      document: '12345678909',
      phone_number: '11999999999',
      email: undefined,
      whatsappOptIn: true,
      collectionProfileId: profileId,
    });
  });

  it('returns not found when updating a debtor from another company', async () => {
    const updateDebtor = jest.fn().mockResolvedValue(null);
    const { controller } = buildController({ updateDebtor });

    await expect(
      controller.updateDebtor(companyUser, debtorId, {
        name: 'Maria Editada',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      message: 'Cliente nao encontrado.',
    });
  });

  it('rejects invalid debtor ids before updating', async () => {
    const updateDebtor = jest.fn();
    const { controller } = buildController({ updateDebtor });

    await expect(
      controller.updateDebtor(companyUser, 'invalid-id', {
        name: 'Maria Editada',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(updateDebtor).not.toHaveBeenCalled();
  });
});

describe('InvoicesController CSV late terms', () => {
  const row = {
    name: 'Maria Silva',
    document: '529.982.247-25',
    phone_number: '11999999999',
    email: 'maria@email.com',
    original_amount: 100,
    due_date: '2026-05-10',
    billing_type: 'PIX',
  };

  it('accepts optional late-term columns, empty meaning the company default', async () => {
    const importCsv = jest
      .fn()
      .mockResolvedValue({ success: true, count: 2, initialChargeQueued: 0 });
    const { controller } = buildController({ importCsv });
    await controller.importCsv(companyUser, [
      {
        ...row,
        late_fine_percentage: '2,5',
        late_interest_monthly_percentage: '1%',
        payment_days_after_due: '0',
      },
      {
        ...row,
        late_fine_percentage: '',
        late_interest_monthly_percentage: '',
        payment_days_after_due: '',
      },
    ]);
    const [, rows] = importCsv.mock.calls[0] as [string, object[]];
    expect(rows[0]).toMatchObject({
      late_fine_percentage: 2.5,
      late_interest_monthly_percentage: 1,
      payment_days_after_due: 0,
    });
    expect(rows[1]).toMatchObject({
      late_fine_percentage: undefined,
      late_interest_monthly_percentage: undefined,
      payment_days_after_due: undefined,
    });
  });

  it.each([
    [{ late_fine_percentage: '11' }, 'Linha 1: Multa deve estar entre 0 e 10.'],
    [
      { late_interest_monthly_percentage: 'abc' },
      'Linha 1: Juros ao mês deve ser um percentual com até 2 casas decimais.',
    ],
    [
      { payment_days_after_due: '2.5' },
      'Linha 1: Dias após o vencimento deve ser um número inteiro de 0 a 365.',
    ],
  ])('rejects invalid late terms %p', async (extra, message) => {
    const importCsv = jest.fn();
    const { controller } = buildController({ importCsv });
    await expect(
      controller.importCsv(companyUser, [{ ...row, ...extra }]),
    ).rejects.toMatchObject({
      response: { details: [message] },
    });
    expect(importCsv).not.toHaveBeenCalled();
  });
});
