import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GlobalMessageTemplate,
  Prisma,
  WhatsappTemplatePurpose,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paymentPageBaseUrl, parseStoredTemplate } from './template-components';
import {
  RenderResult,
  TEMPLATE_PURPOSES,
  TemplateBlockCode,
  TemplateMapping,
  TemplatePurpose,
} from './template-contracts';
import { TemplatePolicyService } from './template-policy.service';
import { renderTemplate, syntheticValues } from './template-renderer';
import { isRecord } from '../whatsapp/transport/whatsapp-transport.error';

export type CatalogPage<T> = { items: T[]; nextCursor: string | null };

export interface TemplateContentView {
  body: string;
  footer: string | null;
  button: { label: string; url: string } | null;
}

/** What a company sees: approved content only, no mapping, grants or diagnostics. */
export interface CompanyTemplateView {
  id: string;
  name: string;
  language: string;
  category: string | null;
  content: TemplateContentView;
  defaultFor: TemplatePurpose[];
}

export interface AdminTemplateView {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  quality: string | null;
  rejectedReason: string | null;
  supported: boolean;
  supportReason: string | null;
  reviewRequired: boolean;
  archivedAt: Date | null;
  providerRevision: number;
  mappingRevision: number;
  policyVersion: number;
  readiness: { ready: boolean; code: TemplateBlockCode | null };
  positions: number[];
  content: TemplateContentView;
  mapping: TemplateMapping | null;
  grantedCompanies: number;
  lastSyncAt: Date | null;
}

export type AdminCatalogQuery = {
  status?: 'APPROVED' | 'UNAVAILABLE' | 'ALL';
  supported?: boolean;
  cursor?: string;
  limit?: number;
};

@Injectable()
export class TemplateCatalogQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly policy: TemplatePolicyService,
  ) {}

  async adminCatalog(
    query: AdminCatalogQuery,
  ): Promise<CatalogPage<AdminTemplateView>> {
    const limit = query.limit ?? 25;
    const status = query.status ?? 'APPROVED';
    const where: Prisma.GlobalMessageTemplateWhereInput = {
      origin: 'META_IMPORTED',
      ...(status === 'APPROVED'
        ? { metaStatus: 'APPROVED', archivedAt: null }
        : status === 'UNAVAILABLE'
          ? {
              OR: [
                { metaStatus: { not: 'APPROVED' } },
                { archivedAt: { not: null } },
              ],
            }
          : {}),
      ...(query.supported === undefined
        ? {}
        : query.supported
          ? { supportReason: null }
          : { supportReason: { not: null } }),
    };
    const rows = await this.prisma.globalMessageTemplate.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        _count: { select: { grants: { where: { enabled: true } } } },
      },
    });
    const page = rows.slice(0, limit);
    const items: AdminTemplateView[] = [];
    for (const row of page) items.push(await this.adminView(row));
    return {
      items,
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async adminTemplate(id: string): Promise<AdminTemplateView> {
    const row = await this.prisma.globalMessageTemplate.findFirst({
      where: { id, origin: 'META_IMPORTED' },
      include: {
        _count: { select: { grants: { where: { enabled: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Template não encontrado.');
    return this.adminView(row);
  }

  async syncState(): Promise<{
    providerAccountId: string | null;
    lastCompletedAt: Date | null;
    lastStartedAt: Date | null;
    lastErrorCode: string | null;
    lastErrorAt: Date | null;
    running: boolean;
    pendingRequest: boolean;
  }> {
    const waba = this.config.get<string>('META_BUSINESS_ACCOUNT_ID') ?? null;
    const state = waba
      ? await this.prisma.whatsappTemplateSyncState.findUnique({
          where: { providerAccountId: waba },
        })
      : null;
    return {
      providerAccountId: waba,
      lastCompletedAt: state?.lastCompletedAt ?? null,
      lastStartedAt: state?.lastStartedAt ?? null,
      lastErrorCode: state?.lastErrorCode ?? null,
      lastErrorAt: state?.lastErrorAt ?? null,
      running: Boolean(
        state?.leaseExpiresAt && state.leaseExpiresAt > new Date(),
      ),
      pendingRequest: Boolean(state?.syncRequestedAt),
    };
  }

  /** Grants, defaults and effective availability of one company (admin only). */
  async companyAccess(companyId: string): Promise<{
    companyId: string;
    grants: Array<{
      templateId: string;
      templateName: string;
      language: string;
      enabled: boolean;
      version: number;
      available: { ready: boolean; code: TemplateBlockCode | null };
    }>;
    defaults: Array<{
      purpose: TemplatePurpose;
      templateId: string | null;
      templateName: string | null;
      version: number;
      available: { ready: boolean; code: TemplateBlockCode | null };
    }>;
  }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const [grants, defaults] = await Promise.all([
      this.prisma.companyWhatsappTemplateGrant.findMany({
        where: { companyId },
        include: {
          template: {
            select: { metaTemplateName: true, name: true, metaLanguage: true },
          },
        },
        orderBy: { templateId: 'asc' },
      }),
      this.prisma.companyWhatsappTemplateDefault.findMany({
        where: { companyId },
        include: {
          template: { select: { metaTemplateName: true, name: true } },
        },
      }),
    ]);
    const decide = async (
      selection: Parameters<TemplatePolicyService['resolve']>[2],
    ) => {
      const decision = await this.prisma.$transaction((tx) =>
        this.policy.resolve(tx, companyId, selection),
      );
      return decision.allowed
        ? { ready: true, code: null }
        : { ready: false, code: decision.code };
    };
    const byPurpose = new Map(defaults.map((row) => [row.purpose, row]));
    return {
      companyId,
      grants: await Promise.all(
        grants.map(async (grant) => ({
          templateId: grant.templateId,
          templateName: grant.template.metaTemplateName ?? grant.template.name,
          language: grant.template.metaLanguage,
          enabled: grant.enabled,
          version: grant.version,
          available: await decide({
            mode: 'EXPLICIT',
            templateId: grant.templateId,
          }),
        })),
      ),
      defaults: await Promise.all(
        TEMPLATE_PURPOSES.map(async (purpose) => {
          const row = byPurpose.get(purpose as WhatsappTemplatePurpose);
          return {
            purpose,
            templateId: row?.templateId ?? null,
            templateName: row?.template
              ? (row.template.metaTemplateName ?? row.template.name)
              : null,
            version: row?.version ?? 0,
            available: await decide({ mode: 'DEFAULT', purpose }),
          };
        }),
      ),
    };
  }

  /** Templates the authenticated company may choose now; nothing else is revealed. */
  async companyCatalog(
    companyId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<CatalogPage<CompanyTemplateView>> {
    const limit = query.limit ?? 25;
    // Grants of one company are few (one shared WABA); filter first, then paginate.
    const grants = await this.prisma.companyWhatsappTemplateGrant.findMany({
      where: { companyId, enabled: true },
      orderBy: { templateId: 'asc' },
      select: { templateId: true },
    });
    const available: CompanyTemplateView[] = [];
    for (const grant of grants) {
      const view = await this.companyTemplateOrNull(
        companyId,
        grant.templateId,
      );
      if (view) available.push(view);
    }
    const start = query.cursor
      ? available.findIndex((view) => view.id === query.cursor) + 1
      : 0;
    const items = available.slice(start, start + limit);
    return {
      items,
      nextCursor:
        start + limit < available.length ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async companyTemplate(
    companyId: string,
    templateId: string,
  ): Promise<CompanyTemplateView> {
    const view = await this.companyTemplateOrNull(companyId, templateId);
    // A template of another company, or not usable, is simply not found.
    if (!view) throw new NotFoundException('Template não encontrado.');
    return view;
  }

  async companyPreview(
    companyId: string,
    templateId: string,
  ): Promise<RenderResult> {
    const decision = await this.prisma.$transaction((tx) =>
      this.policy.evaluate(tx, companyId, templateId),
    );
    if (!decision.allowed)
      throw new NotFoundException('Template não encontrado.');
    const sample = syntheticValues(
      paymentPageBaseUrl(this.config.get<string>('FRONTEND_URL')),
    );
    return renderTemplate(
      decision.template.parsed,
      decision.template.mapping,
      sample.values,
      sample.paymentUrl,
    );
  }

  private async companyTemplateOrNull(
    companyId: string,
    templateId: string,
  ): Promise<CompanyTemplateView | null> {
    const decision = await this.prisma.$transaction((tx) =>
      this.policy.evaluate(tx, companyId, templateId),
    );
    if (!decision.allowed) return null;
    const [template, defaults] = await Promise.all([
      this.prisma.globalMessageTemplate.findUniqueOrThrow({
        where: { id: templateId },
        select: { metaProviderCategory: true },
      }),
      this.prisma.companyWhatsappTemplateDefault.findMany({
        where: { companyId, templateId },
        select: { purpose: true },
      }),
    ]);
    const { parsed } = decision.template;
    return {
      id: templateId,
      name: decision.template.name,
      language: decision.template.language,
      category: template.metaProviderCategory,
      content: {
        body: parsed.body,
        footer: parsed.footer,
        button: parsed.paymentButton
          ? { label: parsed.paymentButton.label, url: parsed.paymentButton.url }
          : null,
      },
      defaultFor: defaults.map((row) => row.purpose),
    };
  }

  private async adminView(
    row: GlobalMessageTemplate & { _count: { grants: number } },
  ): Promise<AdminTemplateView> {
    const parsed = parseStoredTemplate(
      row,
      this.config.get<string>('FRONTEND_URL'),
    );
    const readiness = await this.prisma.$transaction((tx) =>
      this.policy.readiness(tx, row.id),
    );
    const revision = row.mappingRevision
      ? await this.prisma.whatsappTemplateMappingRevision.findUnique({
          where: {
            templateId_revision: {
              templateId: row.id,
              revision: row.mappingRevision,
            },
          },
          select: { mapping: true },
        })
      : null;
    return {
      id: row.id,
      name: row.metaTemplateName ?? row.name,
      language: row.metaLanguage,
      category: row.metaProviderCategory,
      status: row.metaStatus,
      quality: row.metaQuality,
      rejectedReason: row.metaRejectedReason,
      supported: !row.supportReason && parsed.supported,
      supportReason: row.supportReason,
      reviewRequired: row.metaReviewRequired,
      archivedAt: row.archivedAt,
      providerRevision: row.providerRevision,
      mappingRevision: row.mappingRevision,
      policyVersion: row.policyVersion,
      readiness: readiness.ready
        ? { ready: true, code: null }
        : { ready: false, code: readiness.code },
      positions: parsed.supported ? parsed.template.positions : [],
      content: parsed.supported
        ? {
            body: parsed.template.body,
            footer: parsed.template.footer,
            button: parsed.template.paymentButton
              ? {
                  label: parsed.template.paymentButton.label,
                  url: parsed.template.paymentButton.url,
                }
              : null,
          }
        : rawContent(row.metaComponents),
      mapping: (revision?.mapping as unknown as TemplateMapping) ?? null,
      grantedCompanies: row._count.grants,
      lastSyncAt: row.lastMetaSyncAt,
    };
  }
}

/** Best-effort display of an unsupported template's text; never used for sending. */
function rawContent(components: Prisma.JsonValue): TemplateContentView {
  const parts: Array<Record<string, unknown>> = Array.isArray(components)
    ? (components as unknown[]).filter(isRecord)
    : [];
  const text = (type: string) => {
    const part = parts.find((item) => String(item.type).toUpperCase() === type);
    return part && typeof part.text === 'string' ? part.text : null;
  };
  return { body: text('BODY') ?? '', footer: text('FOOTER'), button: null };
}
