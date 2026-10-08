import { CollectionChannel, CollectionProfileType } from '@prisma/client';
import { CollectionProfileService } from './collection-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatePolicyService } from '../templates/template-policy.service';
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
  const policy = { resolve: jest.fn() } as unknown as TemplatePolicyService;
  const emailTemplatesService = {
    ensureDefaultTemplates: jest.fn().mockResolvedValue(
      EMAIL_KINDS.map((template) => ({
        ...template,
        id: template.id.replace('template-', 'email-'),
      })),
    ),
  } as unknown as EmailTemplatesService;

  return {
    service: new CollectionProfileService(
      prisma,
      policy,
      emailTemplatesService,
    ),
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

    expect(email.get(-30)).toBe('email-emissao');
    expect(email.get(-2)).toBe('email-pre');
    expect(email.get(0)).toBe('email-vencimento');
    expect(email.get(2)).toBe('email-primeiro-atraso');
    expect(email.get(30)).toBe('email-critico');
    // WhatsApp steps follow the company's purpose default; no template is picked.
    expect(whatsapp.get(0)).toBe('DUE_TODAY');
    expect(whatsapp.get(4)).toBe('RECURRING_OVERDUE');
    expect(whatsapp.get(20)).toBe('RECURRING_OVERDUE');
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

/** Ready decision of a template whose mapping reads the given sources. */
function ready(templateId: string, sources: string[]) {
  return {
    allowed: true,
    template: {
      snapshot: { templateId },
      mapping: {
        body: Object.fromEntries(
          sources.map((source, index) => [
            String(index + 1),
            { kind: 'SOURCE', source },
          ]),
        ),
      },
    },
  };
}

function stepsService(existing: Array<Record<string, unknown>> = []) {
  const stored = existing.map((step) => ({
    profileId: 'profile-1',
    templateId: null,
    emailTemplateId: null,
    whatsappSelectionMode: 'DEFAULT',
    whatsappPurpose: 'DUE_TODAY',
    pixTemplateId: null,
    boletoTemplateId: null,
    bolixTemplateId: null,
    delayDays: 0,
    sendTimeStart: null,
    sendTimeEnd: null,
    isActive: true,
    _count: { attempts: 0 },
    ...step,
  }));
  const written: Array<Record<string, unknown>> = [];
  const prisma = {
    collectionProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'profile-1' }),
    },
    collectionRuleStep: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(stored)
        .mockImplementation(() => Promise.resolve(written)),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if ('channel' in data) written.push({ id: 'step-1', ...data });
        return Promise.resolve({});
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        written.push({ id: 'step-new', ...data });
        return Promise.resolve({});
      }),
    },
  };
  Object.assign(prisma, {
    $transaction: jest.fn((run: (tx: unknown) => unknown) => run(prisma)),
  });
  const catalog: Record<string, unknown> = {
    'template-base': ready('template-base', ['DEBTOR_NAME', 'PIX_COPY_PASTE']),
    'template-bolix': ready('template-bolix', [
      'PIX_COPY_PASTE',
      'BOLETO_LINE',
    ]),
    'template-boleto': ready('template-boleto', ['BOLETO_LINE']),
  };
  const policy = {
    resolve: jest.fn(
      (_tx: unknown, _company: string, selection: { templateId?: string }) =>
        Promise.resolve(
          (selection.templateId && catalog[selection.templateId]) ?? {
            allowed: false,
            code: 'NOT_GRANTED',
          },
        ),
    ),
  };
  const service = new CollectionProfileService(
    prisma as unknown as PrismaService,
    policy as unknown as TemplatePolicyService,
    {} as EmailTemplatesService,
  );
  return { service, prisma, policy, written };
}

const whatsappStep = {
  id: 'step-1',
  stepOrder: 0,
  channel: 'WHATSAPP' as const,
  delayDays: -30,
  whatsappSelection: { mode: 'EXPLICIT' as const, templateId: 'template-base' },
};

describe('CollectionProfileService templates by billing method', () => {
  it('saves a template per billing method and shows each status', async () => {
    const { service, written } = stepsService([{ id: 'step-1' }]);
    const [presented] = await service.setSteps('company-1', 'profile-1', [
      {
        ...whatsappStep,
        whatsappMethodTemplates: {
          BOLIX: 'template-bolix',
          BOLETO: 'template-boleto',
        },
      },
    ]);
    expect(written[0]).toMatchObject({
      templateId: 'template-base',
      pixTemplateId: null,
      boletoTemplateId: 'template-boleto',
      bolixTemplateId: 'template-bolix',
    });
    expect(presented).toMatchObject({
      whatsappMethodTemplates: {
        PIX: null,
        BOLETO: 'template-boleto',
        BOLIX: 'template-bolix',
      },
      whatsappMethodStatus: {
        BOLETO: { ready: true, code: null },
        BOLIX: { ready: true, code: null },
      },
      whatsappIncompatibleMethods: ['CREDIT_CARD'],
    });
  });

  it('warns which methods cannot fill the step template', async () => {
    const { service } = stepsService([{ id: 'step-1' }]);
    const [presented] = await service.setSteps('company-1', 'profile-1', [
      whatsappStep,
    ]);
    // The base template reads the Pix code: a boleto charge would stay pending.
    expect(presented?.whatsappIncompatibleMethods).toEqual([
      'BOLETO',
      'CREDIT_CARD',
    ]);
  });

  it('refuses a template that reads data the billing method never has', async () => {
    const { service, written } = stepsService([{ id: 'step-1' }]);
    await expect(
      service.setSteps('company-1', 'profile-1', [
        { ...whatsappStep, whatsappMethodTemplates: { PIX: 'template-bolix' } },
      ]),
    ).rejects.toThrow('O template escolhido para Pix usa dados');
    expect(written).toHaveLength(0);
  });

  it('refuses a template not available to the company', async () => {
    const { service } = stepsService([{ id: 'step-1' }]);
    await expect(
      service.setSteps('company-1', 'profile-1', [
        {
          ...whatsappStep,
          whatsappMethodTemplates: { BOLIX: 'template-other' },
        },
      ]),
    ).rejects.toThrow('nao estao disponiveis');
  });

  it('an older client without the field keeps the choices; null clears one', async () => {
    const existing = [{ id: 'step-1', bolixTemplateId: 'template-bolix' }];
    const kept = stepsService(existing);
    await kept.service.setSteps('company-1', 'profile-1', [whatsappStep]);
    expect(kept.written[0]).toMatchObject({
      bolixTemplateId: 'template-bolix',
    });

    const cleared = stepsService(existing);
    await cleared.service.setSteps('company-1', 'profile-1', [
      { ...whatsappStep, whatsappMethodTemplates: { BOLIX: null } },
    ]);
    expect(cleared.written[0]).toMatchObject({ bolixTemplateId: null });
  });

  it('e-mail steps never take WhatsApp templates by billing method', async () => {
    const { service } = stepsService([]);
    await expect(
      service.setSteps('company-1', 'profile-1', [
        {
          stepOrder: 0,
          channel: 'EMAIL',
          delayDays: -30,
          whatsappMethodTemplates: { PIX: 'template-base' },
        },
      ]),
    ).rejects.toThrow('nao corresponde ao canal');
  });
});
