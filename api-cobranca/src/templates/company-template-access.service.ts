import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WhatsappTemplatePurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TemplatePurpose } from './template-contracts';
import { lockGrants, lockTemplates } from './template-locks';
import { versionConflict } from './template-mapping.service';
import { TemplatePolicyService } from './template-policy.service';

type Tx = Prisma.TransactionClient;

function unusable(code: string): HttpException {
  return new HttpException(
    {
      code,
      message:
        'O template precisa estar aprovado, com formato suportado e variáveis configuradas.',
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/**
 * Admin-only grants and purpose defaults. Version 0 means "no record yet"; every
 * effective change increments the version and is audited in the same transaction, and a
 * stale expected version is a conflict. Company preferences never grant access.
 */
@Injectable()
export class CompanyTemplateAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TemplatePolicyService,
  ) {}

  async setGrant(
    companyId: string,
    templateId: string,
    enabled: boolean,
    expectedVersion: number,
    actorUserId: string,
  ): Promise<{ version: number }> {
    return this.run(async (tx) => {
      await this.assertCompany(tx, companyId);
      await lockTemplates(tx, [templateId], 'SHARE');
      const template = await tx.globalMessageTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, origin: true },
      });
      if (!template || template.origin !== 'META_IMPORTED')
        throw new NotFoundException('Template não encontrado.');
      await tx.companyWhatsappTemplateGrant.createMany({
        data: { companyId, templateId },
        skipDuplicates: true,
      });
      await lockGrants(tx, companyId, [templateId]);
      const grant = await tx.companyWhatsappTemplateGrant.findUniqueOrThrow({
        where: { companyId_templateId: { companyId, templateId } },
      });
      if (grant.version !== expectedVersion) throw versionConflict();
      if (grant.enabled === enabled) return { version: grant.version };
      // Granting needs a usable template; revoking is always allowed.
      if (enabled) {
        const readiness = await this.policy.readiness(tx, templateId);
        if (!readiness.ready) throw unusable(readiness.code);
      }
      const now = new Date();
      const updated = await tx.companyWhatsappTemplateGrant.update({
        where: { id: grant.id },
        data: {
          enabled,
          version: { increment: 1 },
          ...(enabled
            ? { grantedAt: now, grantedByUserId: actorUserId }
            : { revokedAt: now, revokedByUserId: actorUserId }),
        },
        select: { version: true },
      });
      await tx.whatsappTemplateAudit.create({
        data: {
          companyId,
          templateId,
          actorUserId,
          action: enabled ? 'GRANT_ENABLED' : 'GRANT_REVOKED',
          details: { fromVersion: grant.version, toVersion: updated.version },
        },
      });
      return { version: updated.version };
    });
  }

  async setDefault(
    companyId: string,
    purpose: TemplatePurpose,
    templateId: string | null,
    expectedVersion: number,
    actorUserId: string,
  ): Promise<{ version: number }> {
    return this.run(async (tx) => {
      await this.assertCompany(tx, companyId);
      if (templateId) {
        await lockTemplates(tx, [templateId], 'SHARE');
        await lockGrants(tx, companyId, [templateId], 'SHARE');
      }
      await tx.companyWhatsappTemplateDefault.createMany({
        data: { companyId, purpose: purpose as WhatsappTemplatePurpose },
        skipDuplicates: true,
      });
      const [row] = await tx.$queryRaw<
        Array<{ id: string; templateId: string | null; version: number }>
      >`
        SELECT "id", "templateId", "version" FROM "CompanyWhatsappTemplateDefault"
        WHERE "companyId" = ${companyId} AND "purpose" = ${purpose}::"WhatsappTemplatePurpose"
        FOR UPDATE`;
      if (!row || row.version !== expectedVersion) throw versionConflict();
      if (row.templateId === templateId) return { version: row.version };
      if (templateId) {
        // A default must be granted to this same company and usable right now.
        const decision = await this.policy.evaluate(tx, companyId, templateId);
        if (!decision.allowed) throw unusable(decision.code);
      }
      const updated = await tx.companyWhatsappTemplateDefault.update({
        where: { id: row.id },
        data: {
          templateId,
          version: { increment: 1 },
          updatedByUserId: actorUserId,
        },
        select: { version: true },
      });
      await tx.whatsappTemplateAudit.create({
        data: {
          companyId,
          templateId,
          actorUserId,
          action: 'DEFAULT_CHANGED',
          details: {
            purpose,
            previousTemplateId: row.templateId,
            fromVersion: row.version,
            toVersion: updated.version,
          },
        },
      });
      return { version: updated.version };
    });
  }

  private async assertCompany(tx: Tx, companyId: string): Promise<void> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
  }

  private async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw versionConflict();
      throw error;
    }
  }
}
