import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EfiOnboarding } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingNotifications } from './onboarding-notifications';
import { readCheckpoint } from './onboarding-checkpoint';

const PENDING = ['AWAITING_REPRESENTATIVE', 'EFI_PROCESSING'] as const;

@Injectable()
export class OnboardingMaintenance {
  private readonly logger = new Logger(OnboardingMaintenance.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly jobs: OnboardingJobs,
    private readonly notifications: OnboardingNotifications,
  ) {}
  @Cron('0 */5 * * * *')
  async recover(): Promise<void> {
    // Internal scheduler intentionally enumerates tenants in bounded pages.
    let cursor: string | undefined;
    do {
      const rows = await this.prisma.efiOnboarding.findMany({
        where: {
          status: {
            in: [
              'NOTICE_PENDING',
              'PROVISIONING',
              ...PENDING,
              'SUBMISSION_UNCERTAIN',
              'CONFIGURATION_ERROR',
            ],
          },
        },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) {
        try {
          await this.recoverRow(row);
        } catch {
          this.logger.error('EFI_ONBOARDING_RECOVERY_FAILED');
        }
      }
      cursor = rows.length === 100 ? rows.at(-1)?.id : undefined;
    } while (cursor);
  }

  async remind(companyId: string, attempt: number): Promise<void> {
    const row = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
      include: { company: true },
    });
    const hour = attempt % 100;
    if (
      !row ||
      !PENDING.some((status): boolean => status === row.status) ||
      Math.floor(attempt / 100) !== row.draftRevision ||
      ![24, 72].includes(hour) ||
      !row.submittedAt ||
      Date.now() < row.submittedAt.getTime() + hour * 3600_000 ||
      !row.representativePhoneEncrypted ||
      !row.sensitiveDataExpiresAt ||
      row.sensitiveDataExpiresAt.getTime() <= Date.now()
    )
      return;
    const expected = hour === 24 ? 0 : 1;
    if (row.reminderAttempts !== expected) return;
    const claim = await this.prisma.efiOnboarding.updateMany({
      where: {
        companyId,
        status: row.status,
        draftRevision: row.draftRevision,
        reminderAttempts: expected,
      },
      data: { reminderAttempts: expected + 1 },
    });
    if (claim.count !== 1) return;
    try {
      await this.notifications.sendReminder(
        companyId,
        this.crypto.decrypt(row.representativePhoneEncrypted),
        row.company.tradeName ?? row.company.corporateName,
      );
    } catch (error: unknown) {
      await this.prisma.efiOnboarding.updateMany({
        where: {
          companyId,
          draftRevision: row.draftRevision,
          reminderAttempts: expected + 1,
        },
        data: { reminderAttempts: expected },
      });
      throw error;
    }
    await this.prisma.efiOnboarding.updateMany({
      where: { companyId, draftRevision: row.draftRevision },
      data: {
        lastReminderAt: new Date(),
        nextReminderAt:
          hour === 24
            ? new Date(row.submittedAt.getTime() + 72 * 3600_000)
            : null,
      },
    });
  }

  private async recoverRow(row: EfiOnboarding): Promise<void> {
    const checkpoint = readCheckpoint(row.provisioningCheckpoint);
    const base = row.draftRevision * 100;
    if (row.status === 'NOTICE_PENDING') {
      const at =
        typeof checkpoint.noticeRetryAt === 'string'
          ? Date.parse(checkpoint.noticeRetryAt)
          : Date.now();
      await this.jobs.schedule(
        row.companyId,
        'submit',
        base + row.noticeAttempts,
        Math.max(0, at - Date.now()),
        true,
      );
    } else if (row.status === 'PROVISIONING') {
      const at =
        typeof checkpoint.provisionRetryAt === 'string'
          ? Date.parse(checkpoint.provisionRetryAt)
          : row.lastProgressAt.getTime() + 60_000;
      if (row.provisioningAttempts >= 5 && at <= Date.now()) {
        await this.prisma.efiOnboarding.updateMany({
          where: {
            companyId: row.companyId,
            status: 'PROVISIONING',
            provisioningAttempts: { gte: 5 },
          },
          data: {
            status: 'CONFIGURATION_ERROR',
            sanitizedErrorCode: 'EFI_PROVISIONING_EXHAUSTED',
            sanitizedErrorMessage:
              'A configuração financeira requer revisão da CifraMais.',
          },
        });
        await this.notifications.alert(
          row.companyId,
          'EFI_PROVISIONING_EXHAUSTED',
        );
        return;
      }
      await this.jobs.schedule(
        row.companyId,
        'provision',
        base + row.provisioningAttempts + 1,
        Math.max(0, at - Date.now()),
        true,
      );
    } else if (PENDING.some((status): boolean => status === row.status)) {
      // One durable reconciliation job per six-hour bucket; completed buckets stay deduplicated.
      await this.jobs.schedule(
        row.companyId,
        'reconcile',
        Math.floor(Date.now() / (6 * 3600_000)),
      );
      if (row.submittedAt && row.reminderAttempts < 2) {
        const hour = row.reminderAttempts === 0 ? 24 : 72;
        await this.jobs.schedule(
          row.companyId,
          'remind',
          base + hour,
          Math.max(0, row.submittedAt.getTime() + hour * 3600_000 - Date.now()),
          true,
        );
      }
    }
    if (
      !row.adminAlertedAt &&
      (['SUBMISSION_UNCERTAIN', 'CONFIGURATION_ERROR'].includes(row.status) ||
        (row.submittedAt &&
          Date.now() - row.submittedAt.getTime() >= 7 * 86400_000))
    ) {
      await this.notifications.alert(
        row.companyId,
        row.status === 'SUBMISSION_UNCERTAIN'
          ? 'EFI_SUBMISSION_UNCERTAIN'
          : 'EFI_ONBOARDING_REQUIRES_ATTENTION',
      );
      await this.prisma.efiOnboarding.updateMany({
        where: {
          companyId: row.companyId,
          draftRevision: row.draftRevision,
          adminAlertedAt: null,
        },
        data: { adminAlertedAt: new Date() },
      });
    }
  }
}
