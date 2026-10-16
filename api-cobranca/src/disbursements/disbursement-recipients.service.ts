import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DisbursementSettingsService } from './disbursement-settings.service';
import {
  NormalizedRecipient,
  RecipientInput,
  normalizeRecipient,
} from './disbursement-recipient-rules';
import {
  DisbursementRecipientsQueryDto,
  UpdateDisbursementRecipientDto,
} from './dto/disbursement-recipient.dto';

const RECIPIENT_SELECT = {
  id: true,
  name: true,
  documentType: true,
  document: true,
  pixKey: true,
  bankIspb: true,
  bankAgency: true,
  bankAccount: true,
  bankAccountType: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DisbursementRecipientSelect;

function isDuplicate(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
function duplicate(): never {
  throw new ConflictException({
    code: 'RECIPIENT_DUPLICATE',
    message: 'Já existe um colaborador com este CPF ou CNPJ.',
  });
}
function sameDestination(a: NormalizedRecipient, b: NormalizedRecipient) {
  return (
    a.name === b.name &&
    a.pixKey === b.pixKey &&
    a.bankIspb === b.bankIspb &&
    a.bankAgency === b.bankAgency &&
    a.bankAccount === b.bankAccount &&
    a.bankAccountType === b.bankAccountType
  );
}

@Injectable()
export class DisbursementRecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: DisbursementSettingsService,
  ) {}

  async list(companyId: string, query: DisbursementRecipientsQueryDto) {
    await this.settings.assertEnabled(companyId);
    const where: Prisma.DisbursementRecipientWhereInput = {
      companyId,
      ...(query.includeInactive ? {} : { active: true }),
    };
    const search = query.search?.trim();
    if (search) {
      const digits = search.replace(/\D/g, '');
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        ...(digits ? [{ document: { contains: digits } }] : []),
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.disbursementRecipient.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: RECIPIENT_SELECT,
      }),
      this.prisma.disbursementRecipient.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async create(companyId: string, input: RecipientInput) {
    await this.settings.assertEnabled(companyId);
    const data = this.check(input);
    try {
      return await this.prisma.disbursementRecipient.create({
        data: { companyId, ...data },
        select: RECIPIENT_SELECT,
      });
    } catch (error) {
      if (isDuplicate(error)) duplicate();
      throw error;
    }
  }

  /** Items already in a batch keep their snapshot; the edit applies to new batches. */
  async update(
    companyId: string,
    id: string,
    dto: UpdateDisbursementRecipientDto,
  ) {
    await this.settings.assertEnabled(companyId);
    const data = this.check(dto);
    let updated: Prisma.BatchPayload;
    try {
      updated = await this.prisma.disbursementRecipient.updateMany({
        where: { id, companyId, version: dto.expectedVersion },
        data: { ...data, active: dto.active, version: { increment: 1 } },
      });
    } catch (error) {
      if (isDuplicate(error)) duplicate();
      throw error;
    }
    const current = await this.prisma.disbursementRecipient.findFirst({
      where: { id, companyId },
      select: RECIPIENT_SELECT,
    });
    if (!current) throw new NotFoundException('Colaborador não encontrado.');
    if (!updated.count)
      throw new ConflictException({
        code: 'VERSION_CHANGED',
        message:
          'O cadastro foi alterado por outra pessoa. Recarregue os dados.',
      });
    return current;
  }

  /**
   * All or nothing: one invalid row rejects the whole file with every error by row.
   * A row equal to an existing collaborator is skipped; a different one is an error,
   * so a spreadsheet never silently changes where someone gets paid.
   */
  async import(companyId: string, rows: RecipientInput[]) {
    await this.settings.assertEnabled(companyId);
    const errors: { row: number; message: string }[] = [];
    const valid: { row: number; data: NormalizedRecipient }[] = [];
    const firstRow = new Map<string, number>();
    rows.forEach((input, index) => {
      const row = index + 1;
      const result = normalizeRecipient(input);
      if (!result.ok) return errors.push({ row, message: result.message });
      const first = firstRow.get(result.data.document);
      if (first)
        return errors.push({
          row,
          message: `CPF ou CNPJ repetido na planilha (linha ${first}).`,
        });
      firstRow.set(result.data.document, row);
      valid.push({ row, data: result.data });
    });
    const existing = new Map(
      (
        await this.prisma.disbursementRecipient.findMany({
          where: { companyId, document: { in: [...firstRow.keys()] } },
          select: RECIPIENT_SELECT,
        })
      ).map((recipient) => [recipient.document, recipient]),
    );
    const toCreate: NormalizedRecipient[] = [];
    let skipped = 0;
    for (const { row, data } of valid) {
      const current = existing.get(data.document);
      if (!current) toCreate.push(data);
      else if (sameDestination(current, data)) skipped++;
      else
        errors.push({
          row,
          message:
            'Colaborador já cadastrado com outros dados. Altere pelo cadastro.',
        });
    }
    if (errors.length)
      throw new BadRequestException({
        code: 'IMPORT_INVALID',
        message: 'A planilha tem linhas inválidas. Nada foi importado.',
        errors: errors.sort((a, b) => a.row - b.row),
      });
    try {
      const created = await this.prisma.disbursementRecipient.createMany({
        data: toCreate.map((data) => ({ companyId, ...data })),
      });
      return { created: created.count, skipped };
    } catch (error) {
      if (isDuplicate(error)) duplicate();
      throw error;
    }
  }

  private check(input: RecipientInput): NormalizedRecipient {
    const result = normalizeRecipient(input);
    if (!result.ok)
      throw new BadRequestException({
        code: 'RECIPIENT_INVALID',
        message: result.message,
      });
    return result.data;
  }
}
