import { ConfigService } from '@nestjs/config';
import { CentralOnboardingNotifications } from './central-onboarding-notifications';
import type { WhatsappService } from '../whatsapp/whatsapp.service';
import type { ResendMailerService } from '../common/resend-mailer.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TemplateSendPreparerService } from '../templates/template-send-preparer.service';

function setup() {
  const whatsapp = {
    dispatchIntent: jest
      .fn()
      .mockResolvedValue({ messageId: 'wamid.notice', status: 'accepted' }),
  };
  const sender = {
    prepare: jest
      .fn()
      .mockResolvedValue({ status: 'QUEUED', intentId: 'intent-1' }),
  };
  const prisma = {
    efiOnboarding: {
      findUnique: jest.fn().mockResolvedValue({ id: 'activation-1' }),
    },
  };
  const notifications = new CentralOnboardingNotifications(
    // Legacy env names must never choose the template any more.
    new ConfigService({ EFI_ONBOARDING_NOTICE_TEMPLATE: 'legacy_notice' }),
    whatsapp as unknown as WhatsappService,
    {} as ResendMailerService,
    prisma as unknown as PrismaService,
    sender as unknown as TemplateSendPreparerService,
  );
  return { notifications, whatsapp, sender };
}

describe('CentralOnboardingNotifications', () => {
  it('activation_uses_own_default with the validated activation context', async () => {
    const { notifications, sender, whatsapp } = setup();
    await expect(
      notifications.sendNotice('company-1', '5511999999999'),
    ).resolves.toBe('wamid.notice');
    const [activationRequest, options] = sender.prepare.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(activationRequest.selection).toEqual({
      mode: 'DEFAULT',
      purpose: 'ACTIVATION_NOTICE',
    });
    expect(activationRequest).toMatchObject({
      origin: 'ACTIVATION',
      context: { companyId: 'company-1', activationId: 'activation-1' },
    });
    expect(JSON.stringify(activationRequest)).not.toContain('legacy_notice');
    expect(options).toEqual({ renewAfterRejection: true });
    expect(whatsapp.dispatchIntent).toHaveBeenCalledWith('intent-1');
  });

  it('reminders use their own purpose, never a collection default', async () => {
    const { notifications, sender } = setup();
    await notifications.sendReminder('company-1');
    expect(sender.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { mode: 'DEFAULT', purpose: 'ACTIVATION_REMINDER' },
      }),
      { renewAfterRejection: true },
    );
  });

  it('a held notice is reported without transmitting', async () => {
    const { notifications, sender, whatsapp } = setup();
    sender.prepare.mockResolvedValue({
      status: 'BLOCKED',
      pendingId: 'pending-1',
      code: 'DEFAULT_MISSING',
    });
    await expect(
      notifications.sendNotice('company-1', '5511999999999'),
    ).rejects.toMatchObject({ status: 503 });
    expect(whatsapp.dispatchIntent).not.toHaveBeenCalled();
  });
});
