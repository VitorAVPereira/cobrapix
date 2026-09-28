import { CollectionChannel, CollectionProfileType } from '@prisma/client';
import { CollectionProfileService } from './collection-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { EmailTemplatesService } from '../email/email-templates.service';

const DEFAULT_TEMPLATES = [
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
  const templatesService = {
    ensureDefaultTemplates: jest.fn().mockResolvedValue(DEFAULT_TEMPLATES),
  } as unknown as TemplatesService;
  const emailTemplatesService = {
    ensureDefaultTemplates: jest.fn().mockResolvedValue(
      DEFAULT_TEMPLATES.map((template) => ({
        ...template,
        id: template.id.replace('template-', 'email-'),
      })),
    ),
  } as unknown as EmailTemplatesService;

  return {
    service: new CollectionProfileService(
      prisma,
      templatesService,
      emailTemplatesService,
    ),
    prisma: prisma as unknown as {
      collectionProfile: {
        create: jest.Mock;
      };
    },
    templatesService: templatesService as unknown as {
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
    const { service, prisma, templatesService } = createService();

    await service.listProfiles('company-1');

    expect(templatesService.ensureDefaultTemplates).toHaveBeenCalledWith(
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
            channel === 'EMAIL' ? step?.emailTemplateId : step?.templateId,
          ]),
      );
    const email = selectedByDay('EMAIL');
    const whatsapp = selectedByDay('WHATSAPP');

    expect(email.get(-30)).toBe('email-emissao');
    expect(email.get(-2)).toBe('email-pre');
    expect(email.get(0)).toBe('email-vencimento');
    expect(email.get(2)).toBe('email-primeiro-atraso');
    expect(email.get(30)).toBe('email-critico');
    expect(whatsapp.get(0)).toBe('template-vencimento');
    expect(whatsapp.get(10)).toBe('template-recorrente');
    expect(whatsapp.get(20)).toBe('template-recorrente');
    // Each channel only references its own catalog.
    expect(
      steps.every((step) =>
        step.channel === 'EMAIL'
          ? step.templateId === undefined
          : step.emailTemplateId === undefined,
      ),
    ).toBe(true);
  });
});
