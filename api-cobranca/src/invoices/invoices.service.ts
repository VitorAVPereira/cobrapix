import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingMethod, RecurringInvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingType } from './dto/invoice.dto';

const PLATFORM_FIXED_FEE = 0.5;
const RECURRING_GENERATION_LOOKAHEAD_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

interface BillingSettingsSnapshot {
  preferredBillingMethod: BillingMethod;
  collectionReminderDays: number[];
  autoDiscountEnabled: boolean;
  autoDiscountDaysAfterDue: number | null;
  autoDiscountPercentage: number | null;
  tariffs: Record<
    BillingMethod,
    {
      method: BillingMethod;
      efiLabel: string;
      platformLabel: string;
      combinedLabel: string;
      efiKind: 'percentage' | 'fixed';
      efiValue: number;
      platformFixedFee: number;
    }
  >;
}

interface ImportRow {
  name: string;
  phone_number: string;
  email?: string;
  original_amount: number;
  due_date: string;
  billing_type: 'PIX' | 'BOLETO' | 'BOLIX';
}

interface InvoiceListItem {
  id: string;
  invoiceId: string;
  name: string;
  phone_number: string;
  email?: string;
  original_amount: number;
  due_date: string;
  status: string;
  debtorId: string;
  gatewayId: string | null;
  pixPayload: string | null;
  billing_type: string;
  createdAt: string;
  recurrence?: {
    recurrenceId: string;
    period: string;
    dueDay: number;
    status: RecurringInvoiceStatus;
  };
}

interface CreateInvoiceInput {
  debtorId?: string;
  name?: string;
  phone_number?: string;
  email?: string;
  original_amount: number;
  due_date?: string;
  billing_type: BillingType;
  recurring?: boolean;
  due_day?: number;
}

interface RecurringInvoiceListItem {
  recurrenceId: string;
  debtor: {
    debtorId: string;
    name: string;
    phone_number: string;
    email?: string;
  };
  amount: number;
  billingType: BillingMethod;
  dueDay: number;
  status: RecurringInvoiceStatus;
  nextDueDate: string | null;
  lastGeneratedPeriod: string | null;
  pendingInvoice: {
    invoiceId: string;
    dueDate: string;
    amount: number;
    status: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface UpdateRecurringInvoiceInput {
  amount: number;
  billingType: BillingType;
  dueDay: number;
}

interface InvoiceWithRelations {
  id: string;
  debtor: {
    id: string;
    name: string;
    phoneNumber: string;
    email: string | null;
  };
  originalAmount: { toNumber(): number };
  dueDate: Date;
  status: string;
  gatewayId: string | null;
  pixPayload: string | null;
  billingType: string;
  createdAt: Date;
  recurringInvoiceId: string | null;
  recurrencePeriod: string | null;
  recurringInvoice: {
    dueDay: number;
    status: RecurringInvoiceStatus;
  } | null;
}

interface RecurringInvoiceWithRelations {
  id: string;
  debtor: {
    id: string;
    name: string;
    phoneNumber: string;
    email: string | null;
  };
  amount: { toNumber(): number };
  billingType: BillingMethod;
  dueDay: number;
  status: RecurringInvoiceStatus;
  nextDueDate: Date | null;
  lastGeneratedPeriod: string | null;
  invoices: Array<{
    id: string;
    dueDate: Date;
    originalAmount: { toNumber(): number };
    status: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DebtorSettingsResponse {
  debtorId: string;
  debtorName: string;
  useGlobalBillingSettings: boolean;
  customPreferredBillingMethod: BillingMethod | null;
  customCollectionReminderDays: number[];
  customAutoDiscountEnabled: boolean | null;
  customAutoDiscountDaysAfterDue: number | null;
  customAutoDiscountPercentage: number | null;
  globalSettings: BillingSettingsSnapshot;
  effectiveSettings: BillingSettingsSnapshot;
  updatedAt: string;
}

export interface UpdateDebtorSettingsInput {
  useGlobalBillingSettings: boolean;
  preferredBillingMethod?: BillingMethod | null;
  collectionReminderDays?: number[] | null;
  autoDiscountEnabled?: boolean | null;
  autoDiscountDaysAfterDue?: number | null;
  autoDiscountPercentage?: number | null;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateScheduledRecurringInvoices(): Promise<void> {
    const generated = await this.generateRecurringInvoices();
    if (generated > 0) {
      this.logger.log(`${generated} faturas recorrentes geradas.`);
    }
  }

  async findAll(companyId: string): Promise<InvoiceListItem[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId },
      include: { debtor: true, recurringInvoice: true },
      orderBy: { createdAt: 'desc' },
    });

    return invoices.map((invoice) => this.mapInvoiceListItem(invoice));
  }

  async importCsv(
    companyId: string,
    rows: ImportRow[],
  ): Promise<{ success: boolean; count: number }> {
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
            billingType: row.billing_type,
          },
        });

        created++;
      }

      return created;
    });

    return { success: true, count: result };
  }

  async createInvoice(
    companyId: string,
    input: CreateInvoiceInput,
  ): Promise<InvoiceListItem> {
    const debtorId = input.debtorId;

    if (input.recurring === true) {
      const recurrence = await this.createRecurringInvoice(companyId, input);
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          companyId,
          recurringInvoiceId: recurrence.recurrenceId,
          recurrencePeriod: recurrence.lastGeneratedPeriod ?? undefined,
        },
        include: { debtor: true, recurringInvoice: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!invoice) {
        throw new Error('Nao foi possivel criar a fatura recorrente.');
      }

      return this.mapInvoiceListItem(invoice);
    }

    const dueDate = input.due_date ? this.parseDueDate(input.due_date) : null;
    if (!dueDate) {
      throw new Error('Data de vencimento invalida.');
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const debtor = debtorId
        ? await tx.debtor.findFirst({
            where: { id: debtorId, companyId },
          })
        : await tx.debtor.upsert({
            where: {
              companyId_phoneNumber: {
                companyId,
                phoneNumber: input.phone_number ?? '',
              },
            },
            update: {
              name: input.name ?? '',
              email: input.email ?? null,
            },
            create: {
              companyId,
              name: input.name ?? '',
              phoneNumber: input.phone_number ?? '',
              email: input.email ?? null,
            },
          });

      if (!debtor) {
        throw new Error('Devedor nao encontrado.');
      }

      return tx.invoice.create({
        data: {
          companyId,
          debtorId: debtor.id,
          originalAmount: input.original_amount,
          dueDate,
          billingType: input.billing_type,
        },
        include: { debtor: true, recurringInvoice: true },
      });
    });

    return this.mapInvoiceListItem(invoice);
  }

  async createDebtorInvoice(
    companyId: string,
    debtorId: string,
    input: Omit<CreateInvoiceInput, 'debtorId'>,
  ): Promise<InvoiceListItem> {
    return this.createInvoice(companyId, { ...input, debtorId });
  }

  async listRecurringInvoices(
    companyId: string,
  ): Promise<RecurringInvoiceListItem[]> {
    const recurrences = await this.prisma.recurringInvoice.findMany({
      where: { companyId },
      include: {
        debtor: true,
        invoices: {
          where: { companyId, status: 'PENDING' },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });

    return recurrences.map((recurrence) =>
      this.mapRecurringInvoiceListItem(recurrence),
    );
  }

  async updateRecurringInvoice(
    companyId: string,
    recurringInvoiceId: string,
    input: UpdateRecurringInvoiceInput,
  ): Promise<RecurringInvoiceListItem | null> {
    const recurrence = await this.prisma.recurringInvoice.findFirst({
      where: { id: recurringInvoiceId, companyId },
      select: { id: true },
    });

    if (!recurrence) {
      return null;
    }

    const nextDueDate = this.computeInitialRecurringDueDate(input.dueDay);

    await this.prisma.recurringInvoice.updateMany({
      where: { id: recurringInvoiceId, companyId },
      data: {
        amount: input.amount,
        billingType: input.billingType,
        dueDay: input.dueDay,
        nextDueDate,
      },
    });

    await this.generateRecurringInvoices(companyId);

    return this.getRecurringInvoice(companyId, recurringInvoiceId);
  }

  async updateRecurringStatus(
    companyId: string,
    recurringInvoiceId: string,
    status: RecurringInvoiceStatus,
  ): Promise<RecurringInvoiceListItem | null> {
    const recurrence = await this.prisma.recurringInvoice.findFirst({
      where: { id: recurringInvoiceId, companyId },
      select: { id: true, dueDay: true, nextDueDate: true },
    });

    if (!recurrence) {
      return null;
    }

    await this.prisma.recurringInvoice.updateMany({
      where: { id: recurringInvoiceId, companyId },
      data: {
        status,
        nextDueDate:
          status === 'ACTIVE' && !recurrence.nextDueDate
            ? this.computeInitialRecurringDueDate(recurrence.dueDay)
            : recurrence.nextDueDate,
      },
    });

    if (status === 'ACTIVE') {
      await this.generateRecurringInvoices(companyId);
    }

    return this.getRecurringInvoice(companyId, recurringInvoiceId);
  }

  async getDebtorSettings(
    companyId: string,
    debtorId: string,
  ): Promise<DebtorSettingsResponse | null> {
    const debtor = await this.prisma.debtor.findFirst({
      where: { id: debtorId, companyId },
      include: {
        company: {
          select: {
            preferredBillingMethod: true,
            collectionReminderDays: true,
            autoDiscountEnabled: true,
            autoDiscountDaysAfterDue: true,
            autoDiscountPercentage: true,
          },
        },
      },
    });

    if (!debtor) {
      return null;
    }

    const globalSettings = this.buildGlobalSettingsSnapshot(debtor.company);
    const effectiveSettings = debtor.useGlobalBillingSettings
      ? globalSettings
      : this.buildEffectiveCustomSettings({
          preferredBillingMethod: debtor.preferredBillingMethod,
          collectionReminderDays: debtor.collectionReminderDays,
          autoDiscountEnabled: debtor.autoDiscountEnabled,
          autoDiscountDaysAfterDue: debtor.autoDiscountDaysAfterDue,
          autoDiscountPercentage:
            debtor.autoDiscountPercentage?.toNumber() ?? null,
        });

    return {
      debtorId: debtor.id,
      debtorName: debtor.name,
      useGlobalBillingSettings: debtor.useGlobalBillingSettings,
      customPreferredBillingMethod: debtor.preferredBillingMethod,
      customCollectionReminderDays: this.normalizeReminderDays(
        debtor.collectionReminderDays,
        true,
      ),
      customAutoDiscountEnabled: debtor.autoDiscountEnabled,
      customAutoDiscountDaysAfterDue: debtor.autoDiscountDaysAfterDue,
      customAutoDiscountPercentage: debtor.autoDiscountPercentage
        ? Number(debtor.autoDiscountPercentage.toNumber().toFixed(2))
        : null,
      globalSettings,
      effectiveSettings,
      updatedAt: debtor.updatedAt.toISOString(),
    };
  }

  async updateDebtorSettings(
    companyId: string,
    debtorId: string,
    input: UpdateDebtorSettingsInput,
  ): Promise<DebtorSettingsResponse | null> {
    const debtor = await this.prisma.debtor.findFirst({
      where: { id: debtorId, companyId },
      select: { id: true },
    });

    if (!debtor) {
      return null;
    }

    const useGlobalBillingSettings = input.useGlobalBillingSettings;
    const normalizedSettings = useGlobalBillingSettings
      ? {
          preferredBillingMethod: null,
          collectionReminderDays: [],
          autoDiscountEnabled: null,
          autoDiscountDaysAfterDue: null,
          autoDiscountPercentage: null,
        }
      : this.buildEffectiveCustomSettings({
          preferredBillingMethod: input.preferredBillingMethod ?? 'PIX',
          collectionReminderDays: input.collectionReminderDays ?? [],
          autoDiscountEnabled: input.autoDiscountEnabled ?? false,
          autoDiscountDaysAfterDue: input.autoDiscountDaysAfterDue ?? null,
          autoDiscountPercentage: input.autoDiscountPercentage ?? null,
        });

    await this.prisma.debtor.updateMany({
      where: { id: debtorId, companyId },
      data: {
        useGlobalBillingSettings,
        preferredBillingMethod: useGlobalBillingSettings
          ? null
          : normalizedSettings.preferredBillingMethod,
        collectionReminderDays: normalizedSettings.collectionReminderDays,
        autoDiscountEnabled: useGlobalBillingSettings
          ? null
          : normalizedSettings.autoDiscountEnabled,
        autoDiscountDaysAfterDue: useGlobalBillingSettings
          ? null
          : normalizedSettings.autoDiscountDaysAfterDue,
        autoDiscountPercentage: useGlobalBillingSettings
          ? null
          : normalizedSettings.autoDiscountPercentage,
      },
    });

    return this.getDebtorSettings(companyId, debtorId);
  }

  private async createRecurringInvoice(
    companyId: string,
    input: CreateInvoiceInput,
  ): Promise<RecurringInvoiceListItem> {
    if (!input.due_day) {
      throw new Error('Dia de vencimento recorrente invalido.');
    }

    const debtor = input.debtorId
      ? await this.prisma.debtor.findFirst({
          where: { id: input.debtorId, companyId },
          select: { id: true },
        })
      : await this.prisma.debtor.upsert({
          where: {
            companyId_phoneNumber: {
              companyId,
              phoneNumber: input.phone_number ?? '',
            },
          },
          update: {
            name: input.name ?? '',
            email: input.email ?? null,
          },
          create: {
            companyId,
            name: input.name ?? '',
            phoneNumber: input.phone_number ?? '',
            email: input.email ?? null,
          },
          select: { id: true },
        });

    if (!debtor) {
      throw new Error('Devedor nao encontrado.');
    }

    const nextDueDate = this.computeInitialRecurringDueDate(input.due_day);
    const recurrence = await this.prisma.recurringInvoice.create({
      data: {
        companyId,
        debtorId: debtor.id,
        amount: input.original_amount,
        billingType: input.billing_type,
        dueDay: input.due_day,
        nextDueDate,
      },
    });

    await this.generateRecurringInvoices(companyId);

    const created = await this.getRecurringInvoice(companyId, recurrence.id);
    if (!created) {
      throw new Error('Nao foi possivel carregar a recorrencia criada.');
    }

    return created;
  }

  private async getRecurringInvoice(
    companyId: string,
    recurringInvoiceId: string,
  ): Promise<RecurringInvoiceListItem | null> {
    const recurrence = await this.prisma.recurringInvoice.findFirst({
      where: { id: recurringInvoiceId, companyId },
      include: {
        debtor: true,
        invoices: {
          where: { companyId, status: 'PENDING' },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
      },
    });

    return recurrence ? this.mapRecurringInvoiceListItem(recurrence) : null;
  }

  private async generateRecurringInvoices(companyId?: string): Promise<number> {
    const horizon = this.addDays(
      this.startOfDay(new Date()),
      RECURRING_GENERATION_LOOKAHEAD_DAYS,
    );
    const recurrences = await this.prisma.recurringInvoice.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        status: 'ACTIVE',
        OR: [{ nextDueDate: null }, { nextDueDate: { lte: horizon } }],
      },
    });

    let generated = 0;

    for (const recurrence of recurrences) {
      let nextDueDate =
        recurrence.nextDueDate ??
        this.computeInitialRecurringDueDate(recurrence.dueDay);

      while (nextDueDate <= horizon) {
        const recurrencePeriod = this.getRecurrencePeriod(nextDueDate);

        const invoice = await this.prisma.invoice.upsert({
          where: {
            recurringInvoiceId_recurrencePeriod: {
              recurringInvoiceId: recurrence.id,
              recurrencePeriod,
            },
          },
          update: {},
          create: {
            companyId: recurrence.companyId,
            debtorId: recurrence.debtorId,
            originalAmount: recurrence.amount,
            dueDate: nextDueDate,
            billingType: recurrence.billingType,
            recurringInvoiceId: recurrence.id,
            recurrencePeriod,
          },
        });

        if (invoice.createdAt.getTime() === invoice.updatedAt.getTime()) {
          generated++;
        }

        nextDueDate = this.computeNextMonthlyDueDate(
          nextDueDate,
          recurrence.dueDay,
        );

        await this.prisma.recurringInvoice.updateMany({
          where: { id: recurrence.id, companyId: recurrence.companyId },
          data: {
            lastGeneratedPeriod: recurrencePeriod,
            nextDueDate,
          },
        });
      }
    }

    return generated;
  }

  private mapInvoiceListItem(invoice: InvoiceWithRelations): InvoiceListItem {
    return {
      id: invoice.id,
      invoiceId: invoice.id,
      name: invoice.debtor.name,
      phone_number: invoice.debtor.phoneNumber,
      email: invoice.debtor.email || undefined,
      original_amount: Number(invoice.originalAmount.toNumber().toFixed(2)),
      due_date: this.formatDateOnly(invoice.dueDate),
      status: invoice.status,
      debtorId: invoice.debtor.id,
      gatewayId: invoice.gatewayId,
      pixPayload: invoice.pixPayload,
      billing_type: invoice.billingType,
      createdAt: invoice.createdAt.toISOString(),
      recurrence:
        invoice.recurringInvoiceId && invoice.recurrencePeriod
          ? {
              recurrenceId: invoice.recurringInvoiceId,
              period: invoice.recurrencePeriod,
              dueDay:
                invoice.recurringInvoice?.dueDay ??
                invoice.dueDate.getUTCDate(),
              status: invoice.recurringInvoice?.status ?? 'ACTIVE',
            }
          : undefined,
    };
  }

  private mapRecurringInvoiceListItem(
    recurrence: RecurringInvoiceWithRelations,
  ): RecurringInvoiceListItem {
    const pendingInvoice = recurrence.invoices[0];

    return {
      recurrenceId: recurrence.id,
      debtor: {
        debtorId: recurrence.debtor.id,
        name: recurrence.debtor.name,
        phone_number: recurrence.debtor.phoneNumber,
        email: recurrence.debtor.email || undefined,
      },
      amount: Number(recurrence.amount.toNumber().toFixed(2)),
      billingType: recurrence.billingType,
      dueDay: recurrence.dueDay,
      status: recurrence.status,
      nextDueDate: recurrence.nextDueDate
        ? this.formatDateOnly(recurrence.nextDueDate)
        : null,
      lastGeneratedPeriod: recurrence.lastGeneratedPeriod,
      pendingInvoice: pendingInvoice
        ? {
            invoiceId: pendingInvoice.id,
            dueDate: this.formatDateOnly(pendingInvoice.dueDate),
            amount: Number(pendingInvoice.originalAmount.toNumber().toFixed(2)),
            status: pendingInvoice.status,
          }
        : null,
      createdAt: recurrence.createdAt.toISOString(),
      updatedAt: recurrence.updatedAt.toISOString(),
    };
  }

  private computeInitialRecurringDueDate(dueDay: number): Date {
    const today = this.startOfDay(new Date());
    const currentMonthDate = this.getMonthlyDueDate(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      dueDay,
    );

    if (this.startOfDay(currentMonthDate) < today) {
      return this.computeNextMonthlyDueDate(currentMonthDate, dueDay);
    }

    return currentMonthDate;
  }

  private computeNextMonthlyDueDate(currentDueDate: Date, dueDay: number): Date {
    return this.getMonthlyDueDate(
      currentDueDate.getUTCFullYear(),
      currentDueDate.getUTCMonth() + 1,
      dueDay,
    );
  }

  private getMonthlyDueDate(
    year: number,
    monthIndex: number,
    dueDay: number,
  ): Date {
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const day = Math.min(dueDay, lastDay);

    return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
  }

  private getRecurrencePeriod(dueDate: Date): string {
    const year = dueDate.getUTCFullYear();
    const month = String(dueDate.getUTCMonth() + 1).padStart(2, '0');

    return `${year}-${month}`;
  }

  private startOfDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_IN_MS);
  }

  private parseDueDate(raw: string): Date | null {
    const trimmed = raw.trim();

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const d = new Date(
        `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00Z`,
      );
      return isNaN(d.getTime()) ? null : d;
    }

    const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const d = new Date(`${brMatch[3]}-${brMatch[2]}-${brMatch[1]}T12:00:00Z`);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  }

  private formatDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private normalizeReminderDays(
    reminderDays: number[] | null | undefined,
    allowEmpty = false,
  ): number[] {
    const normalizedDays = Array.from(
      new Set(
        (reminderDays ?? []).filter(
          (day) => Number.isInteger(day) && day >= -30 && day <= 365,
        ),
      ),
    ).sort((left, right) => left - right);

    if (allowEmpty) {
      return normalizedDays;
    }

    return normalizedDays.length > 0 ? normalizedDays : [0];
  }

  private normalizeBillingMethod(
    value: BillingMethod | null | undefined,
  ): BillingMethod {
    if (value === 'PIX' || value === 'BOLETO' || value === 'BOLIX') {
      return value;
    }

    return 'PIX';
  }

  private normalizeDiscountDays(value: number | null | undefined): number {
    if (!Number.isInteger(value) || value === undefined || value === null) {
      return 0;
    }

    if (value < 0) {
      return 0;
    }

    if (value > 365) {
      return 365;
    }

    return value;
  }

  private normalizeDiscountPercentage(
    value: number | null | undefined,
  ): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    if (value <= 0) {
      return null;
    }

    if (value > 100) {
      return 100;
    }

    return Number(value.toFixed(2));
  }

  private buildGlobalSettingsSnapshot(company: {
    preferredBillingMethod: BillingMethod;
    collectionReminderDays: number[];
    autoDiscountEnabled: boolean;
    autoDiscountDaysAfterDue: number | null;
    autoDiscountPercentage: { toNumber(): number } | null;
  }): BillingSettingsSnapshot {
    return {
      preferredBillingMethod: this.normalizeBillingMethod(
        company.preferredBillingMethod,
      ),
      collectionReminderDays: this.normalizeReminderDays(
        company.collectionReminderDays,
      ),
      autoDiscountEnabled: company.autoDiscountEnabled,
      autoDiscountDaysAfterDue: company.autoDiscountEnabled
        ? this.normalizeDiscountDays(company.autoDiscountDaysAfterDue)
        : null,
      autoDiscountPercentage: company.autoDiscountEnabled
        ? this.normalizeDiscountPercentage(
            company.autoDiscountPercentage?.toNumber(),
          )
        : null,
      tariffs: this.buildTariffs(),
    };
  }

  private buildEffectiveCustomSettings(input: {
    preferredBillingMethod: BillingMethod | null;
    collectionReminderDays: number[];
    autoDiscountEnabled: boolean | null;
    autoDiscountDaysAfterDue: number | null;
    autoDiscountPercentage: number | null;
  }): BillingSettingsSnapshot {
    const autoDiscountEnabled = input.autoDiscountEnabled ?? false;

    return {
      preferredBillingMethod: this.normalizeBillingMethod(
        input.preferredBillingMethod,
      ),
      collectionReminderDays: this.normalizeReminderDays(
        input.collectionReminderDays,
      ),
      autoDiscountEnabled,
      autoDiscountDaysAfterDue: autoDiscountEnabled
        ? this.normalizeDiscountDays(input.autoDiscountDaysAfterDue)
        : null,
      autoDiscountPercentage: autoDiscountEnabled
        ? this.normalizeDiscountPercentage(input.autoDiscountPercentage)
        : null,
      tariffs: this.buildTariffs(),
    };
  }

  private buildTariffs(): BillingSettingsSnapshot['tariffs'] {
    return {
      PIX: {
        method: 'PIX',
        efiLabel: '1,19%',
        platformLabel: 'R$ 0,50',
        combinedLabel: '1,19% + R$ 0,50',
        efiKind: 'percentage',
        efiValue: 1.19,
        platformFixedFee: PLATFORM_FIXED_FEE,
      },
      BOLETO: {
        method: 'BOLETO',
        efiLabel: 'R$ 3,45',
        platformLabel: 'R$ 0,50',
        combinedLabel: 'R$ 3,95',
        efiKind: 'fixed',
        efiValue: 3.45,
        platformFixedFee: PLATFORM_FIXED_FEE,
      },
      BOLIX: {
        method: 'BOLIX',
        efiLabel: 'R$ 3,45',
        platformLabel: 'R$ 0,50',
        combinedLabel: 'R$ 3,95',
        efiKind: 'fixed',
        efiValue: 3.45,
        platformFixedFee: PLATFORM_FIXED_FEE,
      },
    };
  }
}
