import { HttpException, Injectable } from '@nestjs/common';
import { Company, EfiOnboarding } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import {
  EfiApplicant,
  EfiOpeningClient,
  EfiOpeningError,
} from './efi-opening.client';
import { OnboardingNotifications } from './onboarding-notifications';
import { OnboardingJobs } from './onboarding-jobs';
import { functionalRefusal } from './onboarding-policy';
import { readCheckpoint } from './onboarding-checkpoint';

const NOTICE_DELAYS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
type OnboardingWithCompany = EfiOnboarding & { company: Company };

@Injectable()
export class OnboardingWorkflow {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly client: EfiOpeningClient,
    private readonly notifications: OnboardingNotifications,
    private readonly jobs: OnboardingJobs,
  ) {}
  async submit(companyId: string, expectedRevision?: number): Promise<void> {
    const row = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
      include: { company: true },
    });
    if (
      !row ||
      (expectedRevision !== undefined &&
        row.draftRevision !== expectedRevision) ||
      row.status !== 'NOTICE_PENDING' ||
      !(await this.openingEnabled())
    )
      return;
    const checkpoint = readCheckpoint(row.provisioningCheckpoint);
    if (
      typeof checkpoint.noticeRetryAt === 'string' &&
      new Date(checkpoint.noticeRetryAt).getTime() > Date.now()
    )
      return;
    let applicant: EfiApplicant;
    try {
      if (
        !row.sensitiveDataExpiresAt ||
        row.sensitiveDataExpiresAt.getTime() <= Date.now() ||
        row.submittedCompanyDocument !== row.company.document
      )
        throw new Error();
      applicant = this.applicant(row);
    } catch {
      await this.fail(
        companyId,
        'NOTICE_PENDING',
        'CORRECTION_REQUIRED',
        'ONBOARDING_DATA_EXPIRED',
      );
      return;
    }
    if (!row.noticeAcceptedAt && !(await this.sendNotice(row, applicant)))
      return;
    if (!(await this.openingEnabled())) return;
    // Persist uncertainty BEFORE the non-idempotent POST. A crash can never cause an automatic second submission.
    const claim = await this.prisma.efiOnboarding.updateMany({
      where: {
        companyId,
        status: 'NOTICE_PENDING',
        noticeAcceptedAt: { not: null },
      },
      data: {
        status: 'SUBMISSION_UNCERTAIN',
        submissionAttempts: { increment: 1 },
        lastProgressAt: new Date(),
      },
    });
    if (claim.count !== 1) return;
    try {
      const requestId = await this.client.createAccount(applicant);
      const submittedAt = new Date();
      await this.prisma.efiOnboarding.updateMany({
        where: { companyId, status: 'SUBMISSION_UNCERTAIN' },
        data: {
          status: 'AWAITING_REPRESENTATIVE',
          simplifiedAccountRequestId: requestId,
          submittedAt,
          lastProgressAt: submittedAt,
          nextReminderAt: new Date(submittedAt.getTime() + 86400_000),
          sanitizedErrorCode: null,
          sanitizedErrorMessage: null,
        },
      });
    } catch (error: unknown) {
      if (error instanceof EfiOpeningError && !error.uncertain) {
        const status =
          error.code === 'EFI_AUTHENTICATION_FAILED'
            ? 'CONFIGURATION_ERROR'
            : 'CORRECTION_REQUIRED';
        await this.fail(companyId, 'SUBMISSION_UNCERTAIN', status, error.code);
      } else {
        await this.fail(
          companyId,
          'SUBMISSION_UNCERTAIN',
          'SUBMISSION_UNCERTAIN',
          'EFI_SUBMISSION_UNCERTAIN',
        );
      }
      await this.notifications.alert(
        companyId,
        error instanceof EfiOpeningError
          ? error.code
          : 'EFI_SUBMISSION_UNCERTAIN',
      );
      return;
    }
    await this.audit(companyId, row.id, 'EFI_SUBMITTED');
    await this.jobs.schedule(
      companyId,
      'remind',
      row.draftRevision * 100 + 24,
      86400_000,
    );
    await this.jobs.schedule(
      companyId,
      'remind',
      row.draftRevision * 100 + 72,
      3 * 86400_000,
    );
  }

  private async sendNotice(
    row: OnboardingWithCompany,
    applicant: EfiApplicant,
  ): Promise<boolean> {
    const attempt = row.noticeAttempts + 1;
    const claim = await this.prisma.efiOnboarding.updateMany({
      where: {
        companyId: row.companyId,
        status: 'NOTICE_PENDING',
        noticeAttempts: row.noticeAttempts,
      },
      data: { noticeAttempts: attempt },
    });
    if (claim.count !== 1) return false;
    try {
      const messageId = await this.notifications.sendNotice(
        row.companyId,
        applicant.celular,
        applicant.nomeCompleto,
        row.company.tradeName ?? row.company.corporateName,
      );
      if (!messageId) throw new Error('NOTICE_NOT_ACCEPTED');
      await this.prisma.efiOnboarding.updateMany({
        where: { companyId: row.companyId, status: 'NOTICE_PENDING' },
        data: { noticeAcceptedAt: new Date(), lastProgressAt: new Date() },
      });
      return true;
    } catch (error: unknown) {
      const delay = NOTICE_DELAYS[attempt - 1];
      const permanent =
        error instanceof HttpException &&
        [400, 401, 403, 404].includes(error.getStatus());
      if (delay === undefined || permanent)
        await this.fail(
          row.companyId,
          'NOTICE_PENDING',
          'CORRECTION_REQUIRED',
          'NOTICE_FAILED',
        );
      else {
        await this.prisma.efiOnboarding.updateMany({
          where: { companyId: row.companyId, status: 'NOTICE_PENDING' },
          data: {
            provisioningCheckpoint: {
              ...readCheckpoint(row.provisioningCheckpoint),
              noticeRetryAt: new Date(Date.now() + delay).toISOString(),
            },
          },
        });
        await this.jobs.schedule(
          row.companyId,
          'submit',
          row.draftRevision * 100 + attempt,
          delay,
        );
      }
      return false;
    }
  }

  private applicant(row: OnboardingWithCompany): EfiApplicant {
    const decrypt = (value: string | null): string => {
      if (!value) throw new Error();
      return this.crypto.decrypt(value);
    };
    const required = (value: string | null): string => {
      if (!value?.trim()) throw new Error();
      return value;
    };
    const company = row.company;
    const birthDate = decrypt(row.representativeBirthDateEncrypted);
    const [year, month, day] = birthDate.split('-');
    if (!year || !month || !day) throw new Error();
    return {
      cpf: decrypt(row.representativeCpfEncrypted),
      nomeCompleto: decrypt(row.representativeNameEncrypted),
      dataNascimento: `${day}/${month}/${year}`,
      nomeMae: decrypt(row.representativeMotherNameEncrypted),
      celular: decrypt(row.representativePhoneEncrypted).replace(
        /^55(?=\d{10,11}$)/,
        '',
      ),
      email: decrypt(row.representativeEmailEncrypted),
      cnpj: company.document,
      razaoSocial: company.corporateName,
      endereco: {
        cep: required(company.addressPostalCode),
        estado: required(company.addressState),
        cidade: required(company.addressCity),
        bairro: required(company.addressDistrict),
        logradouro: required(company.addressStreet),
        numero: required(company.addressNumber),
      },
    };
  }

  private async openingEnabled(): Promise<boolean> {
    const state = await this.prisma.platformIntegrationState.findUnique({
      where: { integration: 'EFI_ONBOARDING' },
    });
    return state?.enabled === true;
  }

  private async fail(
    companyId: string,
    previous: EfiOnboarding['status'],
    status: EfiOnboarding['status'],
    code: string,
  ): Promise<void> {
    await this.prisma.efiOnboarding.updateMany({
      where: { companyId, status: previous },
      data: {
        status,
        sanitizedErrorCode: code,
        sanitizedErrorMessage: functionalRefusal(code),
        lastProgressAt: new Date(),
      },
    });
  }

  private async audit(
    companyId: string,
    entityId: string,
    action: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        companyId,
        entityId,
        entityType: 'EfiOnboarding',
        action,
        retentionExpiresAt: new Date(Date.now() + 5 * 365.25 * 86400_000),
      },
    });
  }
}
