import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DisbursementRecipientsService } from './disbursement-recipients.service';

describe('collaborators (company)', () => {
  const ana = {
    name: 'Ana Souza',
    document: '52998224725',
    pixKey: '52998224725',
  };
  const stored = {
    id: 'ana',
    ...ana,
    documentType: 'CPF',
    bankIspb: null,
    bankAgency: null,
    bankAccount: null,
    bankAccountType: null,
  };
  function fixture() {
    const prisma = {
      disbursementRecipient: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(stored),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const settings = { assertEnabled: jest.fn().mockResolvedValue({}) };
    return {
      prisma,
      settings,
      service: new DisbursementRecipientsService(
        prisma as never,
        settings as never,
      ),
    };
  }
  async function failure(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return error as BadRequestException;
    }
    throw new Error('expected a failure');
  }

  it('the feature disabled answers 404 before reading anything', async () => {
    const f = fixture();
    f.settings.assertEnabled.mockRejectedValue(new NotFoundException());
    await expect(
      f.service.list('company', { page: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.import('company', [ana])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(f.prisma.disbursementRecipient.findMany).not.toHaveBeenCalled();
  });

  it('lists only the session company, active by default', async () => {
    const f = fixture();
    await f.service.list('company', { page: 2, pageSize: 10, search: 'ana' });
    expect(f.prisma.disbursementRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company',
          active: true,
          OR: [{ name: { contains: 'ana', mode: 'insensitive' } }],
        },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('one invalid row rejects the whole spreadsheet with every error', async () => {
    const f = fixture();
    const error = await failure(
      f.service.import('company', [
        ana,
        { name: 'Bruno', document: '111.111.111-11', pixKey: 'x@y.com' },
        { ...ana, name: 'Ana de novo' },
      ]),
    );
    expect(error.getResponse()).toEqual({
      code: 'IMPORT_INVALID',
      message: 'A planilha tem linhas inválidas. Nada foi importado.',
      errors: [
        { row: 2, message: 'CPF ou CNPJ inválido.' },
        { row: 3, message: 'CPF ou CNPJ repetido na planilha (linha 1).' },
      ],
    });
    expect(f.prisma.disbursementRecipient.createMany).not.toHaveBeenCalled();
  });

  it('skips a collaborator already registered with the same data', async () => {
    const f = fixture();
    f.prisma.disbursementRecipient.findMany.mockResolvedValue([stored]);
    f.prisma.disbursementRecipient.createMany.mockResolvedValue({ count: 1 });
    const carla = {
      name: 'Carla',
      document: '11144477735',
      pixKey: 'carla@example.com',
    };
    await expect(f.service.import('company', [ana, carla])).resolves.toEqual({
      created: 1,
      skipped: 1,
    });
    expect(f.prisma.disbursementRecipient.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          companyId: 'company',
          document: '11144477735',
        }),
      ],
    });
  });

  it('never changes where a registered collaborator gets paid through a spreadsheet', async () => {
    const f = fixture();
    f.prisma.disbursementRecipient.findMany.mockResolvedValue([stored]);
    const error = await failure(
      f.service.import('company', [{ ...ana, pixKey: 'ana@example.com' }]),
    );
    expect(error.getResponse()).toMatchObject({
      errors: [
        {
          row: 1,
          message: expect.stringContaining('já cadastrado') as unknown,
        },
      ],
    });
    expect(f.prisma.disbursementRecipient.createMany).not.toHaveBeenCalled();
  });

  it('an edit with an old version answers 409; another company answers 404', async () => {
    const f = fixture();
    f.prisma.disbursementRecipient.updateMany.mockResolvedValue({ count: 0 });
    const dto = { ...ana, expectedVersion: 1, active: true };
    await expect(
      f.service.update('company', 'ana', dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.prisma.disbursementRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: 'ana', companyId: 'company', version: 1 },
      data: expect.objectContaining({ version: { increment: 1 } }) as unknown,
    });
    f.prisma.disbursementRecipient.findFirst.mockResolvedValue(null);
    await expect(
      f.service.update('company', 'ana', dto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
