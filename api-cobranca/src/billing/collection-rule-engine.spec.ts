import type { PrismaService } from '../prisma/prisma.service';
import {
  CollectionRuleEngine,
  initialRuleStep,
} from './collection-rule-engine';

const base = {
  templateId: null,
  emailTemplateId: null,
  whatsappSelectionMode: null,
  whatsappPurpose: null,
  sendTimeStart: null,
  sendTimeEnd: null,
  isActive: true,
};
/** "Inicial" e-mail and WhatsApp (day -30), then a WhatsApp step 5 days before due. */
const steps = [
  {
    ...base,
    id: 'inicial-email',
    stepOrder: 0,
    channel: 'EMAIL',
    delayDays: -30,
  },
  {
    ...base,
    id: 'inicial-whatsapp',
    stepOrder: 1,
    channel: 'WHATSAPP',
    delayDays: 0,
    whatsappSelectionMode: 'EXPLICIT',
    templateId: 'template-b',
  },
  {
    ...base,
    id: 'before-due',
    stepOrder: 2,
    channel: 'WHATSAPP',
    delayDays: 25,
    whatsappSelectionMode: 'DEFAULT',
    whatsappPurpose: 'BEFORE_DUE',
  },
] as const;

function setup() {
  const prisma = {
    collectionAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
    collectionLog: { findFirst: jest.fn().mockResolvedValue(null) },
    communicationOutboundIntent: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    whatsappTemplatePendingSend: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const engine = new CollectionRuleEngine(prisma as unknown as PrismaService);
  // Due in 10 days: every step up to "5 days before" is not due yet except the Inicial ones.
  const invoice = {
    id: 'invoice-1',
    companyId: 'company-1',
    dueDate: new Date(Date.now() + 10 * 86_400_000),
    debtor: {
      id: 'debtor-1',
      collectionProfileId: 'profile-1',
      collectionProfile: { id: 'profile-1', steps: [...steps] },
    },
  };
  return { engine, prisma, invoice };
}

describe('initialRuleStep', () => {
  it('finds the step of each channel at the emission day only', () => {
    expect(initialRuleStep(steps, 'EMAIL')?.id).toBe('inicial-email');
    expect(initialRuleStep(steps, 'WHATSAPP')?.id).toBe('inicial-whatsapp');
    // A profile whose first WhatsApp step is later has no "Inicial" WhatsApp step.
    expect(initialRuleStep([steps[0], steps[2]], 'WHATSAPP')).toBeNull();
    expect(
      initialRuleStep(
        [{ ...steps[1], isActive: false }, steps[0], steps[2]],
        'WHATSAPP',
      ),
    ).toBeNull();
    expect(initialRuleStep([], 'EMAIL')).toBeNull();
  });
});

describe('CollectionRuleEngine and the first message', () => {
  it('sends the Inicial steps when the charge had no first message', async () => {
    const { engine, invoice } = setup();
    await expect(engine.getNextStep(invoice)).resolves.toMatchObject({
      ruleStepId: 'inicial-email',
    });
  });

  it('skips the Inicial steps already fulfilled by the first message of an old charge', async () => {
    const { engine, prisma, invoice } = setup();
    prisma.collectionLog.findFirst.mockResolvedValue({ id: 'log-email' });
    prisma.communicationOutboundIntent.findFirst.mockResolvedValue({
      id: 'intent-initial',
    });
    // Neither Inicial step is sent again; the next one is not due yet.
    await expect(engine.getNextStep(invoice)).resolves.toBeNull();
    expect(prisma.collectionLog.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        actionType: 'EMAIL_QUEUED',
      },
      select: { id: true },
    });
    expect(prisma.communicationOutboundIntent.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        invoiceId: 'invoice-1',
        OR: [
          { logicalKey: 'collection:company-1:invoice-1:initial:WHATSAPP' },
          {
            logicalKey: {
              startsWith: 'collection:company-1:invoice-1:selected-',
            },
          },
        ],
      },
      select: { id: true },
    });
  });

  it('a held first message also fulfills the Inicial WhatsApp step', async () => {
    const { engine, prisma, invoice } = setup();
    prisma.collectionLog.findFirst.mockResolvedValue({ id: 'log-email' });
    prisma.whatsappTemplatePendingSend.findFirst.mockResolvedValue({
      id: 'pending-initial',
    });
    await expect(engine.getNextStep(invoice)).resolves.toBeNull();
  });

  it('only the Inicial steps are checked against the first message', async () => {
    const { engine, prisma, invoice } = setup();
    invoice.dueDate = new Date(Date.now() - 86_400_000);
    prisma.collectionAttempt.findFirst.mockImplementation(
      ({ where }: { where: { ruleStepId: string } }) =>
        Promise.resolve(
          where.ruleStepId.startsWith('inicial') ? { id: 'attempt' } : null,
        ),
    );
    await expect(engine.getNextStep(invoice)).resolves.toMatchObject({
      ruleStepId: 'before-due',
    });
    expect(prisma.collectionLog.findFirst).not.toHaveBeenCalled();
    expect(prisma.communicationOutboundIntent.findFirst).not.toHaveBeenCalled();
  });
});
