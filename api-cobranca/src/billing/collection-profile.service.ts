import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CollectionChannel, CollectionProfileType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface CreateProfileInput {
  name: string;
  profileType: CollectionProfileType;
  isDefault?: boolean;
  daysOverdueMin?: number;
  daysOverdueMax?: number;
}

interface CreateStepInput {
  stepOrder: number;
  channel: CollectionChannel;
  templateId?: string;
  delayDays: number;
  sendTimeStart?: string;
  sendTimeEnd?: string;
}

interface StandardProfileStep {
  day: number;
  channel: CollectionChannel;
}

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

  constructor(private readonly prisma: PrismaService) {}

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

    return profiles.sort((a, b) => {
      const order =
        PROFILE_TYPE_ORDER[a.profileType] - PROFILE_TYPE_ORDER[b.profileType];
      if (order !== 0) return order;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }

  async getProfile(companyId: string, profileId: string) {
    return this.prisma.collectionProfile.findFirst({
      where: { id: profileId, companyId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
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

    await this.validateSteps(companyId, steps);

    const attemptedStepIds = await this.prisma.collectionRuleStep.findMany({
      where: {
        profileId,
        attempts: { some: {} },
      },
      select: { id: true },
      take: 1,
    });

    if (attemptedStepIds.length > 0) {
      throw new BadRequestException(
        'Este perfil ja possui tentativas registradas. Crie um novo perfil para alterar a regua sem perder historico.',
      );
    }

    await this.prisma.collectionRuleStep.deleteMany({
      where: { profileId },
    });

    if (steps.length === 0) {
      return [];
    }

    await this.prisma.collectionRuleStep.createMany({
      data: steps.map((step) => ({
        profileId,
        stepOrder: step.stepOrder,
        channel: step.channel,
        templateId: step.templateId || null,
        delayDays: step.delayDays,
        sendTimeStart: step.sendTimeStart || null,
        sendTimeEnd: step.sendTimeEnd || null,
        isActive: true,
      })),
    });

    return this.prisma.collectionRuleStep.findMany({
      where: { profileId },
      orderBy: { stepOrder: 'asc' },
    });
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

      const createdProfile = await this.prisma.collectionProfile.create({
        data: {
          companyId,
          name: standardProfile.name,
          profileType: standardProfile.profileType,
          isDefault: standardProfile.isDefault && !hasDefault,
          isActive: true,
          daysOverdueMin: standardProfile.daysOverdueMin,
          daysOverdueMax: standardProfile.daysOverdueMax,
          steps: {
            create: this.buildStandardStepRows(standardProfile.steps),
          },
        },
        include: { steps: { select: { id: true } } },
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
    );

    return normalizedProfile;
  }

  private async ensureStandardSteps(
    companyId: string,
    profile: ExistingProfile,
    standardSteps: readonly StandardProfileStep[],
    shouldReplaceExistingSteps: boolean,
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
      data: this.buildStandardStepRows(standardSteps).map((step) => ({
        ...step,
        profileId: profile.id,
      })),
    });
  }

  private buildStandardStepRows(steps: readonly StandardProfileStep[]): Array<{
    stepOrder: number;
    channel: CollectionChannel;
    delayDays: number;
    isActive: boolean;
  }> {
    let previousDay = 0;

    return steps.map((step, index) => {
      const delayDays = index === 0 ? step.day : step.day - previousDay;
      previousDay = step.day;

      return {
        stepOrder: index,
        channel: step.channel,
        delayDays,
        isActive: true,
      };
    });
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

    const templateIds = Array.from(
      new Set(
        steps
          .map((step) => step.templateId)
          .filter((templateId): templateId is string => Boolean(templateId)),
      ),
    );

    if (templateIds.length === 0) {
      return;
    }

    const templates = await this.prisma.messageTemplate.count({
      where: { companyId, id: { in: templateIds }, isActive: true },
    });

    if (templates !== templateIds.length) {
      throw new BadRequestException(
        'Um ou mais templates nao pertencem a esta empresa.',
      );
    }
  }

  private isTime(value: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }
}
