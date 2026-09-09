import { CollectionChannel, CollectionProfileType } from '@prisma/client';
import { CollectionProfileService } from './collection-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';

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
        isActive: boolean;
      }>;
    };
  };
}

function createService() {
  const prisma = {
    collectionProfile: {
      findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValue([]),
      create: jest.fn(async (args: CreatedProfileArgs) => ({
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
      })),
    },
  } as unknown as PrismaService;
  const templatesService = {
    ensureDefaultTemplates: jest.fn().mockResolvedValue(DEFAULT_TEMPLATES),
  } as unknown as TemplatesService;

  return {
    service: new CollectionProfileService(prisma, templatesService),
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
  it('garante templates padrao e aplica templateId conforme o dia da regua', async () => {
    const { service, prisma, templatesService } = createService();

    await service.listProfiles('company-1');

    expect(templatesService.ensureDefaultTemplates).toHaveBeenCalledWith(
      'company-1',
    );

    const firstCreate = prisma.collectionProfile.create.mock.calls[0]?.[0] as
      | CreatedProfileArgs
      | undefined;

    expect(firstCreate).toBeDefined();
    const steps = firstCreate?.data.steps.create ?? [];
    const days = getScheduleDays(steps);
    const templatesByDay = new Map(
      days.map((day, index) => [day, steps[index]?.templateId]),
    );

    expect(templatesByDay.get(-30)).toBe('template-emissao');
    expect(templatesByDay.get(-2)).toBe('template-pre');
    expect(templatesByDay.get(0)).toBe('template-vencimento');
    expect(templatesByDay.get(2)).toBe('template-primeiro-atraso');
    expect(templatesByDay.get(10)).toBe('template-recorrente');
    expect(templatesByDay.get(30)).toBe('template-critico');
  });
});
