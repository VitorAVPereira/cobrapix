import { CollectionChannel, CollectionProfileType } from '@prisma/client';
import { CollectionProfileService } from './collection-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTemplatesService } from '../email/email-templates.service';

const EMAIL_KINDS = [
  { id: 'template-emissao', slug: 'cobranca-emissao' },
  { id: 'template-pre', slug: 'pre-vencimento' },
  { id: 'template-vencimento', slug: 'vencimento-hoje' },
  { id: 'template-primeiro-atraso', slug: 'atraso-primeiro-aviso' },
  { id: 'template-recorrente', slug: 'atraso-recorrente' },
  { id: 'template-critico', slug: 'atraso-critico' },
] as const;

interface CreatedProfileArgs {
  data: {
    companyId: string;
    name: string;
    profileType: CollectionProfileType;
    isDefault: boolean;
    isActive: boolean;
    daysOverdueMin: number | null;
    daysOverdueMax: number | null;
    steps: {
      create: Array<{
        stepOrder: number;
        channel: CollectionChannel;
        delayDays: number;
        templateId?: string;
        emailTemplateId?: string;
        whatsappSelectionMode?: string;
        whatsappPurpose?: string;
        isActive: boolean;
      }>;
    };
  };
}

function createService() {
  const prisma = {
    collectionProfile: {
      findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValue([]),
      create: jest.fn((args: CreatedProfileArgs) =>
        Promise.resolve({
          id: `${args.data.profileType.toLowerCase()}-profile`,
          companyId: args.data.companyId,
          name: args.data.name,
          profileType: args.data.profileType,
          isDefault: args.data.isDefault,
          isActive: args.data.isActive,
          daysOverdueMin: args.data.daysOverdueMin,
          daysOverdueMax: args.data.daysOverdueMax,
          steps: [],
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          updatedAt: new Date('2026-05-01T00:00:00.000Z'),
        }),
      ),
    },
  } as unknown as PrismaService;
  const emailTemplatesService = {
    ensureDefaultTemplates: jest.fn().mockResolvedValue(
      EMAIL_KINDS.map((template) => ({
        ...template,
        id: template.id.replace('template-', 'email-'),
      })),
    ),
  } as unknown as EmailTemplatesService;

  return {
    service: new CollectionProfileService(prisma, emailTemplatesService),
    prisma: prisma as unknown as {
      collectionProfile: {
        create: jest.Mock;
      };
    },
    emailTemplatesService: emailTemplatesService as unknown as {
      ensureDefaultTemplates: jest.Mock;
    },
  };
}

function getScheduleDays(
  steps: CreatedProfileArgs['data']['steps']['create'],
): number[] {
  let cumulativeDay = 0;

  return steps.map((step) => {
    cumulativeDay += step.delayDays;
    return cumulativeDay;
  });
}

describe('CollectionProfileService defaults', () => {
  it('garante templates padrao por canal conforme o dia da regua', async () => {
    const { service, prisma, emailTemplatesService } = createService();

    await service.listProfiles('company-1');

    expect(emailTemplatesService.ensureDefaultTemplates).toHaveBeenCalledWith(
      'company-1',
    );

    const create = prisma.collectionProfile.create as jest.Mock<
      Promise<unknown>,
      [CreatedProfileArgs]
    >;
    const firstCreate = create.mock.calls[0]?.[0];

    expect(firstCreate).toBeDefined();
    const steps = firstCreate?.data.steps.create ?? [];
    const days = getScheduleDays(steps);
    const selectedByDay = (channel: CollectionChannel) =>
      new Map(
        days
          .map((day, index) => [day, steps[index]] as const)
          .filter(([, step]) => step?.channel === channel)
          .map(([day, step]) => [
            day,
            channel === 'EMAIL' ? step?.emailTemplateId : step?.whatsappPurpose,
          ]),
      );
    const email = selectedByDay('EMAIL');
    const whatsapp = selectedByDay('WHATSAPP');

    // The emission message is asked for when registering the invoice, not by the rule.
    expect(days.some((day) => day <= -30)).toBe(false);
    expect([...new Set(days)]).toEqual([-3, 0, 2, 7, 15]);
    expect(email.get(0)).toBe('email-vencimento');
    expect(email.get(15)).toBe('email-recorrente');
    // WhatsApp steps follow the company's purpose default; no template is picked.
    expect(whatsapp.get(-3)).toBe('BEFORE_DUE');
    expect(whatsapp.get(0)).toBe('DUE_TODAY');
    expect(whatsapp.get(2)).toBe('FIRST_OVERDUE');
    expect(
      steps.every((step) =>
        step.channel === 'EMAIL'
          ? step.templateId === undefined &&
            step.whatsappSelectionMode === undefined
          : step.templateId === undefined &&
            step.emailTemplateId === undefined &&
            step.whatsappSelectionMode === 'DEFAULT',
      ),
    ).toBe(true);
  });
});

function stepsService(existing: Array<Record<string, unknown>> = []) {
  const stored = existing.map((step) => ({
    profileId: 'profile-1',
    stepOrder: 0,
    channel: 'WHATSAPP',
    templateId: null,
    emailTemplateId: null,
    whatsappSelectionMode: 'DEFAULT',
    whatsappPurpose: 'DUE_TODAY',
    pixTemplateId: null,
    boletoTemplateId: null,
    bolixTemplateId: null,
    cardTemplateId: null,
    delayDays: 0,
    sendTimeStart: null,
    sendTimeEnd: null,
    isActive: true,
    _count: { attempts: 0 },
    ...step,
  }));
  const written: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    collectionProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'profile-1' }),
    },
    collectionRuleStep: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(stored)
        .mockImplementation(() => Promise.resolve(written)),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          updates.push({ id: where.id, data });
          if ('channel' in data) written.push({ id: where.id, ...data });
          return Promise.resolve({});
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        written.push({ id: 'step-new', ...data });
        return Promise.resolve({});
      }),
    },
    collectionAttempt: {
      groupBy: jest.fn().mockResolvedValue([{ ruleStepId: 'step-1' }]),
    },
    collectionStepTemplateOverride: {
      findMany: jest.fn().mockResolvedValue([
        {
          ruleStepId: 'step-1',
          billingMethod: 'PIX',
          templateId: 'template-custom',
          template: { metaTemplateName: 'lembrete_escola', name: 'x' },
        },
      ]),
    },
  };
  Object.assign(prisma, {
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run(prisma)),
  });
  const service = new CollectionProfileService(
    prisma as unknown as PrismaService,
    {} as EmailTemplatesService,
  );
  return { service, prisma, written, updates };
}

describe('CollectionProfileService schedule without template choices', () => {
  it('a new WhatsApp step gets no template; choices sent by older screens are ignored', async () => {
    const { service, written } = stepsService([]);
    await service.setSteps('company-1', 'profile-1', [
      {
        stepOrder: 0,
        channel: 'WHATSAPP',
        delayDays: -2,
        whatsappSelection: { mode: 'EXPLICIT', templateId: 'template-old' },
        whatsappMethodTemplates: { PIX: 'template-old' },
      },
      {
        stepOrder: 1,
        channel: 'EMAIL',
        delayDays: 2,
        emailTemplateId: 'email-old',
      },
    ]);
    expect(written[0]).toMatchObject({
      channel: 'WHATSAPP',
      templateId: null,
      pixTemplateId: null,
      whatsappSelectionMode: 'DEFAULT',
      whatsappPurpose: 'BEFORE_DUE',
    });
    expect(written[1]).toMatchObject({
      channel: 'EMAIL',
      emailTemplateId: null,
      whatsappSelectionMode: null,
    });
  });

  it('a step already sent keeps its day and channel', async () => {
    const { service, written } = stepsService([
      { id: 'step-1', delayDays: 2, _count: { attempts: 3 } },
    ]);
    await expect(
      service.setSteps('company-1', 'profile-1', [
        { id: 'step-1', stepOrder: 0, channel: 'WHATSAPP', delayDays: 3 },
      ]),
    ).rejects.toThrow('A etapa do dia 2 ja foi enviada');
    await expect(
      stepsService([
        { id: 'step-1', delayDays: 2, _count: { attempts: 3 } },
      ]).service.setSteps('company-1', 'profile-1', [
        { id: 'step-1', stepOrder: 0, channel: 'EMAIL', delayDays: 2 },
      ]),
    ).rejects.toThrow('nao pode mudar de dia nem de canal');
    expect(written).toHaveLength(0);
  });

  it('new steps can be added around a step already sent, which keeps its id', async () => {
    const { service, written } = stepsService([
      { id: 'step-1', delayDays: 2, _count: { attempts: 3 } },
    ]);
    await service.setSteps('company-1', 'profile-1', [
      { stepOrder: 0, channel: 'EMAIL', delayDays: -1 },
      { id: 'step-1', stepOrder: 1, channel: 'WHATSAPP', delayDays: 3 },
    ]);
    expect(written.map((step) => step.id)).toEqual(['step-new', 'step-1']);
  });

  it('removing a step already sent retires it; a step never sent is deleted', async () => {
    const { service, prisma, updates } = stepsService([
      { id: 'step-1', stepOrder: 0, delayDays: 0, _count: { attempts: 1 } },
      { id: 'step-2', stepOrder: 1, delayDays: 2, _count: { attempts: 0 } },
    ]);
    await service.setSteps('company-1', 'profile-1', []);
    expect(updates).toContainEqual({
      id: 'step-1',
      data: { isActive: false, stepOrder: -1001 },
    });
    expect(prisma.collectionRuleStep.delete).toHaveBeenCalledWith({
      where: { id: 'step-2' },
    });
  });

  it('presents the day, whether the step was sent and its custom templates', async () => {
    const { service } = stepsService([]);
    const [presented] = await service.setSteps('company-1', 'profile-1', [
      { stepOrder: 0, channel: 'WHATSAPP', delayDays: -3 },
    ]);
    expect(presented).toMatchObject({ scheduleDay: -3, attempted: false });
    expect(presented?.customTemplates).toEqual([]);
  });
});
