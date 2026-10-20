import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, WhatsappTemplatePurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
  type CollectionSlotMethod,
  type TemplateBlockCode,
  type TemplatePurpose,
} from './template-contracts';
import { lockTemplates } from './template-locks';
import { versionConflict } from './template-mapping.service';
import {
  TemplatePolicyService,
  type TemplateReadiness,
} from './template-policy.service';
import { methodCanFill, templateDataNeeds } from './template-renderer';

type Tx = Prisma.TransactionClient;

interface Readiness {
  ready: boolean;
  code: TemplateBlockCode | null;
}

export interface CollectionTemplateSlotView {
  purpose: TemplatePurpose;
  billingMethod: CollectionSlotMethod;
  templateId: string | null;
  templateName: string | null;
  version: number;
  available: Readiness;
}

export interface CollectionTemplateOption {
  id: string;
  name: string;
  language: string;
}

export interface CollectionTemplateSlotsView {
  slots: CollectionTemplateSlotView[];
  /** Approved templates usable now that fit each method (a card template has no Pix/boleto). */
  options: Record<CollectionSlotMethod, CollectionTemplateOption[]>;
}

function slotReadiness(
  readiness: TemplateReadiness,
  billingMethod: CollectionSlotMethod,
): Readiness {
  if (!readiness.ready) return { ready: false, code: readiness.code };
  // A template whose mapping later stopped fitting the method blocks like a format problem.
  return methodCanFill(billingMethod, templateDataNeeds(readiness.mapping))
    ? { ready: true, code: null }
    : { ready: false, code: 'UNSUPPORTED' };
}

function refused(code: string, message: string): HttpException {
  return new HttpException({ code, message }, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * The 18 global collection templates: one per collection moment and payment method, chosen
 * by the platform admin for every company. Writes carry the version the admin saw (409 on
 * a stale one), take the template lock like the other catalog writers and are audited.
 */
@Injectable()
export class CollectionTemplateSlotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TemplatePolicyService,
  ) {}

  async list(): Promise<CollectionTemplateSlotsView> {
    const [rows, approved] = await Promise.all([
      this.prisma.collectionTemplateSlot.findMany({
        include: {
          template: { select: { metaTemplateName: true, name: true } },
        },
      }),
      this.prisma.globalMessageTemplate.findMany({
        where: {
          origin: 'META_IMPORTED',
          metaStatus: 'APPROVED',
          archivedAt: null,
          supportReason: null,
        },
        select: {
          id: true,
          name: true,
          metaTemplateName: true,
          metaLanguage: true,
        },
        orderBy: { metaTemplateName: 'asc' },
      }),
    ]);

    // Each template is checked once, whether it appears as an option or in a slot.
    const cache = new Map<string, Promise<TemplateReadiness>>();
    const readinessOf = (templateId: string): Promise<TemplateReadiness> => {
      const known = cache.get(templateId);
      if (known) return known;
      const pending = this.readiness(templateId);
      cache.set(templateId, pending);
      return pending;
    };

    const options: CollectionTemplateSlotsView['options'] = {
      PIX: [],
      BOLIX: [],
      CREDIT_CARD: [],
    };
    for (const template of approved) {
      const readiness = await readinessOf(template.id);
      if (!readiness.ready) continue;
      const needs = templateDataNeeds(readiness.mapping);
      for (const method of COLLECTION_SLOT_METHODS) {
        if (!methodCanFill(method, needs)) continue;
        options[method].push({
          id: template.id,
          name: template.metaTemplateName ?? template.name,
          language: template.metaLanguage,
        });
      }
    }

    const slots: CollectionTemplateSlotView[] = [];
    for (const purpose of COLLECTION_PURPOSES) {
      for (const billingMethod of COLLECTION_SLOT_METHODS) {
        const row = rows.find(
          (item) =>
            item.purpose === purpose && item.billingMethod === billingMethod,
        );
        slots.push({
          purpose,
          billingMethod,
          templateId: row?.templateId ?? null,
          templateName: row?.template
            ? (row.template.metaTemplateName ?? row.template.name)
            : null,
          version: row?.version ?? 0,
          available: row?.templateId
            ? slotReadiness(await readinessOf(row.templateId), billingMethod)
            : { ready: false, code: 'DEFAULT_MISSING' },
        });
      }
    }
    return { slots, options };
  }

  async set(
    purpose: TemplatePurpose,
    billingMethod: CollectionSlotMethod,
    templateId: string | null,
    expectedVersion: number,
    actorUserId: string,
  ): Promise<{ version: number }> {
    return this.run(async (tx) => {
      if (templateId) await lockTemplates(tx, [templateId], 'SHARE');
      await tx.collectionTemplateSlot.createMany({
        data: {
          purpose: purpose as WhatsappTemplatePurpose,
          billingMethod,
        },
        skipDuplicates: true,
      });
      const [row] = await tx.$queryRaw<
        Array<{ id: string; templateId: string | null; version: number }>
      >`
        SELECT "id", "templateId", "version" FROM "CollectionTemplateSlot"
        WHERE "purpose" = ${purpose}::"WhatsappTemplatePurpose"
          AND "billingMethod" = ${billingMethod}::"BillingMethod"
        FOR UPDATE`;
      if (!row || row.version !== expectedVersion) throw versionConflict();
      if (row.templateId === templateId) return { version: row.version };
      if (templateId) {
        const readiness = await this.policy.readiness(tx, templateId);
        if (!readiness.ready)
          throw refused(
            readiness.code,
            'O template precisa estar aprovado, com formato suportado e variáveis configuradas.',
          );
        if (!methodCanFill(billingMethod, templateDataNeeds(readiness.mapping)))
          throw refused(
            'METHOD_INCOMPATIBLE',
            billingMethod === 'CREDIT_CARD'
              ? 'Para cartão, o template só pode usar o link de pagamento (sem Pix e sem boleto).'
              : billingMethod === 'PIX'
                ? 'Para Pix, o template não pode usar dados de boleto.'
                : 'O template não serve para esta forma de pagamento.',
          );
      }
      const updated = await tx.collectionTemplateSlot.update({
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
          templateId,
          actorUserId,
          action: 'COLLECTION_SLOT_CHANGED',
          details: {
            purpose,
            billingMethod,
            previousTemplateId: row.templateId,
            fromVersion: row.version,
            toVersion: updated.version,
          },
        },
      });
      return { version: updated.version };
    });
  }

  private readiness(templateId: string): Promise<TemplateReadiness> {
    return this.prisma.$transaction((tx) =>
      this.policy.readiness(tx, templateId),
    );
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
