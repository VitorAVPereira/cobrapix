import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { parseStoredTemplate } from './template-components';
import {
  TemplateBlockCode,
  TemplateDecision,
  TemplateMapping,
  TemplatePolicyError,
  TemplateSelection,
  TemplateSnapshot,
} from './template-contracts';
import { lockGrants, lockTemplates } from './template-locks';
import { isEligibleStatus } from './template-provider-state';
import { validateMapping } from './template-renderer';

type Tx = Prisma.TransactionClient;

/** Template-level readiness, independent of any company. */
export type TemplateReadiness =
  | {
      ready: true;
      template: {
        id: string;
        metaTemplateName: string;
        metaLanguage: string;
        providerRevision: number;
        mappingRevision: number;
        policyVersion: number;
      };
      parsed: import('./template-contracts').ParsedTemplate;
      mapping: TemplateMapping;
    }
  | { ready: false; code: TemplateBlockCode };

/**
 * Single decision used by configuration, preparation and the final dispatch:
 * known approval + supported format + valid reviewed mapping + active company grant.
 * Never answers with another template when the selected one is unavailable.
 */
@Injectable()
export class TemplatePolicyService {
  constructor(private readonly config: ConfigService) {}

  async resolve(
    tx: Tx,
    companyId: string,
    selection: TemplateSelection,
  ): Promise<TemplateDecision> {
    let templateId: string;
    if (selection.mode === 'UNCONFIGURED')
      return { allowed: false, code: 'SELECTION_MISSING' };
    if (selection.mode === 'DEFAULT') {
      const configured = await tx.companyWhatsappTemplateDefault.findUnique({
        where: {
          companyId_purpose: { companyId, purpose: selection.purpose },
        },
        select: { templateId: true },
      });
      if (!configured?.templateId)
        return { allowed: false, code: 'DEFAULT_MISSING' };
      templateId = configured.templateId;
    } else templateId = selection.templateId;
    return this.evaluate(tx, companyId, templateId);
  }

  /**
   * Final authorization of a prepared message: the same locks and versions as the writers.
   * A revocation committed before this point blocks; re-granting does not revive an old
   * snapshot because every permission change moves the grant version forward.
   */
  async assertPinned(
    tx: Tx,
    companyId: string,
    snapshot: TemplateSnapshot,
  ): Promise<void> {
    await lockTemplates(tx, [snapshot.templateId], 'SHARE');
    await lockGrants(tx, companyId, [snapshot.templateId], 'SHARE');
    const decision = await this.evaluate(tx, companyId, snapshot.templateId);
    if (!decision.allowed) throw new TemplatePolicyError(decision.code);
    const current = decision.template.snapshot;
    if (
      current.providerRevision !== snapshot.providerRevision ||
      current.mappingRevision !== snapshot.mappingRevision ||
      current.policyVersion !== snapshot.policyVersion ||
      current.grantVersion !== snapshot.grantVersion
    )
      throw new TemplatePolicyError('VERSION_CHANGED');
  }

  async evaluate(
    tx: Tx,
    companyId: string,
    templateId: string,
  ): Promise<TemplateDecision> {
    // The grant is checked first: without it nothing about the template is revealed.
    const grant = await tx.companyWhatsappTemplateGrant.findUnique({
      where: { companyId_templateId: { companyId, templateId } },
      select: { enabled: true, version: true },
    });
    if (!grant?.enabled) return { allowed: false, code: 'NOT_GRANTED' };
    const readiness = await this.readiness(tx, templateId);
    if (!readiness.ready) return { allowed: false, code: readiness.code };
    const { template, parsed, mapping } = readiness;
    return {
      allowed: true,
      template: {
        snapshot: {
          templateId: template.id,
          providerRevision: template.providerRevision,
          mappingRevision: template.mappingRevision,
          policyVersion: template.policyVersion,
          grantVersion: grant.version,
        },
        name: template.metaTemplateName,
        language: template.metaLanguage,
        parsed,
        mapping,
      },
    };
  }

  /** Whether a template could be granted or used at all (approval, format, reviewed map). */
  async readiness(tx: Tx, templateId: string): Promise<TemplateReadiness> {
    const template = await tx.globalMessageTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) return { ready: false, code: 'NOT_GRANTED' };
    if (template.origin !== 'META_IMPORTED' || !template.metaTemplateName)
      return { ready: false, code: 'UNSUPPORTED' };
    if (template.archivedAt || !isEligibleStatus(template.metaStatus))
      return { ready: false, code: 'NOT_APPROVED' };
    if (template.supportReason) return { ready: false, code: 'UNSUPPORTED' };
    if (template.metaReviewRequired || template.mappingRevision < 1)
      return { ready: false, code: 'REVIEW_REQUIRED' };
    const revision = await tx.whatsappTemplateMappingRevision.findUnique({
      where: {
        templateId_revision: {
          templateId,
          revision: template.mappingRevision,
        },
      },
    });
    if (
      !revision ||
      revision.providerRevision !== template.providerRevision ||
      revision.providerFingerprint !== template.providerFingerprint
    )
      return { ready: false, code: 'REVIEW_REQUIRED' };
    const parsed = parseStoredTemplate(
      template,
      this.config.get<string>('FRONTEND_URL'),
    );
    if (!parsed.supported) return { ready: false, code: 'UNSUPPORTED' };
    if (parsed.template.fingerprint !== revision.providerFingerprint)
      return { ready: false, code: 'REVIEW_REQUIRED' };
    const mapping = revision.mapping as unknown as TemplateMapping;
    if (!validateMapping(parsed.template, mapping).ok)
      return { ready: false, code: 'UNSUPPORTED' };
    return {
      ready: true,
      template: {
        id: template.id,
        metaTemplateName: template.metaTemplateName,
        metaLanguage: template.metaLanguage,
        providerRevision: template.providerRevision,
        mappingRevision: template.mappingRevision,
        policyVersion: template.policyVersion,
      },
      parsed: parsed.template,
      mapping,
    };
  }
}
