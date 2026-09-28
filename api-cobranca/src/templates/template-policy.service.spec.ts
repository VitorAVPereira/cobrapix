import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { TemplatePolicyService } from './template-policy.service';
import { templateFingerprint } from './template-components';
import { TemplatePolicyError } from './template-contracts';

const components = [{ type: 'BODY', text: 'Olá {{1}}.' }];
const fingerprint = templateFingerprint({
  components,
  parameterFormat: 'POSITIONAL',
  language: 'pt_BR',
  category: 'UTILITY',
});
const template = {
  id: 'template-1',
  origin: 'META_IMPORTED',
  metaTemplateName: 'cobranca',
  metaLanguage: 'pt_BR',
  metaStatus: 'APPROVED',
  metaProviderCategory: 'UTILITY',
  metaComponents: components,
  parameterFormat: 'POSITIONAL',
  metaReviewRequired: false,
  archivedAt: null,
  supportReason: null,
  providerRevision: 1,
  providerFingerprint: fingerprint,
  mappingRevision: 1,
  policyVersion: 3,
};
const revision = {
  providerRevision: 1,
  providerFingerprint: fingerprint,
  mapping: { body: { '1': { kind: 'SOURCE', source: 'DEBTOR_NAME' } } },
};

function tx(options: {
  grants?: Record<string, { enabled: boolean; version: number }>;
  defaults?: Record<string, string | null>;
  template?: Record<string, unknown>;
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    companyWhatsappTemplateGrant: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { companyId_templateId: { companyId: string } };
        }) =>
          Promise.resolve(
            options.grants?.[where.companyId_templateId.companyId] ?? null,
          ),
      ),
    },
    companyWhatsappTemplateDefault: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { companyId_purpose: { companyId: string } };
        }) => {
          const templateId =
            options.defaults?.[where.companyId_purpose.companyId];
          return Promise.resolve(
            templateId === undefined ? null : { templateId },
          );
        },
      ),
    },
    globalMessageTemplate: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ ...template, ...(options.template ?? {}) }),
    },
    whatsappTemplateMappingRevision: {
      findUnique: jest.fn().mockResolvedValue(revision),
    },
  } as unknown as Prisma.TransactionClient;
}

const policy = new TemplatePolicyService(new ConfigService({}));
const explicit = { mode: 'EXPLICIT', templateId: 'template-1' } as const;

describe('TemplatePolicyService', () => {
  it('allows only the company holding an active grant', async () => {
    const client = tx({ grants: { companyA: { enabled: true, version: 2 } } });
    const decisionForA = await policy.resolve(client, 'companyA', explicit);
    expect(decisionForA).toMatchObject({
      allowed: true,
      template: {
        name: 'cobranca',
        snapshot: {
          templateId: 'template-1',
          providerRevision: 1,
          mappingRevision: 1,
          policyVersion: 3,
          grantVersion: 2,
        },
      },
    });
    const decisionForB = await policy.resolve(client, 'companyB', explicit);
    expect(decisionForB).toEqual({ allowed: false, code: 'NOT_GRANTED' });
  });

  it('an explicit choice never falls back and a missing default blocks', async () => {
    const revoked = tx({
      grants: { companyA: { enabled: false, version: 3 } },
    });
    const explicitRevoked = await policy.resolve(revoked, 'companyA', explicit);
    expect(explicitRevoked).toEqual({ allowed: false, code: 'NOT_GRANTED' });
    const missingDefault = await policy.resolve(tx({}), 'companyA', {
      mode: 'DEFAULT',
      purpose: 'BEFORE_DUE',
    });
    expect(missingDefault).toEqual({ allowed: false, code: 'DEFAULT_MISSING' });
    expect(
      await policy.resolve(tx({}), 'companyA', { mode: 'UNCONFIGURED' }),
    ).toEqual({ allowed: false, code: 'SELECTION_MISSING' });
  });

  it.each([
    [{ metaStatus: 'PAUSED' }, 'NOT_APPROVED'],
    [{ archivedAt: new Date() }, 'NOT_APPROVED'],
    [{ supportReason: 'HEADER' }, 'UNSUPPORTED'],
    [{ origin: 'LEGACY_INTERNAL' }, 'UNSUPPORTED'],
    [{ metaReviewRequired: true }, 'REVIEW_REQUIRED'],
    [{ mappingRevision: 0 }, 'REVIEW_REQUIRED'],
    [{ providerRevision: 2 }, 'REVIEW_REQUIRED'],
  ])('blocks %p with %s even when granted', async (change, code) => {
    const client = tx({
      grants: { companyA: { enabled: true, version: 1 } },
      template: change,
    });
    expect(await policy.resolve(client, 'companyA', explicit)).toEqual({
      allowed: false,
      code,
    });
  });

  it('assertPinned refuses a snapshot from before a revoke and re-grant', async () => {
    const client = tx({ grants: { companyA: { enabled: true, version: 3 } } });
    const oldSnapshot = {
      templateId: 'template-1',
      providerRevision: 1,
      mappingRevision: 1,
      policyVersion: 3,
      grantVersion: 1,
    };
    await expect(
      policy.assertPinned(client, 'companyA', oldSnapshot),
    ).rejects.toMatchObject({ code: 'VERSION_CHANGED' });
    await expect(
      policy.assertPinned(client, 'companyA', {
        ...oldSnapshot,
        grantVersion: 3,
      }),
    ).resolves.toMatchObject({ name: 'cobranca' });
    await expect(
      policy.assertPinned(client, 'companyB', oldSnapshot),
    ).rejects.toBeInstanceOf(TemplatePolicyError);
  });
});
