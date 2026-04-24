import { Injectable } from '@nestjs/common';
import { BillingMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PLATFORM_FIXED_FEE = 0.5;

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
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<InvoiceListItem[]> {
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
      due_date: this.formatDateOnly(inv.dueDate),
      status: inv.status,
      debtorId: inv.debtor.id,
      gatewayId: inv.gatewayId,
      pixPayload: inv.pixPayload,
      billing_type: inv.billingType,
      createdAt: inv.createdAt.toISOString(),
    }));
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
