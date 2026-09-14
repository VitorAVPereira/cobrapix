import { BadRequestException, Injectable } from '@nestjs/common';
import { EfiOnboarding, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { EfiOpeningClient, EfiOpeningError } from './efi-opening.client';
import { OnboardingJobs } from './onboarding-jobs';
import { functionalRefusal } from './onboarding-policy';

const callbackSchema = z.object({
  evento: z.enum(['conta_aberta', 'conta_recusada_pelo_cliente_final']),
  contaSimplificada: z.object({ identificador: z.string().min(1).max(128) }),
});

@Injectable()
export class OnboardingEvents {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: EfiOpeningClient,
    private readonly jobs: OnboardingJobs,
  ) {}
  async handle(payload: unknown): Promise<void> {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 0
    )
      return;
    const parsed = callbackSchema.safeParse(payload);
    if (!parsed.success)
      throw new BadRequestException('Notificação Efí inválida.');
    // Signed provider identifier resolves the tenant; mutations remain company-scoped.
    const row = await this.prisma.efiOnboarding.findUnique({
      where: {
        simplifiedAccountRequestId: parsed.data.contaSimplificada.identificador,
      },
    });
    if (!row || !this.pending(row)) return;
    if (parsed.data.evento === 'conta_aberta') await this.open(row);
    else await this.refuse(row);
  }

  async reconcile(companyId: string): Promise<void> {
    const row = await this.prisma.efiOnboarding.findUnique({
      where: { companyId },
    });
    if (!row?.simplifiedAccountRequestId || !this.pending(row)) return;
    try {
      const credentials = await this.client.getCredentials(
        row.simplifiedAccountRequestId,
      );
      if (credentials.active) await this.open(row);
    } catch (error: unknown) {
      if (
        error instanceof EfiOpeningError &&
        error.code === 'conta_em_processamento'
      ) {
        await this.prisma.efiOnboarding.updateMany({
          where: { companyId, status: 'AWAITING_REPRESENTATIVE' },
          data: { status: 'EFI_PROCESSING', lastProgressAt: new Date() },
        });
      } else if (
        !(error instanceof EfiOpeningError && error.httpStatus === 412)
      )
        throw error;
    }
  }

  private async open(row: EfiOnboarding): Promise<void> {
    const changed = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<boolean> => {
        const result = await tx.efiOnboarding.updateMany({
          where: {
            companyId: row.companyId,
            status: { in: ['AWAITING_REPRESENTATIVE', 'EFI_PROCESSING'] },
          },
          data: {
            status: 'PROVISIONING',
            provisioningAttempts: 0,
            lastProgressAt: new Date(),
            nextReminderAt: null,
          },
        });
        if (result.count !== 1) return false;
        await this.audit(tx, row, 'EFI_ACCOUNT_APPROVED');
        return true;
      },
    );
    if (changed)
      await this.jobs.schedule(
        row.companyId,
        'provision',
        row.draftRevision * 100 + 1,
        60_000,
      );
  }

  private async refuse(row: EfiOnboarding): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<void> => {
        const result = await tx.efiOnboarding.updateMany({
          where: {
            companyId: row.companyId,
            status: { in: ['AWAITING_REPRESENTATIVE', 'EFI_PROCESSING'] },
          },
          data: {
            status: 'REFUSED',
            refusalAt: now,
            retryBlockedUntil: new Date(now.getTime() + 2 * 86400_000),
            consentAcceptedAt: null,
            consentDraftRevision: null,
            nextReminderAt: null,
            lastProgressAt: now,
            sanitizedErrorCode: 'REPRESENTATIVE_REFUSED',
            sanitizedErrorMessage: functionalRefusal(
              'conta_recusada_pelo_cliente_final',
            ),
          },
        });
        if (result.count === 1)
          await this.audit(tx, row, 'EFI_REPRESENTATIVE_REFUSED');
      },
    );
  }

  private pending(row: EfiOnboarding): boolean {
    return (
      row.status === 'AWAITING_REPRESENTATIVE' ||
      row.status === 'EFI_PROCESSING'
    );
  }
  private async audit(
    tx: Prisma.TransactionClient,
    row: EfiOnboarding,
    action: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        companyId: row.companyId,
        entityType: 'EfiOnboarding',
        entityId: row.id,
        action,
        retentionExpiresAt: new Date(Date.now() + 5 * 365.25 * 86400_000),
      },
    });
  }
}
