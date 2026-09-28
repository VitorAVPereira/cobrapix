import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paymentPageBaseUrl, parseStoredTemplate } from './template-components';
import type {
  ParsedTemplate,
  RenderResult,
  TemplateMapping,
} from './template-contracts';
import { lockTemplates } from './template-locks';
import {
  renderTemplate,
  syntheticValues,
  validateMapping,
} from './template-renderer';

export function versionConflict(): ConflictException {
  return new ConflictException({
    code: 'VERSION_CHANGED',
    message: 'A configuração mudou. Atualize a prévia.',
  });
}

/**
 * Admin mapping of imported templates. Each save is an immutable revision tied to the
 * provider revision it was reviewed against; the template's current mapping moves only
 * when both revisions still match what the admin saw.
 */
@Injectable()
export class TemplateMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async save(
    templateId: string,
    expectedProviderRevision: number,
    expectedMappingRevision: number,
    mapping: TemplateMapping,
    actorUserId: string,
  ): Promise<{ mappingRevision: number }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockTemplates(tx, [templateId]);
        const template = await tx.globalMessageTemplate.findUnique({
          where: { id: templateId },
        });
        if (!template || template.origin !== 'META_IMPORTED')
          throw new NotFoundException('Template não encontrado.');
        if (
          template.providerRevision !== expectedProviderRevision ||
          template.mappingRevision !== expectedMappingRevision
        )
          throw versionConflict();
        if (template.archivedAt)
          throw new ConflictException({
            code: 'NOT_APPROVED',
            message: 'Template removido do provedor.',
          });
        const parsed = this.supported(template);
        if (parsed.fingerprint !== template.providerFingerprint)
          throw versionConflict();
        const check = validateMapping(parsed, mapping);
        if (!check.ok)
          throw new BadRequestException({
            code: 'MAPPING_INVALID',
            field: check.field,
            message: check.reason,
          });
        const revision = template.mappingRevision + 1;
        await tx.whatsappTemplateMappingRevision.create({
          data: {
            templateId,
            revision,
            providerRevision: template.providerRevision,
            providerFingerprint: parsed.fingerprint,
            components: parsed as unknown as Prisma.InputJsonValue,
            mapping: mapping as unknown as Prisma.InputJsonValue,
            createdByUserId: actorUserId,
          },
        });
        const updated = await tx.globalMessageTemplate.updateMany({
          where: {
            id: templateId,
            providerRevision: expectedProviderRevision,
            mappingRevision: expectedMappingRevision,
          },
          data: {
            mappingRevision: revision,
            metaReviewRequired: false,
            policyVersion: { increment: 1 },
            stateVersion: { increment: 1 },
          },
        });
        if (!updated.count) throw versionConflict();
        await tx.whatsappTemplateAudit.create({
          data: {
            templateId,
            action: 'MAPPING_SAVED',
            actorUserId,
            details: {
              mappingRevision: revision,
              providerRevision: template.providerRevision,
            },
          },
        });
        return { mappingRevision: revision };
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw versionConflict();
      throw error;
    }
  }

  /** Synthetic preview: shows the result without real data and never sends anything. */
  async preview(
    templateId: string,
    mapping: TemplateMapping,
  ): Promise<RenderResult> {
    const template = await this.prisma.globalMessageTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template || template.origin !== 'META_IMPORTED')
      throw new NotFoundException('Template não encontrado.');
    const parsed = this.supported(template);
    const sample = syntheticValues(
      paymentPageBaseUrl(this.config.get<string>('FRONTEND_URL')),
    );
    return renderTemplate(parsed, mapping, sample.values, sample.paymentUrl);
  }

  private supported(template: {
    supportReason: string | null;
    metaComponents: Prisma.JsonValue;
    parameterFormat: string | null;
    metaLanguage: string;
    metaProviderCategory: string | null;
  }): ParsedTemplate {
    const parsed = parseStoredTemplate(
      template,
      this.config.get<string>('FRONTEND_URL'),
    );
    if (template.supportReason || !parsed.supported)
      throw new HttpException(
        {
          code: 'UNSUPPORTED',
          message:
            template.supportReason ??
            (parsed.supported ? 'Formato não suportado.' : parsed.reason),
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    return parsed.template;
  }
}
