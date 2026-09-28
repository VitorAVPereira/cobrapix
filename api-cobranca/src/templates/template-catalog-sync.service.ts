import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Prisma, WhatsAppTemplateCategory } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_TRANSPORT } from '../whatsapp/transport/whatsapp-transport';
import type {
  TemplateStatus,
  WhatsappTransport,
} from '../whatsapp/transport/whatsapp-transport';
import { WhatsappTransportError } from '../whatsapp/transport/whatsapp-transport.error';
import {
  parseTemplate,
  paymentPageBaseUrl,
  templateFingerprint,
} from './template-components';
import {
  isEligibleStatus,
  PROVIDER_STATUSES,
  requestTemplateSync,
} from './template-provider-state';

export type CatalogSyncReason = 'MANUAL' | 'PERIODIC' | 'EVENT';

export interface CatalogSyncResult {
  imported: number;
  updated: number;
  unavailable: number;
  completed: boolean;
  /** Items without the identity required to import them. */
  incomplete: number;
  /** Rows changed by an event during the scan; re-read later, restriction kept. */
  conflicts: number;
}

const LEASE_MS = 120_000;
const MAX_PAGES = 100;
export const PERIODIC_SYNC_MS = 15 * 60_000;
const CATEGORIES: readonly string[] = Object.values(WhatsAppTemplateCategory);

interface ProviderItem {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: unknown;
  parameterFormat: string | null;
  quality: string | null;
  rejectedReason: string | null;
}

interface Captured {
  id: string;
  stateVersion: number;
  metaStatus: string;
  providerFingerprint: string | null;
  supportReason: string | null;
  archivedAt: Date | null;
  mappingRevision: number;
}

class LeaseLostError extends Error {
  constructor() {
    super('TEMPLATE_SYNC_LEASE_LOST');
  }
}

/**
 * Local catalog of the shared WABA, read only through Datafy. Importing never grants,
 * picks defaults or resumes held messages; a failed or partial scan never removes rows.
 */
@Injectable()
export class TemplateCatalogSyncService {
  private readonly logger = new Logger(TemplateCatalogSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(WHATSAPP_TRANSPORT) private readonly transport: WhatsappTransport,
  ) {}

  requestSync(
    tx: Prisma.TransactionClient,
    providerAccountId: string,
  ): Promise<void> {
    return requestTemplateSync(tx, providerAccountId);
  }

  async sync(reason: CatalogSyncReason): Promise<CatalogSyncResult> {
    // /me proves the token belongs to the configured number and WABA before any import.
    const channel = await this.transport.getChannelInfo();
    const waba = channel.businessAccountId;
    const startedAt = new Date();
    const lease = await this.acquire(waba, startedAt);
    if (!lease)
      throw new ConflictException({
        code: 'TEMPLATE_SYNC_IN_PROGRESS',
        message: 'Uma sincronização do catálogo já está em andamento.',
      });
    const result: CatalogSyncResult = {
      imported: 0,
      updated: 0,
      unavailable: 0,
      completed: false,
      incomplete: 0,
      conflicts: 0,
    };
    let errorCode: string | null = null;
    try {
      const captured = await this.capture(waba);
      let items: ProviderItem[] = [];
      let complete = false;
      try {
        items = await this.scan(waba, lease, result);
        complete = true;
      } catch (error: unknown) {
        if (error instanceof LeaseLostError) throw error;
        errorCode = this.errorCode(error);
      }
      await this.applyItems(waba, captured, items, result);
      if (complete) {
        const seen = new Set(items.map((item) => item.id));
        await this.markAbsent(waba, lease, captured, seen, result);
        result.completed = true;
      }
      if (result.conflicts) await requestTemplateSync(this.prisma, waba);
    } catch (error: unknown) {
      errorCode ??= this.errorCode(error);
    } finally {
      await this.finish(waba, lease, startedAt, result, errorCode, reason);
    }
    this.logger.log(
      `TEMPLATE_SYNC ${reason} completed=${result.completed} imported=${result.imported} updated=${result.updated} unavailable=${result.unavailable}${errorCode ? ` error=${errorCode}` : ''}`,
    );
    return result;
  }

  @Interval(PERIODIC_SYNC_MS)
  async periodic(): Promise<void> {
    await this.runSafely('PERIODIC');
  }

  /** Durable requests from webhooks (unknown templates, partial events, conflicts). */
  @Interval(10_000)
  async requested(): Promise<void> {
    const waba = this.configuredAccount();
    if (!waba) return;
    const state = await this.prisma.whatsappTemplateSyncState.findUnique({
      where: { providerAccountId: waba },
      select: { syncRequestedAt: true, leaseExpiresAt: true },
    });
    if (
      !state?.syncRequestedAt ||
      (state.leaseExpiresAt && state.leaseExpiresAt > new Date())
    )
      return;
    await this.runSafely('EVENT');
  }

  private async runSafely(reason: CatalogSyncReason): Promise<void> {
    if (this.running || !this.configuredAccount()) return;
    this.running = true;
    try {
      await this.sync(reason);
    } catch (error: unknown) {
      this.logger.warn(`TEMPLATE_SYNC_DEFERRED ${this.errorCode(error)}`);
    } finally {
      this.running = false;
    }
  }

  private configuredAccount(): string | null {
    const waba = this.config.get<string>('META_BUSINESS_ACCOUNT_ID')?.trim();
    return waba &&
      /^\d{1,64}$/.test(waba) &&
      this.config.get<string>('DATAFY_API_TOKEN')?.trim()
      ? waba
      : null;
  }

  private async acquire(waba: string, now: Date): Promise<string | null> {
    await this.prisma.whatsappTemplateSyncState.createMany({
      data: { providerAccountId: waba },
      skipDuplicates: true,
    });
    const token = randomUUID();
    const claim = await this.prisma.whatsappTemplateSyncState.updateMany({
      where: {
        providerAccountId: waba,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        lastStartedAt: now,
      },
    });
    return claim.count ? token : null;
  }

  private async renew(waba: string, lease: string): Promise<void> {
    const renewed = await this.prisma.whatsappTemplateSyncState.updateMany({
      where: {
        providerAccountId: waba,
        leaseToken: lease,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    });
    if (!renewed.count) throw new LeaseLostError();
  }

  /** Versions of every imported row of this WABA, captured before the provider query. */
  private async capture(waba: string): Promise<Map<string, Captured>> {
    const rows = await this.prisma.globalMessageTemplate.findMany({
      where: { origin: 'META_IMPORTED', providerAccountId: waba },
      select: {
        id: true,
        metaTemplateId: true,
        stateVersion: true,
        metaStatus: true,
        providerFingerprint: true,
        supportReason: true,
        archivedAt: true,
        mappingRevision: true,
      },
    });
    return new Map(
      rows.map(({ metaTemplateId, ...row }) => [metaTemplateId as string, row]),
    );
  }

  /** Cursor pagination on the Datafy host only; paging.next is never followed. */
  private async scan(
    waba: string,
    lease: string,
    result: CatalogSyncResult,
  ): Promise<ProviderItem[]> {
    const items: ProviderItem[] = [];
    const cursors = new Set<string>();
    let after: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error('TEMPLATE_PAGINATION_LIMIT');
      const response = await this.transport.listTemplates(after);
      for (const raw of response.data) {
        const item = this.normalize(raw);
        if (item) items.push(item);
        else result.incomplete++;
      }
      await this.renew(waba, lease);
      after = response.after;
      if (!after) return items;
      if (cursors.has(after)) throw new Error('TEMPLATE_PAGINATION_INVALID');
      cursors.add(after);
    }
  }

  private normalize(raw: TemplateStatus): ProviderItem | null {
    const text = (value: unknown, max = 512): string | null =>
      typeof value === 'string' && value.trim() && value.length <= max
        ? value.trim()
        : null;
    const id = text(raw.id, 64);
    const name = text(raw.name);
    const language = text(raw.language, 16);
    const status = text(raw.status, 32);
    if (!id || !/^\d+$/.test(id) || !name || !language || !status) return null;
    return {
      id,
      name,
      language,
      status: status.toUpperCase(),
      category: (text(raw.category, 32) ?? 'UNKNOWN').toUpperCase(),
      components: raw.components ?? null,
      parameterFormat: text(raw.parameter_format, 32),
      quality: text(raw.quality_score, 32),
      rejectedReason:
        raw.rejected_reason && raw.rejected_reason.toUpperCase() !== 'NONE'
          ? raw.rejected_reason.slice(0, 1000)
          : null,
    };
  }

  private classify(item: ProviderItem): {
    fingerprint: string;
    supportReason: string | null;
    body: string;
    paymentButton: boolean;
  } {
    const input = {
      components: item.components,
      parameterFormat: item.parameterFormat,
      language: item.language,
      category: item.category,
      paymentBaseUrl: paymentPageBaseUrl(
        this.config.get<string>('FRONTEND_URL'),
      ),
    };
    const parsed = parseTemplate(input);
    const supportReason = !CATEGORIES.includes(item.category)
      ? `Categoria ${item.category} não suportada.`
      : parsed.supported
        ? null
        : parsed.reason;
    const bodyPart = Array.isArray(item.components)
      ? (item.components as unknown[]).find(
          (part): part is { text: string } =>
            typeof part === 'object' &&
            part !== null &&
            String((part as Record<string, unknown>).type).toUpperCase() ===
              'BODY' &&
            typeof (part as Record<string, unknown>).text === 'string',
        )
      : undefined;
    return {
      fingerprint: templateFingerprint(input),
      supportReason,
      body: parsed.supported ? parsed.template.body : (bodyPart?.text ?? ''),
      paymentButton: parsed.supported && Boolean(parsed.template.paymentButton),
    };
  }

  private async applyItems(
    waba: string,
    captured: Map<string, Captured>,
    items: ProviderItem[],
    result: CatalogSyncResult,
  ): Promise<void> {
    const now = new Date();
    for (const item of items) {
      const local = captured.get(item.id);
      const status = (PROVIDER_STATUSES as readonly string[]).includes(
        item.status,
      )
        ? item.status
        : 'UNKNOWN';
      const facts = this.classify(item);
      const common = {
        name: item.name.slice(0, 512),
        metaTemplateName: item.name,
        metaLanguage: item.language,
        metaStatus: status,
        metaProviderCategory: item.category,
        metaQuality: item.quality,
        metaRejectedReason: item.rejectedReason,
        metaComponents: (item.components ?? []) as Prisma.InputJsonValue,
        parameterFormat: item.parameterFormat,
        providerFingerprint: facts.fingerprint,
        supportReason: facts.supportReason,
        content: facts.body,
        paymentButtonEnabled: facts.paymentButton,
        copyCodeButtonEnabled: false,
        ...(CATEGORIES.includes(item.category)
          ? { category: item.category as WhatsAppTemplateCategory }
          : {}),
        lastMetaSyncAt: now,
      };
      if (!local) {
        // Only approved templates are imported; later states are tracked once known.
        if (!isEligibleStatus(status)) continue;
        try {
          await this.prisma.$transaction(async (tx) => {
            const created = await tx.globalMessageTemplate.create({
              data: {
                ...common,
                slug: `meta-${waba}-${item.id}`,
                origin: 'META_IMPORTED',
                providerAccountId: waba,
                metaTemplateId: item.id,
                providerRevision: 1,
                policyVersion: 1,
                stateVersion: 1,
                isActive: true,
              },
              select: { id: true },
            });
            await tx.whatsappTemplateAudit.create({
              data: {
                templateId: created.id,
                action: 'CATALOG_IMPORTED',
                details: {
                  providerRevision: 1,
                  supported: !facts.supportReason,
                },
              },
            });
          });
          result.imported++;
        } catch (error: unknown) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          )
            result.conflicts++;
          else throw error;
        }
        continue;
      }
      const contentChanged = local.providerFingerprint !== facts.fingerprint;
      const eligibilityChanged =
        isEligibleStatus(local.metaStatus) !== isEligibleStatus(status) ||
        local.supportReason !== facts.supportReason ||
        local.archivedAt !== null;
      const changed = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.globalMessageTemplate.updateMany({
          // Never over a row an event changed after the capture.
          where: { id: local.id, stateVersion: local.stateVersion },
          data: {
            ...common,
            archivedAt: null,
            stateVersion: { increment: 1 },
            ...(contentChanged
              ? {
                  providerRevision: { increment: 1 },
                  ...(local.mappingRevision > 0
                    ? { metaReviewRequired: true }
                    : {}),
                }
              : {}),
            ...(contentChanged || eligibilityChanged
              ? { policyVersion: { increment: 1 } }
              : {}),
          },
        });
        if (updated.count && (contentChanged || eligibilityChanged))
          await tx.whatsappTemplateAudit.create({
            data: {
              templateId: local.id,
              action: contentChanged ? 'CONTENT_CHANGED' : 'STATUS_CHANGED',
              details: { status, supported: !facts.supportReason },
            },
          });
        return updated.count;
      });
      if (changed) result.updated++;
      else result.conflicts++;
    }
  }

  /** Only a complete scan still owning the lease may conclude that a template disappeared. */
  private async markAbsent(
    waba: string,
    lease: string,
    captured: Map<string, Captured>,
    seen: Set<string>,
    result: CatalogSyncResult,
  ): Promise<void> {
    const missing = [...captured.entries()].filter(
      ([providerId, row]) => !seen.has(providerId) && !row.archivedAt,
    );
    if (!missing.length) return;
    await this.prisma.$transaction(async (tx) => {
      const [owned] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "WhatsappTemplateSyncState"
        WHERE "providerAccountId" = ${waba} AND "leaseToken" = ${lease}
          AND "leaseExpiresAt" > NOW()
        FOR UPDATE`;
      if (!owned) throw new LeaseLostError();
      for (const [, row] of missing) {
        const archived = await tx.globalMessageTemplate.updateMany({
          where: {
            id: row.id,
            stateVersion: row.stateVersion,
            archivedAt: null,
          },
          data: {
            archivedAt: new Date(),
            metaStatus: 'DELETED',
            stateVersion: { increment: 1 },
            policyVersion: { increment: 1 },
          },
        });
        if (!archived.count) {
          result.conflicts++;
          continue;
        }
        await tx.whatsappTemplateAudit.create({
          data: {
            templateId: row.id,
            action: 'PROVIDER_ABSENT',
            details: { reason: 'COMPLETE_SCAN' },
          },
        });
        result.unavailable++;
      }
    });
  }

  private async finish(
    waba: string,
    lease: string,
    startedAt: Date,
    result: CatalogSyncResult,
    errorCode: string | null,
    reason: CatalogSyncReason,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.whatsappTemplateSyncState.updateMany({
        where: { providerAccountId: waba, leaseToken: lease },
        data: {
          leaseToken: null,
          leaseExpiresAt: null,
          lastResult: { ...result, reason } as unknown as Prisma.InputJsonValue,
          ...(result.completed
            ? { lastCompletedAt: now, lastErrorCode: null }
            : {
                lastErrorCode: errorCode ?? 'SYNC_INCOMPLETE',
                lastErrorAt: now,
              }),
        },
      });
      // A request that arrived during this scan is kept for the next one.
      if (result.completed && !result.conflicts)
        await tx.whatsappTemplateSyncState.updateMany({
          where: {
            providerAccountId: waba,
            syncRequestedAt: { lte: startedAt },
          },
          data: { syncRequestedAt: null },
        });
    });
  }

  private errorCode(error: unknown): string {
    if (error instanceof LeaseLostError) return error.message;
    if (error instanceof WhatsappTransportError)
      return error.reasonCode ?? `PROVIDER_${error.kind}`;
    if (error instanceof Error && /^[A-Z][A-Z_]{2,63}$/.test(error.message))
      return error.message;
    return 'SYNC_FAILED';
  }
}
