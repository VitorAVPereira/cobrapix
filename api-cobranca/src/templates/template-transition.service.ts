import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { TemplatePendingService } from '../communications/template-pending.service';
import { legacyTemplateRequest } from './template-selection';

/** Migrations of this feature, in order; `apply` and `verify` need all of them. */
export const TRANSITION_MIGRATIONS = [
  '20260927140000_collection_rule_email_templates',
  '20260927150000_whatsapp_template_catalog_access',
  '20260927160000_whatsapp_template_pending_sends',
  '20260927170000_whatsapp_rule_selection',
] as const;

/** Schema the preflight expects to find before the new migrations. */
export const BASE_MIGRATION =
  '20260927130000_collection_rules_global_templates';

export interface PreflightReport {
  canApply: boolean;
  blockers: string[];
  counts: Record<string, number>;
}

export interface ApplyReport {
  archivedTemplates: number;
  unconfiguredSteps: number;
  blockedSends: number;
  failedWithoutCompany: number;
  preservedUncertain: number;
  preservedAccepted: number;
  unreadablePayloads: number;
}

export interface VerifyReport {
  ok: boolean;
  violations: string[];
  counts: Record<string, number>;
}

type CountRow = { count: bigint | number };

const BATCH = 100;

/**
 * Operational transition from the internal WhatsApp catalog to the imported one.
 * `preflight` only reads (and works on the schema before the new migrations);
 * `apply` archives the internal catalog, leaves legacy rule choices unconfigured and turns
 * intents that provably never reached the provider into holds; `verify` only reads.
 * Nothing grants, picks a default, deletes history or touches accepted, uncertain or
 * in-flight sends; repeating `apply` changes nothing.
 */
@Injectable()
export class TemplateTransitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly pending: TemplatePendingService,
  ) {}

  async preflight(): Promise<PreflightReport> {
    const blockers: string[] = [];
    const applied = await this.appliedMigrations();
    const pendingMigrations = TRANSITION_MIGRATIONS.filter(
      (name) => !applied.has(name),
    );
    if (!applied.has(BASE_MIGRATION))
      blockers.push(
        `Migration anterior ${BASE_MIGRATION} ausente: publique a versão anterior antes desta.`,
      );
    const origin = await this.hasColumn('GlobalMessageTemplate', 'origin');
    const emailColumn = await this.hasColumn(
      'CollectionRuleStep',
      'emailTemplateId',
    );

    // Same condition that aborts the email migration, reported ahead with the step IDs.
    if (!emailColumn) {
      const unmapped = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; slug: string | null }>
      >(`
        SELECT step."id", catalog."slug"
        FROM "CollectionRuleStep" step
        LEFT JOIN "GlobalMessageTemplate" catalog ON catalog."id" = step."templateId"
        LEFT JOIN "GlobalEmailTemplate" email ON email."slug" = catalog."slug"
        WHERE step."channel" = 'EMAIL'
          AND step."templateId" IS NOT NULL
          AND (catalog."id" IS NULL OR NOT catalog."isActive" OR email."id" IS NULL OR NOT email."isActive")
        ORDER BY step."id"`);
      if (unmapped.length)
        blockers.push(
          `Etapas EMAIL sem template de e-mail correspondente: ${unmapped
            .map((row) => `${row.id} (${row.slug ?? 'sem template'})`)
            .join(
              ', ',
            )}. Prepare o catálogo de e-mail (GET /email/templates na API anterior) e revise os vínculos.`,
        );
    }

    const sending = await this.count(`
      SELECT count(*) FROM "CommunicationOutboundIntent" WHERE "state" = 'SENDING'`);
    if (sending)
      blockers.push(
        `${sending} envio(s) em andamento: pause o canal e aguarde a conclusão ou a triagem do lease.`,
      );

    const counts: Record<string, number> = {
      pendingMigrations: pendingMigrations.length,
      legacyWhatsappTemplatesActive: await this.count(
        origin
          ? `SELECT count(*) FROM "GlobalMessageTemplate" WHERE "origin" = 'LEGACY_INTERNAL' AND ("archivedAt" IS NULL OR "isActive")`
          : `SELECT count(*) FROM "GlobalMessageTemplate" WHERE "isActive"`,
      ),
      whatsappSteps: await this.count(
        `SELECT count(*) FROM "CollectionRuleStep" WHERE "channel" = 'WHATSAPP'`,
      ),
      emailSteps: await this.count(
        `SELECT count(*) FROM "CollectionRuleStep" WHERE "channel" = 'EMAIL'`,
      ),
      emailStepsToConvert: emailColumn
        ? 0
        : await this.count(
            `SELECT count(*) FROM "CollectionRuleStep" WHERE "channel" = 'EMAIL' AND "templateId" IS NOT NULL`,
          ),
      intentsPending: await this.intentCount('PENDING'),
      intentsSending: sending,
      intentsAccepted: await this.intentCount('ACCEPTED'),
      intentsUncertain: await this.intentCount('UNCERTAIN'),
    };
    if (await this.hasTable('CompanyWhatsappTemplateGrant'))
      counts.grants = await this.count(
        `SELECT count(*) FROM "CompanyWhatsappTemplateGrant"`,
      );
    if (await this.hasTable('WhatsappTemplatePendingSend'))
      counts.holdsBlocked = await this.count(
        `SELECT count(*) FROM "WhatsappTemplatePendingSend" WHERE "state" = 'BLOCKED'`,
      );
    return { canApply: blockers.length === 0, blockers, counts };
  }

  async apply(): Promise<ApplyReport> {
    await this.requireMigrations();
    const channel = await this.prisma.platformIntegrationState.findUnique({
      where: { integration: 'META' },
      select: { enabled: true },
    });
    if (channel?.enabled !== false)
      throw new Error(
        'Pause o canal WhatsApp (integração META) antes de aplicar a transição.',
      );
    const sending = await this.prisma.communicationOutboundIntent.count({
      where: { state: 'SENDING' },
    });
    if (sending)
      throw new Error(
        `${sending} envio(s) em andamento: aguarde a conclusão ou a triagem do lease.`,
      );

    const report: ApplyReport = {
      archivedTemplates: 0,
      unconfiguredSteps: 0,
      blockedSends: 0,
      failedWithoutCompany: 0,
      preservedUncertain: 0,
      preservedAccepted: 0,
      unreadablePayloads: 0,
    };

    await this.prisma.$transaction(async (tx) => {
      const legacy = await tx.globalMessageTemplate.findMany({
        where: {
          origin: 'LEGACY_INTERNAL',
          OR: [{ archivedAt: null }, { isActive: true }],
        },
        select: { id: true, archivedAt: true },
      });
      const now = new Date();
      for (const template of legacy) {
        await tx.globalMessageTemplate.update({
          where: { id: template.id },
          data: {
            isActive: false,
            archivedAt: template.archivedAt ?? now,
            policyVersion: { increment: 1 },
            stateVersion: { increment: 1 },
          },
        });
        await tx.whatsappTemplateAudit.create({
          data: {
            templateId: template.id,
            action: 'LEGACY_ARCHIVED',
            details: { reason: 'TRANSITION' },
          },
        });
      }
      report.archivedTemplates = legacy.length;
      // A legacy explicit choice keeps its reference for history but sends nothing.
      const steps = await tx.collectionRuleStep.updateMany({
        where: {
          channel: 'WHATSAPP',
          whatsappSelectionMode: 'EXPLICIT',
          template: { origin: 'LEGACY_INTERNAL' },
        },
        data: { whatsappSelectionMode: 'UNCONFIGURED' },
      });
      report.unconfiguredSteps = steps.count;
    });

    // Template intents prepared by the old code and never claimed become holds.
    let cursor: string | undefined;
    for (;;) {
      const intents = await this.prisma.communicationOutboundIntent.findMany({
        where: {
          state: 'PENDING',
          templateSnapshot: { equals: Prisma.DbNull },
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!intents.length) break;
      cursor = intents.at(-1)!.id;
      for (const intent of intents) {
        const payload = this.payload(intent.payloadEncrypted);
        if (!payload) {
          report.unreadablePayloads++;
          continue;
        }
        if (payload.messageType !== 'template') continue;
        if (!intent.companyId) {
          const failed =
            await this.prisma.communicationOutboundIntent.updateMany({
              where: { id: intent.id, state: 'PENDING' },
              data: { state: 'FAILED', lastErrorCode: 'LEGACY_PAYLOAD' },
            });
          report.failedWithoutCompany += failed.count;
          continue;
        }
        const request = legacyTemplateRequest(
          { ...intent, companyId: intent.companyId },
          payload,
        );
        const blocked = await this.prisma.$transaction(async (tx) => {
          await this.pending.block(tx, {
            request,
            code: 'LEGACY_PAYLOAD',
            intentId: intent.id,
          });
          const after = await tx.communicationOutboundIntent.findUnique({
            where: { id: intent.id },
            select: { state: true },
          });
          return after?.state === 'BLOCKED';
        });
        if (blocked) report.blockedSends++;
      }
    }

    report.preservedUncertain =
      await this.prisma.communicationOutboundIntent.count({
        where: { state: 'UNCERTAIN' },
      });
    report.preservedAccepted =
      await this.prisma.communicationOutboundIntent.count({
        where: { state: 'ACCEPTED' },
      });
    await this.prisma.whatsappTemplateAudit.create({
      data: {
        action: 'TRANSITION_APPLIED',
        details: { ...report },
      },
    });
    return report;
  }

  async verify(): Promise<VerifyReport> {
    const violations: string[] = [];
    const applied = await this.appliedMigrations();
    const missing = TRANSITION_MIGRATIONS.filter((name) => !applied.has(name));
    if (missing.length) {
      violations.push(`Migrations pendentes: ${missing.join(', ')}.`);
      return { ok: false, violations, counts: {} };
    }
    const counts: Record<string, number> = {
      activeLegacyWhatsappTemplates:
        await this.prisma.globalMessageTemplate.count({
          where: {
            origin: 'LEGACY_INTERNAL',
            OR: [{ archivedAt: null }, { isActive: true }],
          },
        }),
      legacyExplicitSteps: await this.prisma.collectionRuleStep.count({
        where: {
          whatsappSelectionMode: 'EXPLICIT',
          template: { origin: 'LEGACY_INTERNAL' },
        },
      }),
      emailStepsWithWhatsappTemplate:
        await this.prisma.collectionRuleStep.count({
          where: { channel: 'EMAIL', templateId: { not: null } },
        }),
      // Grants exist only through an audited admin action.
      automaticGrants: await this.count(`
        SELECT count(*) FROM "CompanyWhatsappTemplateGrant" grant_row
        WHERE NOT EXISTS (
          SELECT 1 FROM "WhatsappTemplateAudit" audit
          WHERE audit."companyId" = grant_row."companyId"
            AND audit."templateId" = grant_row."templateId"
            AND audit."action" IN ('GRANT_ENABLED', 'GRANT_REVOKED')
            AND audit."actorUserId" IS NOT NULL)`),
      legacyTemplateIntentsPending: await this.legacyPendingTemplateIntents(),
      intentsSending: await this.prisma.communicationOutboundIntent.count({
        where: { state: 'SENDING' },
      }),
      intentsAccepted: await this.prisma.communicationOutboundIntent.count({
        where: { state: 'ACCEPTED' },
      }),
      intentsUncertain: await this.prisma.communicationOutboundIntent.count({
        where: { state: 'UNCERTAIN' },
      }),
      holdsBlocked: await this.prisma.whatsappTemplatePendingSend.count({
        where: { state: 'BLOCKED' },
      }),
    };
    if (counts.activeLegacyWhatsappTemplates)
      violations.push('Há templates internos ativos.');
    if (counts.legacyExplicitSteps)
      violations.push(
        'Há etapas apontando explicitamente para templates internos.',
      );
    if (counts.emailStepsWithWhatsappTemplate)
      violations.push('Há etapas EMAIL com template WhatsApp.');
    if (counts.automaticGrants)
      violations.push('Há liberações sem ação administrativa auditada.');
    if (counts.legacyTemplateIntentsPending)
      violations.push(
        'Há intenções de template antigas que ainda poderiam ser enviadas.',
      );
    return { ok: violations.length === 0, violations, counts };
  }

  private async legacyPendingTemplateIntents(): Promise<number> {
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const intents = await this.prisma.communicationOutboundIntent.findMany({
        where: {
          state: 'PENDING',
          templateSnapshot: { equals: Prisma.DbNull },
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, payloadEncrypted: true },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!intents.length) return total;
      cursor = intents.at(-1)!.id;
      total += intents.filter(
        (intent) =>
          this.payload(intent.payloadEncrypted)?.messageType === 'template',
      ).length;
    }
  }

  private payload(encrypted: string | null): {
    messageType?: string;
    origin?: string;
    invoiceId?: string;
    ruleStepId?: string;
  } | null {
    if (!encrypted) return null;
    try {
      return JSON.parse(this.crypto.decrypt(encrypted)) as {
        messageType?: string;
      };
    } catch {
      return null;
    }
  }

  private async requireMigrations(): Promise<void> {
    const applied = await this.appliedMigrations();
    const missing = TRANSITION_MIGRATIONS.filter((name) => !applied.has(name));
    if (missing.length)
      throw new Error(
        `Aplique as migrations antes da transição: ${missing.join(', ')}.`,
      );
  }

  private async appliedMigrations(): Promise<Set<string>> {
    if (!(await this.hasTable('_prisma_migrations'))) return new Set();
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ migration_name: string }>
    >(
      `SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
    );
    return new Set(rows.map((row) => row.migration_name));
  }

  private async hasTable(table: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<CountRow[]>`
      SELECT count(*) AS count FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ${table}`;
    return Number(rows[0]?.count ?? 0) > 0;
  }

  private async hasColumn(table: string, column: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<CountRow[]>`
      SELECT count(*) AS count FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}`;
    return Number(rows[0]?.count ?? 0) > 0;
  }

  private intentCount(state: string): Promise<number> {
    return this.count(
      `SELECT count(*) FROM "CommunicationOutboundIntent" WHERE "state" = '${state}'`,
    );
  }

  private async count(sql: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<CountRow[]>(sql);
    return Number(rows[0]?.count ?? 0);
  }
}
