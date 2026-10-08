import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingMethod,
  CollectionChannel,
  CollectionProfileType,
  CollectionRuleStep,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTemplatesService } from '../email/email-templates.service';
import { TemplatePolicyService } from '../templates/template-policy.service';
import {
  COLLECTION_PURPOSES,
  TemplateBlockCode,
  TemplateDecision,
  TemplateSelection,
} from '../templates/template-contracts';
import {
  MethodTemplates,
  purposeForScheduleDay,
  ruleStepSelection,
  stepMethodTemplates,
} from '../templates/template-selection';
import {
  methodCanFill,
  templateDataNeeds,
} from '../templates/template-renderer';

interface CreateProfileInput {
  name: string;
  profileType: CollectionProfileType;
  isDefault?: boolean;
  daysOverdueMin?: number;
  daysOverdueMax?: number;
}

interface CreateStepInput {
  /** Stable ID of an existing step; required to change the choice of an attempted step. */
  id?: string;
  stepOrder: number;
  channel: CollectionChannel;
  emailTemplateId?: string;
  whatsappSelection?: TemplateSelection;
  /** Per billing method: a template ID, null to clear or absent to keep the current one. */
  whatsappMethodTemplates?: MethodTemplates;
  delayDays: number;
  sendTimeStart?: string;
  sendTimeEnd?: string;
}

type TemplateStatus = { ready: boolean; code: TemplateBlockCode | null };

/** Step as returned to the company: selection per channel and whether it is usable now. */
export type PresentedStep = CollectionRuleStep & {
  whatsappSelection: TemplateSelection | null;
  whatsappStatus: TemplateStatus | null;
  whatsappMethodTemplates: MethodTemplates | null;
  whatsappMethodStatus: Partial<Record<BillingMethod, TemplateStatus>> | null;
  /** Methods without their own template whose charges lack data the step's template reads. */
  whatsappIncompatibleMethods: BillingMethod[] | null;
};

const BILLING_METHODS: readonly BillingMethod[] = [
  'PIX',
  'BOLETO',
  'BOLIX',
  'CREDIT_CARD',
];
const METHOD_LABELS: Record<BillingMethod, string> = {
  CREDIT_CARD: 'Cartão de crédito',
  PIX: 'Pix',
  BOLETO: 'Boleto',
  BOLIX: 'BOLIX',
};

interface StandardProfileStep {
  day: number;
  channel: CollectionChannel;
}

type DefaultTemplateSlug =
  | 'cobranca-emissao'
  | 'pre-vencimento'
  | 'vencimento-hoje'
  | 'atraso-primeiro-aviso'
  | 'atraso-recorrente'
  | 'atraso-critico';

/** Email defaults by slug; WhatsApp steps use the company's purpose defaults instead. */
type DefaultTemplateIds = { EMAIL: ReadonlyMap<string, string> };

interface StandardProfile {
  name: string;
  profileType: CollectionProfileType;
  isDefault: boolean;
  daysOverdueMin: number | null;
  daysOverdueMax: number | null;
  steps: readonly StandardProfileStep[];
}

interface ExistingProfile {
  id: string;
  companyId: string;
  name: string;
  profileType: CollectionProfileType;
  isDefault: boolean;
  isActive: boolean;
  daysOverdueMin: number | null;
  daysOverdueMax: number | null;
  steps: Array<{ id: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const STANDARD_COLLECTION_PROFILES: readonly StandardProfile[] = [
  {
    name: 'Novo Cliente',
    profileType: 'NEW',
    isDefault: true,
    daysOverdueMin: null,
    daysOverdueMax: null,
    steps: [
      { day: -30, channel: 'EMAIL' },
      { day: -2, channel: 'EMAIL' },
      { day: 0, channel: 'EMAIL' },
      { day: 0, channel: 'WHATSAPP' },
      { day: 2, channel: 'EMAIL' },
      { day: 4, channel: 'WHATSAPP' },
      { day: 7, channel: 'EMAIL' },
      { day: 10, channel: 'WHATSAPP' },
      { day: 15, channel: 'EMAIL' },
      { day: 20, channel: 'WHATSAPP' },
      { day: 30, channel: 'EMAIL' },
    ],
  },
  {
    name: 'Bom Pagador',
    profileType: 'GOOD',
    isDefault: false,
    daysOverdueMin: null,
    daysOverdueMax: null,
    steps: [
      { day: -30, channel: 'EMAIL' },
      { day: -2, channel: 'EMAIL' },
      { day: 0, channel: 'EMAIL' },
      { day: 0, channel: 'WHATSAPP' },
      { day: 2, channel: 'WHATSAPP' },
    ],
  },
  {
    name: 'Pagador Duvidoso',
    profileType: 'DOUBTFUL',
    isDefault: false,
    daysOverdueMin: 6,
    daysOverdueMax: 60,
    steps: [
      { day: -30, channel: 'EMAIL' },
      { day: -7, channel: 'WHATSAPP' },
      { day: -2, channel: 'EMAIL' },
      { day: 0, channel: 'EMAIL' },
      { day: 0, channel: 'WHATSAPP' },
      { day: 2, channel: 'WHATSAPP' },
      { day: 7, channel: 'EMAIL' },
      { day: 15, channel: 'WHATSAPP' },
      { day: 20, channel: 'EMAIL' },
      { day: 30, channel: 'WHATSAPP' },
      { day: 45, channel: 'EMAIL' },
      { day: 60, channel: 'EMAIL' },
      { day: 60, channel: 'WHATSAPP' },
      { day: 75, channel: 'EMAIL' },
      { day: 75, channel: 'WHATSAPP' },
      { day: 90, channel: 'EMAIL' },
      { day: 90, channel: 'WHATSAPP' },
    ],
  },
  {
    name: 'Mau Pagador',
    profileType: 'BAD',
    isDefault: false,
    daysOverdueMin: 61,
    daysOverdueMax: null,
    steps: [
      { day: -30, channel: 'EMAIL' },
      { day: -2, channel: 'EMAIL' },
      { day: 0, channel: 'EMAIL' },
      { day: 0, channel: 'WHATSAPP' },
      { day: 2, channel: 'EMAIL' },
      { day: 4, channel: 'WHATSAPP' },
      { day: 7, channel: 'EMAIL' },
      { day: 10, channel: 'WHATSAPP' },
      { day: 15, channel: 'EMAIL' },
      { day: 30, channel: 'WHATSAPP' },
      { day: 40, channel: 'EMAIL' },
    ],
  },
];

const PROFILE_TYPE_ORDER: Record<CollectionProfileType, number> = {
  NEW: 0,
  GOOD: 1,
  DOUBTFUL: 2,
  BAD: 3,
};

@Injectable()
export class CollectionProfileService {
  private readonly logger = new Logger(CollectionProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: TemplatePolicyService,
    private readonly emailTemplatesService: EmailTemplatesService,
  ) {}

  async listProfiles(companyId: string) {
    await this.ensureStandardProfiles(companyId);

    const profiles = await this.prisma.collectionProfile.findMany({
      where: { companyId, isActive: true },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        _count: { select: { debtors: true } },
      },
      orderBy: [{ name: 'asc' }],
    });

    const sorted = profiles.sort((a, b) => {
      const order =
        PROFILE_TYPE_ORDER[a.profileType] - PROFILE_TYPE_ORDER[b.profileType];
      if (order !== 0) return order;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    const presented = [];
    for (const profile of sorted)
      presented.push({
        ...profile,
        steps: await this.presentSteps(companyId, profile.steps),
      });
    return presented;
  }

  async getProfile(companyId: string, profileId: string) {
    const profile = await this.prisma.collectionProfile.findFirst({
      where: { id: profileId, companyId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    return profile
      ? { ...profile, steps: await this.presentSteps(companyId, profile.steps) }
      : null;
  }

  /**
   * A WhatsApp step whose choice is missing, revoked or unusable stays visible with its
   * pending status; order, delays and history are never changed to hide it.
   */
  private async presentSteps(
    companyId: string,
    steps: CollectionRuleStep[],
  ): Promise<PresentedStep[]> {
    const decisions = new Map<string, TemplateDecision>();
    const decide = async (
      selection: TemplateSelection,
    ): Promise<TemplateDecision> => {
      const key = JSON.stringify(selection);
      if (!decisions.has(key))
        decisions.set(
          key,
          await this.prisma.$transaction((tx) =>
            this.policy.resolve(tx, companyId, selection),
          ),
        );
      return decisions.get(key)!;
    };
    const status = (decision: TemplateDecision): TemplateStatus =>
      decision.allowed
        ? { ready: true, code: null }
        : { ready: false, code: decision.code };
    const result: PresentedStep[] = [];
    for (const step of steps) {
      if (step.channel !== 'WHATSAPP') {
        result.push({
          ...step,
          whatsappSelection: null,
          whatsappStatus: null,
          whatsappMethodTemplates: null,
          whatsappMethodStatus: null,
          whatsappIncompatibleMethods: null,
        });
        continue;
      }
      const selection = ruleStepSelection(step);
      const decision = await decide(selection);
      const methodTemplates = stepMethodTemplates(step);
      const methodStatus: Partial<Record<BillingMethod, TemplateStatus>> = {};
      for (const method of BILLING_METHODS) {
        const templateId = methodTemplates[method];
        if (templateId)
          methodStatus[method] = status(
            await decide({ mode: 'EXPLICIT', templateId }),
          );
      }
      const needs = decision.allowed
        ? templateDataNeeds(decision.template.mapping)
        : null;
      // An unavailable explicit template is not exposed to the company beyond its status.
      result.push({
        ...step,
        whatsappSelection: selection,
        whatsappStatus: status(decision),
        whatsappMethodTemplates: methodTemplates,
        whatsappMethodStatus: methodStatus,
        whatsappIncompatibleMethods: needs
          ? BILLING_METHODS.filter(
              (method) =>
                !methodTemplates[method] && !methodCanFill(method, needs),
            )
          : [],
      });
    }
    return result;
  }

  async createProfile(companyId: string, input: CreateProfileInput) {
    if (input.isDefault) {
      await this.prisma.collectionProfile.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.collectionProfile.create({
      data: {
        companyId,
        name: input.name,
        profileType: input.profileType,
        isDefault: input.isDefault ?? false,
        daysOverdueMin: input.daysOverdueMin,
        daysOverdueMax: input.daysOverdueMax,
      },
      include: { steps: true },
    });
  }

  async updateProfile(
    companyId: string,
    profileId: string,
    input: Partial<CreateProfileInput>,
  ) {
    if (input.isDefault) {
      await this.prisma.collectionProfile.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.collectionProfile.update({
      where: { id: profileId, companyId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.profileType !== undefined && {
          profileType: input.profileType,
        }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        ...(input.daysOverdueMin !== undefined && {
          daysOverdueMin: input.daysOverdueMin,
        }),
        ...(input.daysOverdueMax !== undefined && {
          daysOverdueMax: input.daysOverdueMax,
        }),
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
  }

  async deleteProfile(companyId: string, profileId: string) {
    const profile = await this.prisma.collectionProfile.findFirst({
      where: { id: profileId, companyId, isActive: true },
      select: { id: true, isDefault: true },
    });

    if (!profile) {
      throw new NotFoundException('Perfil nao encontrado.');
    }

    if (profile.isDefault) {
      throw new BadRequestException('O perfil padrao nao pode ser removido.');
    }

    const defaultProfile = await this.prisma.collectionProfile.findFirst({
      where: { companyId, isDefault: true, isActive: true },
    });

    await this.prisma.debtor.updateMany({
      where: { companyId, collectionProfileId: profileId },
      data: { collectionProfileId: defaultProfile?.id ?? null },
    });

    return this.prisma.collectionProfile.update({
      where: { id: profile.id },
      data: { isActive: false, isDefault: false },
    });
  }

  async setSteps(
    companyId: string,
    profileId: string,
    steps: CreateStepInput[],
  ) {
    const profile = await this.prisma.collectionProfile.findFirst({
      where: { id: profileId, companyId },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException('Perfil nao encontrado.');
    }

    const existing = await this.prisma.collectionRuleStep.findMany({
      where: { profileId },
      include: { _count: { select: { attempts: true } } },
      orderBy: { stepOrder: 'asc' },
    });
    await this.validateSteps(companyId, steps, existing);

    if (existing.some((step) => step._count.attempts > 0)) {
      // Attempted steps keep ID, order, delays and history; only the template choice moves.
      await this.updateSelectionsInPlace(steps, existing);
      return this.presentSteps(
        companyId,
        await this.prisma.collectionRuleStep.findMany({
          where: { profileId },
          orderBy: { stepOrder: 'asc' },
        }),
      );
    }

    // Steps sent back with their ID keep it (holds and logical keys refer to it); others
    // are created and the missing ones removed.
    const existingIds = new Set(existing.map((step) => step.id));
    const kept = [
      ...new Set(
        steps.flatMap((step) =>
          step.id && existingIds.has(step.id) ? [step.id] : [],
        ),
      ),
    ];
    await this.prisma.$transaction(async (tx) => {
      await tx.collectionRuleStep.deleteMany({
        where: { profileId, id: { notIn: kept } },
      });
      // Temporary orders avoid transient (profile, order, channel) collisions on reorder.
      for (const [index, id] of kept.entries())
        await tx.collectionRuleStep.update({
          where: { id },
          data: { stepOrder: -1 - index },
        });
      const used = new Set<string>();
      for (const step of steps) {
        const data = {
          stepOrder: step.stepOrder,
          channel: step.channel,
          ...this.selectionColumns(step, existing),
          delayDays: step.delayDays,
          sendTimeStart: step.sendTimeStart || null,
          sendTimeEnd: step.sendTimeEnd || null,
          isActive: true,
        };
        if (step.id && kept.includes(step.id) && !used.has(step.id)) {
          used.add(step.id);
          await tx.collectionRuleStep.update({ where: { id: step.id }, data });
        } else
          await tx.collectionRuleStep.create({ data: { profileId, ...data } });
      }
    });

    return this.presentSteps(
      companyId,
      await this.prisma.collectionRuleStep.findMany({
        where: { profileId },
        orderBy: { stepOrder: 'asc' },
      }),
    );
  }

  private async updateSelectionsInPlace(
    steps: CreateStepInput[],
    existing: CollectionRuleStep[],
  ): Promise<void> {
    const byId = new Map(existing.map((step) => [step.id, step]));
    const unchangedSchedule =
      steps.length === existing.length &&
      new Set(steps.map((step) => step.id)).size === steps.length &&
      steps.every((step) => {
        const current = step.id ? byId.get(step.id) : undefined;
        return (
          current &&
          current.stepOrder === step.stepOrder &&
          current.channel === step.channel &&
          current.delayDays === step.delayDays &&
          (current.sendTimeStart ?? null) === (step.sendTimeStart || null) &&
          (current.sendTimeEnd ?? null) === (step.sendTimeEnd || null)
        );
      });
    if (!unchangedSchedule)
      throw new BadRequestException(
        'Este perfil ja possui tentativas registradas. Apenas a escolha do template das etapas existentes pode ser alterada; crie um novo perfil para mudar a regua.',
      );
    await this.prisma.$transaction(async (tx) => {
      for (const step of steps)
        await tx.collectionRuleStep.update({
          where: { id: step.id },
          data: this.selectionColumns(step, existing),
        });
    });
  }

  /** Columns of each channel; the other channel's columns are always empty. */
  private selectionColumns(
    step: CreateStepInput,
    existing: CollectionRuleStep[],
  ): Pick<
    Prisma.CollectionRuleStepCreateManyInput,
    | 'templateId'
    | 'emailTemplateId'
    | 'whatsappSelectionMode'
    | 'whatsappPurpose'
    | 'pixTemplateId'
    | 'boletoTemplateId'
    | 'bolixTemplateId'
    | 'cardTemplateId'
  > {
    if (step.channel === 'EMAIL')
      return {
        templateId: null,
        emailTemplateId: step.emailTemplateId || null,
        whatsappSelectionMode: null,
        whatsappPurpose: null,
        pixTemplateId: null,
        boletoTemplateId: null,
        bolixTemplateId: null,
        cardTemplateId: null,
      };
    const previous = existing.find((item) => item.id === step.id);
    // Absent keeps the current template (clients that do not know the field); null clears.
    const method = (key: BillingMethod, current: string | null | undefined) => {
      const value = step.whatsappMethodTemplates?.[key];
      return value === undefined ? (current ?? null) : value;
    };
    const methods = {
      pixTemplateId: method('PIX', previous?.pixTemplateId),
      boletoTemplateId: method('BOLETO', previous?.boletoTemplateId),
      bolixTemplateId: method('BOLIX', previous?.bolixTemplateId),
      cardTemplateId: method('CREDIT_CARD', previous?.cardTemplateId),
    };
    const selection = step.whatsappSelection ?? { mode: 'UNCONFIGURED' };
    if (selection.mode === 'EXPLICIT')
      return {
        templateId: selection.templateId,
        emailTemplateId: null,
        whatsappSelectionMode: 'EXPLICIT',
        whatsappPurpose: null,
        ...methods,
      };
    if (selection.mode === 'DEFAULT')
      return {
        templateId: null,
        emailTemplateId: null,
        whatsappSelectionMode: 'DEFAULT',
        whatsappPurpose: selection.purpose,
        ...methods,
      };
    // A legacy step saved without a new choice keeps its references for history.
    return {
      templateId: previous?.templateId ?? null,
      emailTemplateId: null,
      whatsappSelectionMode: 'UNCONFIGURED',
      whatsappPurpose: previous?.whatsappPurpose ?? null,
      ...methods,
    };
  }

  async classifyDebtors(companyId: string) {
    await this.ensureStandardProfiles(companyId);

    const profiles = await this.prisma.collectionProfile.findMany({
      where: { companyId, isActive: true },
    });

    if (profiles.length === 0) return;

    const now = new Date();
    const debtors = await this.prisma.debtor.findMany({
      where: { companyId },
      include: {
        invoices: {
          where: { status: { in: ['PENDING', 'PAID'] } },
          orderBy: { dueDate: 'desc' },
          take: 20,
        },
      },
    });

    for (const debtor of debtors) {
      const profile = this.classifyDebtor(debtor, profiles, now);
      if (profile && debtor.collectionProfileId !== profile.id) {
        await this.prisma.debtor.updateMany({
          where: { id: debtor.id, companyId },
          data: { collectionProfileId: profile.id },
        });
      }
    }

    this.logger.log(
      `Classificacao automatica concluida para ${debtors.length} devedores na empresa ${companyId}`,
    );
  }

  private classifyDebtor(
    debtor: {
      invoices: Array<{ status: string; dueDate: Date }>;
    },
    profiles: Array<{
      id: string;
      profileType: CollectionProfileType;
      daysOverdueMin: number | null;
      daysOverdueMax: number | null;
    }>,
    now: Date,
  ) {
    const totalInvoices = debtor.invoices.length;
    if (totalInvoices === 0) return this.findProfileByType(profiles, 'NEW');

    const paidCount = debtor.invoices.filter((i) => i.status === 'PAID').length;
    const paymentRate = totalInvoices > 0 ? paidCount / totalInvoices : 0;

    const pendingInvoices = debtor.invoices.filter(
      (i) => i.status === 'PENDING',
    );
    const maxDaysOverdue = Math.max(
      0,
      ...pendingInvoices.map((i) =>
        Math.floor((now.getTime() - i.dueDate.getTime()) / (24 * 3600 * 1000)),
      ),
    );

    const thresholdProfile = profiles.find((profile) => {
      if (profile.daysOverdueMin === null && profile.daysOverdueMax === null) {
        return false;
      }

      const min = profile.daysOverdueMin ?? Number.NEGATIVE_INFINITY;
      const max = profile.daysOverdueMax ?? Number.POSITIVE_INFINITY;

      return maxDaysOverdue >= min && maxDaysOverdue <= max;
    });

    if (thresholdProfile) {
      return thresholdProfile;
    }

    if (paymentRate >= 0.8 && maxDaysOverdue <= 5) {
      return (
        this.findProfileByType(profiles, 'GOOD') ??
        this.findProfileByType(profiles, 'NEW')
      );
    }

    if (maxDaysOverdue > 60 || paymentRate < 0.2) {
      return (
        this.findProfileByType(profiles, 'BAD') ??
        this.findProfileByType(profiles, 'NEW')
      );
    }

    return (
      this.findProfileByType(profiles, 'DOUBTFUL') ??
      this.findProfileByType(profiles, 'NEW')
    );
  }

  private findProfileByType(
    profiles: Array<{ id: string; profileType: CollectionProfileType }>,
    type: CollectionProfileType,
  ) {
    return profiles.find((p) => p.profileType === type) ?? null;
  }

  private async ensureStandardProfiles(companyId: string): Promise<void> {
    const defaultTemplateIds: DefaultTemplateIds = {
      EMAIL: new Map(
        (await this.emailTemplatesService.ensureDefaultTemplates(companyId))
          .filter((template) => template.id)
          .map((template) => [template.slug, template.id as string]),
      ),
    };
    const profiles = await this.prisma.collectionProfile.findMany({
      where: { companyId },
      include: { steps: { select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    });

    let hasDefault = profiles.some(
      (profile) => profile.isActive && profile.isDefault,
    );

    for (const standardProfile of STANDARD_COLLECTION_PROFILES) {
      const existingProfile = this.findReusableProfile(
        profiles,
        standardProfile,
      );

      if (existingProfile) {
        const normalizedProfile = await this.normalizeStandardProfile(
          companyId,
          existingProfile,
          standardProfile,
          hasDefault,
          defaultTemplateIds,
        );

        if (normalizedProfile.isDefault) {
          hasDefault = true;
        }

        const profileIndex = profiles.findIndex(
          (profile) => profile.id === normalizedProfile.id,
        );

        if (profileIndex >= 0) {
          profiles[profileIndex] = normalizedProfile;
        }

        continue;
      }

      const createdProfile = await this.prisma.collectionProfile
        .create({
          data: {
            companyId,
            name: standardProfile.name,
            profileType: standardProfile.profileType,
            isDefault: standardProfile.isDefault && !hasDefault,
            isActive: true,
            daysOverdueMin: standardProfile.daysOverdueMin,
            daysOverdueMax: standardProfile.daysOverdueMax,
            steps: {
              create: this.buildStandardStepRows(
                standardProfile.steps,
                defaultTemplateIds,
              ),
            },
          },
          include: { steps: { select: { id: true } } },
        })
        .catch(async (error: unknown): Promise<ExistingProfile> => {
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== 'P2002'
          ) {
            throw error;
          }
          // Both pages may load the same tenant's defaults before either request finishes.
          const concurrentProfile =
            await this.prisma.collectionProfile.findFirst({
              where: { companyId, name: standardProfile.name },
              include: { steps: { select: { id: true } } },
            });
          if (!concurrentProfile) throw error;
          return concurrentProfile;
        });

      profiles.push(createdProfile);

      if (createdProfile.isDefault) {
        hasDefault = true;
      }
    }
  }

  private findReusableProfile(
    profiles: ExistingProfile[],
    standardProfile: StandardProfile,
  ): ExistingProfile | null {
    return (
      profiles.find(
        (profile) =>
          profile.isActive &&
          profile.profileType === standardProfile.profileType,
      ) ??
      profiles.find(
        (profile) => profile.isActive && profile.name === standardProfile.name,
      ) ??
      profiles.find(
        (profile) => profile.profileType === standardProfile.profileType,
      ) ??
      profiles.find((profile) => profile.name === standardProfile.name) ??
      null
    );
  }

  private async normalizeStandardProfile(
    companyId: string,
    profile: ExistingProfile,
    standardProfile: StandardProfile,
    hasDefault: boolean,
    defaultTemplateIds: DefaultTemplateIds,
  ): Promise<ExistingProfile> {
    const shouldReplaceExistingSteps = this.isLegacyDefaultProfile(profile);
    const shouldUseStandardName =
      shouldReplaceExistingSteps || !profile.isActive;

    const data: {
      name?: string;
      profileType?: CollectionProfileType;
      isDefault?: boolean;
      isActive?: boolean;
      daysOverdueMin?: number | null;
      daysOverdueMax?: number | null;
    } = {};

    if (shouldUseStandardName && profile.name !== standardProfile.name) {
      data.name = standardProfile.name;
    }

    if (profile.profileType !== standardProfile.profileType) {
      data.profileType = standardProfile.profileType;
    }

    if (!profile.isActive) {
      data.isActive = true;
    }

    if (!hasDefault && standardProfile.isDefault && !profile.isDefault) {
      data.isDefault = true;
    }

    if (
      this.shouldUseStandardThreshold(profile.daysOverdueMin) &&
      profile.daysOverdueMin !== standardProfile.daysOverdueMin
    ) {
      data.daysOverdueMin = standardProfile.daysOverdueMin;
    }

    if (
      this.shouldUseStandardThreshold(profile.daysOverdueMax) &&
      profile.daysOverdueMax !== standardProfile.daysOverdueMax
    ) {
      data.daysOverdueMax = standardProfile.daysOverdueMax;
    }

    const normalizedProfile =
      Object.keys(data).length > 0
        ? await this.prisma.collectionProfile.update({
            where: { id: profile.id, companyId },
            data,
            include: { steps: { select: { id: true } } },
          })
        : profile;

    await this.ensureStandardSteps(
      companyId,
      normalizedProfile,
      standardProfile.steps,
      shouldReplaceExistingSteps,
      defaultTemplateIds,
    );

    return normalizedProfile;
  }

  private async ensureStandardSteps(
    companyId: string,
    profile: ExistingProfile,
    standardSteps: readonly StandardProfileStep[],
    shouldReplaceExistingSteps: boolean,
    defaultTemplateIds: DefaultTemplateIds,
  ): Promise<void> {
    if (profile.steps.length > 0 && !shouldReplaceExistingSteps) {
      return;
    }

    if (profile.steps.length > 0) {
      const attempts = await this.prisma.collectionAttempt.count({
        where: {
          companyId,
          ruleStep: { profileId: profile.id },
        },
      });

      if (attempts > 0) {
        return;
      }

      await this.prisma.collectionRuleStep.deleteMany({
        where: { profileId: profile.id, profile: { companyId } },
      });
    }

    await this.prisma.collectionRuleStep.createMany({
      data: this.buildStandardStepRows(standardSteps, defaultTemplateIds).map(
        (step) => ({
          ...step,
          profileId: profile.id,
        }),
      ),
    });
  }

  private buildStandardStepRows(
    steps: readonly StandardProfileStep[],
    defaultTemplateIds?: DefaultTemplateIds,
  ): Array<{
    stepOrder: number;
    channel: CollectionChannel;
    delayDays: number;
    emailTemplateId?: string;
    whatsappSelectionMode?: 'DEFAULT';
    whatsappPurpose?: ReturnType<typeof purposeForScheduleDay>;
    isActive: boolean;
  }> {
    let previousDay = 0;

    return steps.map((step, index) => {
      const delayDays = index === 0 ? step.day : step.day - previousDay;
      previousDay = step.day;
      const emailTemplateId =
        step.channel === 'EMAIL'
          ? defaultTemplateIds?.EMAIL.get(
              this.getTemplateSlugForScheduleDay(step.day),
            )
          : undefined;

      return {
        stepOrder: index,
        channel: step.channel,
        delayDays,
        ...(emailTemplateId ? { emailTemplateId } : {}),
        // WhatsApp steps follow the purpose default; nothing is granted or picked here.
        ...(step.channel === 'WHATSAPP'
          ? {
              whatsappSelectionMode: 'DEFAULT' as const,
              whatsappPurpose: purposeForScheduleDay(step.day),
            }
          : {}),
        isActive: true,
      };
    });
  }

  private getTemplateSlugForScheduleDay(day: number): DefaultTemplateSlug {
    if (day <= -30) {
      return 'cobranca-emissao';
    }

    if (day < 0) {
      return 'pre-vencimento';
    }

    if (day === 0) {
      return 'vencimento-hoje';
    }

    if (day <= 2) {
      return 'atraso-primeiro-aviso';
    }

    if (day >= 30) {
      return 'atraso-critico';
    }

    return 'atraso-recorrente';
  }

  private isLegacyDefaultProfile(profile: { name: string }): boolean {
    return profile.name === 'Padrao' || profile.name === 'Padrão';
  }

  private shouldUseStandardThreshold(value: number | null): boolean {
    return value === null;
  }

  private async validateSteps(
    companyId: string,
    steps: CreateStepInput[],
    existing: CollectionRuleStep[],
  ): Promise<void> {
    const seen = new Set<string>();

    for (const step of steps) {
      if (step.delayDays < -30 || step.delayDays > 365) {
        throw new BadRequestException(
          'Delay da etapa fora do intervalo permitido.',
        );
      }

      if (step.sendTimeStart && !this.isTime(step.sendTimeStart)) {
        throw new BadRequestException('Horario inicial invalido.');
      }

      if (step.sendTimeEnd && !this.isTime(step.sendTimeEnd)) {
        throw new BadRequestException('Horario final invalido.');
      }

      const key = `${step.stepOrder}:${step.channel}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          'Etapas duplicadas para a mesma ordem e canal.',
        );
      }
      seen.add(key);
    }

    // Each channel references only its own catalog.
    if (
      steps.some(
        (step) =>
          (step.channel === 'EMAIL' &&
            (step.whatsappSelection ||
              Object.values(step.whatsappMethodTemplates ?? {}).some(
                Boolean,
              ))) ||
          (step.channel === 'WHATSAPP' && step.emailTemplateId),
      )
    ) {
      throw new BadRequestException(
        'O template informado nao corresponde ao canal da etapa.',
      );
    }

    for (const step of steps.filter((item) => item.channel === 'WHATSAPP')) {
      const selection = step.whatsappSelection;
      if (!selection)
        throw new BadRequestException(
          'Etapas WhatsApp exigem o padrao da finalidade ou um template liberado.',
        );
      if (selection.mode === 'UNCONFIGURED') {
        // Only an existing pending step may be kept as is; new steps need a valid choice.
        const previous = existing.find((item) => item.id === step.id);
        if (previous?.whatsappSelectionMode !== 'UNCONFIGURED')
          throw new BadRequestException(
            'Escolha o padrao da finalidade ou um template liberado para a etapa WhatsApp.',
          );
      } else if (selection.mode === 'DEFAULT') {
        if (!COLLECTION_PURPOSES.includes(selection.purpose))
          throw new BadRequestException('Finalidade invalida para a regua.');
      } else {
        const decision = await this.prisma.$transaction((tx) =>
          this.policy.resolve(tx, companyId, selection),
        );
        if (!decision.allowed)
          throw new BadRequestException(
            'Um ou mais templates nao estao disponiveis para esta empresa.',
          );
      }
      for (const method of BILLING_METHODS) {
        const templateId = step.whatsappMethodTemplates?.[method];
        if (!templateId) continue;
        const decision = await this.prisma.$transaction((tx) =>
          this.policy.resolve(tx, companyId, { mode: 'EXPLICIT', templateId }),
        );
        if (!decision.allowed)
          throw new BadRequestException(
            'Um ou mais templates nao estao disponiveis para esta empresa.',
          );
        // A template reading data this method never has would only produce pending sends.
        if (
          !methodCanFill(method, templateDataNeeds(decision.template.mapping))
        )
          throw new BadRequestException(
            `O template escolhido para ${METHOD_LABELS[method]} usa dados que essa forma de pagamento nao tem.`,
          );
      }
    }

    const emailTemplateIds = this.selected(steps, 'emailTemplateId');
    if (emailTemplateIds.length > 0) {
      const available = new Set(
        (await this.emailTemplatesService.findAll(companyId))
          .filter((template) => template.id && template.isActive)
          .map((template) => template.id),
      );
      if (emailTemplateIds.some((id) => !available.has(id))) {
        throw new BadRequestException(
          'Um ou mais templates de email nao estao disponiveis para esta empresa.',
        );
      }
    }
  }

  private selected(
    steps: CreateStepInput[],
    field: 'emailTemplateId',
  ): string[] {
    return Array.from(
      new Set(
        steps
          .map((step) => step[field])
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }

  private isTime(value: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }
}
