import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Company, EfiOnboarding, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { OnboardingJobs } from './onboarding-jobs';
import { OnboardingDraftDto } from './onboarding.dto';
import { assertFreshConsent, canEditOnboarding } from './onboarding-policy';
import { validateDebtorDocument } from '../common/debtor-document';

const SENSITIVE_FIELDS = [
  'representativeNameEncrypted',
  'representativeCpfEncrypted',
  'representativeBirthDateEncrypted',
  'representativeMotherNameEncrypted',
  'representativeEmailEncrypted',
  'representativePhoneEncrypted',
] as const;

@Injectable()
export class EfiOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly config: ConfigService,
    private readonly jobs: OnboardingJobs,
  ) {}
  async get(user: AuthenticatedUser): Promise<unknown> {
    this.requireCompanyAdmin(user);
    const [row, company, timeline] = await Promise.all([
      this.prisma.efiOnboarding.findUnique({
        where: { companyId: user.companyId },
      }),
      this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: {
          corporateName: true,
          tradeName: true,
          document: true,
          addressPostalCode: true,
          addressStreet: true,
          addressNumber: true,
          addressDistrict: true,
          addressCity: true,
          addressState: true,
        },
      }),
      this.prisma.auditLog.findMany({
        where: { companyId: user.companyId, entityType: 'EfiOnboarding' },
        select: { action: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
    ]);
    if (!company) throw new HttpException('Empresa não encontrada.', 404);
    const editable =
      !row || canEditOnboarding(row.status, row.retryBlockedUntil, new Date());
    return {
      status: row?.status ?? 'DRAFT',
      revision: row?.draftRevision ?? 0,
      company,
      representativeProvided: SENSITIVE_FIELDS.every((field): boolean =>
        Boolean(row?.[field]),
      ),
      consentAcceptedAt: row?.consentAcceptedAt ?? null,
      legalVersions: this.legalVersions(),
      reason: row?.sanitizedErrorMessage ?? null,
      submittedAt: row?.submittedAt ?? null,
      activatedAt: row?.activatedAt ?? null,
      lastReminderAt: row?.lastReminderAt ?? null,
      reminderAttempts: row?.reminderAttempts ?? 0,
      retryBlockedUntil: row?.retryBlockedUntil ?? null,
      timeline,
      actions: {
        canEdit: editable,
        canSubmit: editable && row?.status === 'DRAFT',
        canRetry:
          row?.status === 'CORRECTION_REQUIRED' ||
          (row?.status === 'REFUSED' && editable),
      },
    };
  }

  async saveDraft(
    user: AuthenticatedUser,
    dto: OnboardingDraftDto,
    ip: string,
  ): Promise<unknown> {
    this.requireCompanyAdmin(user);
    this.validateDraft(dto);
    const now = new Date();
    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<void> => {
        const row = await tx.efiOnboarding.findUnique({
          where: { companyId: user.companyId },
        });
        if (
          row &&
          (!canEditOnboarding(row.status, row.retryBlockedUntil, now) ||
            dto.revision !== row.draftRevision)
        )
          this.error(
            'ONBOARDING_LOCKED',
            'Atualize a página. Esta solicitação não pode ser editada agora.',
          );
        const revision = (row?.draftRevision ?? 0) + 1;
        const companyData = this.companyData(dto);
        await tx.company.update({
          where: { id: user.companyId },
          data: companyData,
        });
        const encrypted = this.encryptRepresentative(dto);
        const accepted = dto.consent !== undefined;
        const versions = this.legalVersions();
        const data = {
          ...encrypted,
          status: 'DRAFT' as const,
          draftRevision: revision,
          consentDraftRevision: accepted ? revision : null,
          consentAcceptedAt: accepted ? now : null,
          consentUserId: accepted ? user.userId : null,
          consentIpAddress: accepted ? ip.slice(0, 45) : null,
          authorizationTextVersion: accepted ? versions.authorization : null,
          termsVersion: accepted ? versions.terms : null,
          privacyPolicyVersion: accepted ? versions.privacy : null,
          sensitiveDataKeyVersion: this.crypto.activeKeyVersion,
          sensitiveDataExpiresAt: new Date(now.getTime() + 30 * 86400_000),
          sensitiveDataDeletedAt: null,
          lastProgressAt: now,
          simplifiedAccountRequestId: null,
          submittedCompanyDocument: null,
          noticeAcceptedAt: null,
          noticeAttempts: 0,
          provisioningAttempts: 0,
          reminderAttempts: 0,
          nextReminderAt: null,
          adminAlertedAt: null,
          sanitizedErrorCode: null,
          sanitizedErrorMessage: null,
        };
        if (row) {
          const result = await tx.efiOnboarding.updateMany({
            where: {
              companyId: user.companyId,
              draftRevision: row.draftRevision,
              status: row.status,
            },
            data,
          });
          if (result.count !== 1)
            this.error(
              'ONBOARDING_LOCKED',
              'O rascunho foi alterado. Atualize a página.',
            );
        } else
          await tx.efiOnboarding.create({
            data: { companyId: user.companyId, ...data },
          });
        await tx.auditLog.create({
          data: {
            companyId: user.companyId,
            userId: user.userId,
            entityType: 'EfiOnboarding',
            entityId: row?.id ?? user.companyId,
            action: accepted ? 'EFI_DRAFT_CONSENTED' : 'EFI_DRAFT_SAVED',
            changes: {
              revision,
              previousRequestId: row?.simplifiedAccountRequestId ?? null,
              authorizationVersion: accepted ? versions.authorization : null,
              termsVersion: accepted ? versions.terms : null,
              privacyVersion: accepted ? versions.privacy : null,
            },
            retentionExpiresAt: new Date(
              now.getTime() + 5 * 365.25 * 86400_000,
            ),
          },
        });
      },
    );
    return this.get(user);
  }

  async submit(user: AuthenticatedUser): Promise<unknown> {
    this.requireCompanyAdmin(user);
    const state = await this.prisma.platformIntegrationState.findUnique({
      where: { integration: 'EFI_ONBOARDING' },
    });
    if (!state?.enabled)
      this.error(
        'ONBOARDING_PAUSED',
        'Novas ativações estão temporariamente pausadas. Seu rascunho está salvo.',
      );
    const row = await this.prisma.efiOnboarding.findUnique({
      where: { companyId: user.companyId },
    });
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
    });
    if (!row || !company || row.status !== 'DRAFT')
      this.error(
        'ONBOARDING_LOCKED',
        'Salve um rascunho corrigido antes de enviar.',
      );
    const versions = this.legalVersions();
    try {
      assertFreshConsent(
        row.draftRevision,
        row.consentDraftRevision,
        row.consentAcceptedAt,
        [
          row.authorizationTextVersion,
          row.termsVersion,
          row.privacyPolicyVersion,
        ],
        [versions.authorization, versions.terms, versions.privacy],
      );
    } catch {
      this.error(
        'CONSENT_REQUIRED',
        'Leia e aceite novamente a autorização, os termos e a política de privacidade.',
      );
    }
    this.assertComplete(row, company);
    const claimed = await this.prisma.efiOnboarding.updateMany({
      where: {
        companyId: user.companyId,
        status: 'DRAFT',
        draftRevision: row.draftRevision,
      },
      data: {
        status: 'NOTICE_PENDING',
        submittedCompanyDocument: company.document,
        lastProgressAt: new Date(),
      },
    });
    if (claimed.count !== 1)
      this.error(
        'ONBOARDING_LOCKED',
        'A solicitação já está sendo processada.',
      );
    // If Redis is unavailable, the persisted NOTICE_PENDING is recovered by the scheduler.
    await this.jobs.schedule(user.companyId, 'submit', row.draftRevision * 100);
    return this.get(user);
  }

  private legalVersions(): {
    authorization: string;
    terms: string;
    privacy: string;
  } {
    return {
      authorization:
        this.config.get<string>('EFI_ONBOARDING_AUTHORIZATION_VERSION') ??
        'draft-v1',
      terms:
        this.config.get<string>('EFI_ONBOARDING_TERMS_VERSION') ?? 'draft-v1',
      privacy:
        this.config.get<string>('EFI_ONBOARDING_PRIVACY_VERSION') ?? 'draft-v1',
    };
  }

  private validateDraft(dto: OnboardingDraftDto): void {
    if (
      dto.document &&
      (dto.document.length !== 14 ||
        !validateDebtorDocument(dto.document).valid)
    )
      this.error('INVALID_COMPANY_DOCUMENT', 'Informe um CNPJ válido.');
    if (
      dto.representative?.cpf &&
      (dto.representative.cpf.length !== 11 ||
        !validateDebtorDocument(dto.representative.cpf).valid)
    )
      this.error(
        'INVALID_REPRESENTATIVE_DOCUMENT',
        'Informe um CPF válido para o representante.',
      );
    if (dto.representative?.birthDate) {
      const birth = new Date(`${dto.representative.birthDate}T00:00:00Z`);
      const adult = new Date();
      adult.setUTCFullYear(adult.getUTCFullYear() - 18);
      if (!Number.isFinite(birth.getTime()) || birth > adult)
        this.error(
          'INVALID_REPRESENTATIVE_AGE',
          'O representante precisa ter pelo menos 18 anos.',
        );
    }
    if (dto.consent) {
      const versions = this.legalVersions();
      if (
        dto.consent.authorized !== true ||
        dto.consent.termsAccepted !== true ||
        dto.consent.privacyAccepted !== true ||
        dto.consent.authorizationVersion !== versions.authorization ||
        dto.consent.termsVersion !== versions.terms ||
        dto.consent.privacyVersion !== versions.privacy
      )
        this.error(
          'CONSENT_REQUIRED',
          'Confirme a autorização e aceite as versões atuais dos termos e da política de privacidade.',
        );
    }
  }

  private companyData(dto: OnboardingDraftDto): Prisma.CompanyUpdateInput {
    return {
      ...(dto.corporateName !== undefined
        ? { corporateName: dto.corporateName }
        : {}),
      ...(dto.tradeName !== undefined ? { tradeName: dto.tradeName } : {}),
      ...(dto.document !== undefined ? { document: dto.document } : {}),
      ...(dto.address?.postalCode !== undefined
        ? { addressPostalCode: dto.address.postalCode }
        : {}),
      ...(dto.address?.street !== undefined
        ? { addressStreet: dto.address.street }
        : {}),
      ...(dto.address?.number !== undefined
        ? { addressNumber: dto.address.number }
        : {}),
      ...(dto.address?.district !== undefined
        ? { addressDistrict: dto.address.district }
        : {}),
      ...(dto.address?.city !== undefined
        ? { addressCity: dto.address.city }
        : {}),
      ...(dto.address?.state !== undefined
        ? { addressState: dto.address.state }
        : {}),
    };
  }

  private encryptRepresentative(
    dto: OnboardingDraftDto,
  ): Partial<Pick<EfiOnboarding, (typeof SENSITIVE_FIELDS)[number]>> {
    const representative = dto.representative;
    if (!representative) return {};
    const data: Partial<
      Pick<EfiOnboarding, (typeof SENSITIVE_FIELDS)[number]>
    > = {};
    const mapping = {
      name: 'representativeNameEncrypted',
      cpf: 'representativeCpfEncrypted',
      birthDate: 'representativeBirthDateEncrypted',
      motherName: 'representativeMotherNameEncrypted',
      email: 'representativeEmailEncrypted',
      phone: 'representativePhoneEncrypted',
    } as const;
    for (const key of Object.keys(mapping) as Array<keyof typeof mapping>) {
      const value = representative[key];
      if (value !== undefined) data[mapping[key]] = this.crypto.encrypt(value);
    }
    return data;
  }

  private assertComplete(row: EfiOnboarding, company: Company): void {
    if (
      !SENSITIVE_FIELDS.every((field): boolean => Boolean(row[field])) ||
      !row.sensitiveDataExpiresAt ||
      row.sensitiveDataExpiresAt.getTime() <= Date.now() ||
      company.document.length !== 14 ||
      !validateDebtorDocument(company.document).valid ||
      ![
        company.corporateName,
        company.addressPostalCode,
        company.addressStreet,
        company.addressNumber,
        company.addressDistrict,
        company.addressCity,
        company.addressState,
      ].every(Boolean)
    )
      this.error(
        'ONBOARDING_INCOMPLETE',
        'Complete os dados da empresa, endereço e representante antes de enviar.',
      );
  }

  private requireCompanyAdmin(user: AuthenticatedUser): void {
    if (user.role !== 'COMPANY_ADMIN' || user.mustChangePassword)
      throw new ForbiddenException(
        'Acesso restrito ao administrador da empresa após a troca de senha.',
      );
  }

  private error(code: string, message: string): never {
    throw new HttpException({ code, message }, 409);
  }
}
