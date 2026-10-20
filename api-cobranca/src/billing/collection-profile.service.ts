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
import {
  TemplateBlockCode,
  TemplateSelection,
} from '../templates/template-contracts';
import {
  MethodTemplates,
  purposeForScheduleDay,
  ruleStepSelection,
  stepMethodTemplates,
} from '../templates/template-selection';

interface CreateProfileInput {
  name: string;
  profileType: CollectionProfileType;
  isDefault?: boolean;
  daysOverdueMin?: number;
  daysOverdueMax?: number;
}

interface CreateStepInput {
  /** Stable ID of an existing step: it keeps the step's history. */
  id?: string;
  stepOrder: number;
  channel: CollectionChannel;
  /** Older screens still send template choices; they are ignored (chosen when sending). */
  emailTemplateId?: string;
  whatsappSelection?: TemplateSelection;
  whatsappMethodTemplates?: MethodTemplates;
  delayDays: number;
  sendTimeStart?: string;
  sendTimeEnd?: string;
}

type TemplateStatus = { ready: boolean; code: TemplateBlockCode | null };

/** Step as returned to the company: its day, whether it was sent and its custom templates. */
export type PresentedStep = CollectionRuleStep & {
  /** Cumulative day relative to the due date. */
  scheduleDay: number;
  /** Some invoice already got it: its day and channel are fixed. */
  attempted: boolean;
  /** Templates linked by the platform to this step after a support request. */
  customTemplates: Array<{
    billingMethod: BillingMethod;
    templateId: string;
    templateName: string;
  }>;
  /** Former selection fields, kept only for screens not yet replaced. */
  whatsappSelection: TemplateSelection | null;
  whatsappStatus: TemplateStatus | null;
  whatsappMethodTemplates: MethodTemplates | null;
  whatsappMethodStatus: Partial<Record<BillingMethod, TemplateStatus>> | null;
  /** Methods without their own template whose charges lack data the step's template reads. */
  whatsappIncompatibleMethods: BillingMethod[] | null;
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
    private readonly emailTemplatesService: EmailTemplatesService,
  ) {}

  async listProfiles(companyId: string) {
    await this.ensureStandardProfiles(companyId);

    const profiles = await this.prisma.collectionProfile.findMany({
      where: { companyId, isActive: true },
      include: {
        steps: { where: { isActive: true }, orderBy: { stepOrder: 'asc' } },
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
      include: {
        steps: { where: { isActive: true }, orderBy: { stepOrder: 'asc' } },
      },
    });
    return profile
      ? { ...profile, steps: await this.presentSteps(companyId, profile.steps) }
      : null;
  }

  /**
   * Steps as the company reads them: the cumulative day relative to the due date, whether
   * an invoice already got the step (its day and channel are then fixed) and the custom
   * templates the platform linked to it. The template itself is chosen when sending, by
   * the moment and the charge's payment method. The former selection fields stay only
   * so older screens keep working while they are replaced.
   */
  private async presentSteps(
    companyId: string,
    steps: CollectionRuleStep[],
  ): Promise<PresentedStep[]> {
    const ids = steps.map((step) => step.id);
    const [attempted, overrides] = await Promise.all([
      this.prisma.collectionAttempt.groupBy({
        by: ['ruleStepId'],
        where: { companyId, ruleStepId: { in: ids } },
      }),
      this.prisma.collectionStepTemplateOverride.findMany({
        where: { companyId, ruleStepId: { in: ids } },
        include: {
          template: { select: { metaTemplateName: true, name: true } },
        },
      }),
    ]);
    const used = new Set(attempted.map((row) => row.ruleStepId));
    let day = 0;
    return [...steps]
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map((step) => {
        day += step.delayDays;
        const whatsapp = step.channel === 'WHATSAPP';
        return {
          ...step,
          scheduleDay: day,
          attempted: used.has(step.id),
          customTemplates: overrides
            .filter((override) => override.ruleStepId === step.id)
            .map((override) => ({
              billingMethod: override.billingMethod,
              templateId: override.templateId,
              templateName:
                override.template.metaTemplateName ?? override.template.name,
            })),
          whatsappSelection: whatsapp ? ruleStepSelection(step) : null,
          whatsappStatus: whatsapp ? { ready: true, code: null } : null,
          whatsappMethodTemplates: whatsapp ? stepMethodTemplates(step) : null,
          whatsappMethodStatus: whatsapp ? {} : null,
          whatsappIncompatibleMethods: whatsapp ? [] : null,
        };
      });
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
      include: {
        steps: { where: { isActive: true }, orderBy: { stepOrder: 'asc' } },
      },
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

  /**
   * Saves the schedule of a profile. Templates are not chosen here anymore: any template
   * field sent by an older screen is ignored. A step some invoice already got keeps its
   * day and channel (its history and dedup refer to it); removing it only retires it.
   * Steps nobody got yet can change freely.
   */
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

    this.validateSteps(steps);

    const existing = await this.prisma.collectionRuleStep.findMany({
      where: { profileId },
      include: { _count: { select: { attempts: true } } },
      orderBy: { stepOrder: 'asc' },
    });
    const active = existing.filter((step) => step.isActive);
    const usedDay = new Map<string, number>();
    let day = 0;
    for (const step of active) {
      day += step.delayDays;
      if (step._count.attempts > 0) usedDay.set(step.id, day);
    }
    const incoming = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const incomingDay = new Map<CreateStepInput, number>();
    day = 0;
    for (const step of incoming) {
      day += step.delayDays;
      incomingDay.set(step, day);
    }

    for (const step of incoming) {
      const previous = step.id
        ? active.find((item) => item.id === step.id)
        : undefined;
      const sentDay = previous ? usedDay.get(previous.id) : undefined;
      if (
        previous &&
        sentDay !== undefined &&
        (previous.channel !== step.channel || sentDay !== incomingDay.get(step))
      )
        throw new BadRequestException(
          `A etapa do dia ${sentDay} ja foi enviada: ela nao pode mudar de dia nem de canal. Remova-a e crie outra.`,
        );
    }

    // Steps sent back with their ID keep it (holds, keys and attempts refer to it).
    const keptIds = new Set(
      incoming.flatMap((step) =>
        step.id && active.some((item) => item.id === step.id) ? [step.id] : [],
      ),
    );
    const removed = active.filter((step) => !keptIds.has(step.id));
    let retiredOrder = Math.min(
      -1000,
      ...existing.map((step) => step.stepOrder),
    );

    await this.prisma.$transaction(async (tx) => {
      for (const step of removed) {
        if (step._count.attempts > 0)
          await tx.collectionRuleStep.update({
            where: { id: step.id },
            data: { isActive: false, stepOrder: --retiredOrder },
          });
        else await tx.collectionRuleStep.delete({ where: { id: step.id } });
      }
      // Temporary orders avoid transient (profile, order, channel) collisions on reorder.
      for (const [index, id] of [...keptIds].entries())
        await tx.collectionRuleStep.update({
          where: { id },
          data: { stepOrder: -1 - index },
        });
      const used = new Set<string>();
      for (const step of incoming) {
        const scheduleDay = incomingDay.get(step)!;
        const data = {
          stepOrder: step.stepOrder,
          channel: step.channel,
          delayDays: step.delayDays,
          sendTimeStart: step.sendTimeStart || null,
          sendTimeEnd: step.sendTimeEnd || null,
          isActive: true,
        };
        const previous =
          step.id && keptIds.has(step.id) && !used.has(step.id)
            ? active.find((item) => item.id === step.id)
            : undefined;
        if (previous) {
          used.add(previous.id);
          await tx.collectionRuleStep.update({
            where: { id: previous.id },
            data: {
              ...data,
              ...(previous.channel === step.channel
                ? {}
                : this.channelColumns(step.channel, scheduleDay)),
            },
          });
        } else
          await tx.collectionRuleStep.create({
            data: {
              profileId,
              ...data,
              ...this.channelColumns(step.channel, scheduleDay),
            },
          });
      }
    });

    return this.presentSteps(
      companyId,
      await this.prisma.collectionRuleStep.findMany({
        where: { profileId, isActive: true },
        orderBy: { stepOrder: 'asc' },
      }),
    );
  }

  /**
   * Template columns of a new step: nothing chosen. WhatsApp keeps the purpose of its day
   * only to satisfy the existing database checks; sending computes the moment itself.
   */
  private channelColumns(
    channel: CollectionChannel,
    scheduleDay: number,
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
    return {
      templateId: null,
      emailTemplateId: null,
      whatsappSelectionMode: channel === 'WHATSAPP' ? 'DEFAULT' : null,
      whatsappPurpose:
        channel === 'WHATSAPP' ? purposeForScheduleDay(scheduleDay) : null,
      pixTemplateId: null,
      boletoTemplateId: null,
      bolixTemplateId: null,
      cardTemplateId: null,
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

  private validateSteps(steps: CreateStepInput[]): void {
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
  }

  private isTime(value: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }
}
