import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class CollectionProfileService {
  private readonly logger = new Logger(CollectionProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listProfiles(companyId: string) {
    return this.prisma.collectionProfile.findMany({
      where: { companyId, isActive: true },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        _count: { select: { debtors: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
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
      if (
        profile.daysOverdueMin === null &&
        profile.daysOverdueMax === null
      ) {
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

  private async validateSteps(
    companyId: string,
    steps: CreateStepInput[],
  ): Promise<void> {
    const seen = new Set<string>();

    for (const step of steps) {
      if (step.delayDays < -30 || step.delayDays > 365) {
        throw new BadRequestException('Delay da etapa fora do intervalo permitido.');
      }

      if (step.sendTimeStart && !this.isTime(step.sendTimeStart)) {
        throw new BadRequestException('Horario inicial invalido.');
      }

      if (step.sendTimeEnd && !this.isTime(step.sendTimeEnd)) {
        throw new BadRequestException('Horario final invalido.');
      }

      const key = `${step.stepOrder}:${step.channel}`;
      if (seen.has(key)) {
        throw new BadRequestException('Etapas duplicadas para a mesma ordem e canal.');
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
