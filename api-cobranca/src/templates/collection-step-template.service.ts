import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CollectionSlotMethod } from './template-contracts';
import { lockTemplates } from './template-locks';
import { TemplatePolicyService } from './template-policy.service';
import { methodCanFill, templateDataNeeds } from './template-renderer';

export interface CompanyCollectionStepView {
  ruleStepId: string;
  profileId: string;
  profileName: string;
  /** Cumulative day relative to the due date. */
  scheduleDay: number;
  customTemplates: Array<{
    billingMethod: CollectionSlotMethod;
    templateId: string;
    templateName: string;
  }>;
}

/**
 * Custom templates of one company's rule steps, linked by the platform admin after a
 * support request. They replace the global template of that step and method only.
 */
@Injectable()
export class CollectionStepTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TemplatePolicyService,
  ) {}

  /** WhatsApp steps of the company's active profiles, with the custom templates linked. */
  async list(companyId: string): Promise<CompanyCollectionStepView[]> {
    const profiles = await this.prisma.collectionProfile.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
      include: {
        steps: {
          where: { isActive: true },
          orderBy: { stepOrder: 'asc' },
          include: {
            templateOverrides: {
              include: {
                template: { select: { metaTemplateName: true, name: true } },
              },
            },
          },
        },
      },
    });
    return profiles.flatMap((profile) => {
      let day = 0;
      return profile.steps.flatMap((step) => {
        day += step.delayDays;
        if (step.channel !== 'WHATSAPP') return [];
        return [
          {
            ruleStepId: step.id,
            profileId: profile.id,
            profileName: profile.name,
            scheduleDay: day,
            customTemplates: step.templateOverrides.map((override) => ({
              billingMethod: override.billingMethod as CollectionSlotMethod,
              templateId: override.templateId,
              templateName:
                override.template.metaTemplateName ?? override.template.name,
            })),
          },
        ];
      });
    });
  }

  async set(
    companyId: string,
    ruleStepId: string,
    billingMethod: CollectionSlotMethod,
    templateId: string | null,
    actorUserId: string,
  ): Promise<{ templateId: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      // A step of another company is simply not found.
      const step = await tx.collectionRuleStep.findFirst({
        where: {
          id: ruleStepId,
          channel: 'WHATSAPP',
          profile: { companyId },
        },
        select: { id: true },
      });
      if (!step) throw new NotFoundException('Etapa não encontrada.');
      const key = { ruleStepId, billingMethod };
      const previous = await tx.collectionStepTemplateOverride.findUnique({
        where: { ruleStepId_billingMethod: key },
        select: { templateId: true },
      });
      if ((previous?.templateId ?? null) === templateId) return { templateId };
      if (templateId) {
        await lockTemplates(tx, [templateId], 'SHARE');
        const readiness = await this.policy.readiness(tx, templateId);
        if (!readiness.ready)
          throw new HttpException(
            {
              code: readiness.code,
              message:
                'O template precisa estar aprovado, com formato suportado e variáveis configuradas.',
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        if (!methodCanFill(billingMethod, templateDataNeeds(readiness.mapping)))
          throw new HttpException(
            {
              code: 'METHOD_INCOMPATIBLE',
              message: 'O template não serve para esta forma de pagamento.',
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        await tx.collectionStepTemplateOverride.upsert({
          where: { ruleStepId_billingMethod: key },
          create: {
            companyId,
            ...key,
            templateId,
            createdByUserId: actorUserId,
          },
          update: { templateId, createdByUserId: actorUserId },
        });
      } else await tx.collectionStepTemplateOverride.deleteMany({ where: key });
      await tx.whatsappTemplateAudit.create({
        data: {
          companyId,
          templateId,
          actorUserId,
          action: 'COLLECTION_STEP_TEMPLATE_CHANGED',
          details: {
            ruleStepId,
            billingMethod,
            previousTemplateId: previous?.templateId ?? null,
          },
        },
      });
      return { templateId };
    });
  }
}
