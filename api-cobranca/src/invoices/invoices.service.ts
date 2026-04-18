import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ImportRow {
  name: string;
  phone_number: string;
  email?: string;
  original_amount: number;
  due_date: string;
}

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId },
      include: { debtor: true },
      orderBy: { createdAt: 'desc' },
    });

    return invoices.map((inv) => ({
      id: inv.id,
      name: inv.debtor.name,
      phone_number: inv.debtor.phoneNumber,
      email: inv.debtor.email || undefined,
      original_amount: Number(inv.originalAmount),
      due_date: inv.dueDate.toISOString().split('T')[0],
      status: inv.status,
      debtorId: inv.debtor.id,
      gatewayId: inv.gatewayId,
      pixPayload: inv.pixPayload,
      createdAt: inv.createdAt.toISOString(),
    }));
  }

  async importCsv(companyId: string, rows: ImportRow[]) {
    const result = await this.prisma.$transaction(async (tx) => {
      let created = 0;

      for (const row of rows) {
        const debtor = await tx.debtor.upsert({
          where: {
            companyId_phoneNumber: {
              companyId,
              phoneNumber: row.phone_number,
            },
          },
          update: {
            name: row.name,
            email: row.email || null,
          },
          create: {
            companyId,
            name: row.name,
            phoneNumber: row.phone_number,
            email: row.email || null,
          },
        });

        const dueDate = this.parseDueDate(row.due_date);
        if (!dueDate) continue;

        await tx.invoice.create({
          data: {
            companyId,
            debtorId: debtor.id,
            originalAmount: row.original_amount,
            dueDate,
          },
        });

        created++;
      }

      return created;
    });

    return { success: true, count: result };
  }

  private parseDueDate(raw: string): Date | null {
    const trimmed = raw.trim();

    // Formato ISO: YYYY-MM-DD
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00Z`);
      return isNaN(d.getTime()) ? null : d;
    }

    // Formato BR: DD/MM/YYYY
    const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const d = new Date(`${brMatch[3]}-${brMatch[2]}-${brMatch[1]}T12:00:00Z`);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  }
}
