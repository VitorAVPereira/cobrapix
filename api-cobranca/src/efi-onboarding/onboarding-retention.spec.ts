import { PrismaService } from '../prisma/prisma.service';
import { OnboardingRetention } from './onboarding-retention';

describe('onboarding and communication retention', () => {
  it('purges every page of expired recipients and clears all representative fields', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: String(index).padStart(4, '0'),
    }));
    const onboardingUpdate = jest.fn().mockResolvedValue({ count: 2 });
    const conversationUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const conversations = jest
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: '1000' }]);
    const prisma = {
      efiOnboarding: { updateMany: onboardingUpdate },
      communicationMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1001 }),
      },
      communicationConversation: {
        findMany: conversations,
        updateMany: conversationUpdate,
      },
      auditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await new OnboardingRetention(prisma as unknown as PrismaService).purge();
    expect(conversations).toHaveBeenCalledTimes(2);
    expect(conversationUpdate).toHaveBeenCalledTimes(1001);
    const updates = conversationUpdate.mock.calls as Array<
      [
        {
          data: {
            recipientHash: string;
            recipientEncrypted: null;
            lastMessagePreview: null;
          };
        },
      ]
    >;
    expect(
      new Set(updates.map(([input]) => input.data.recipientHash)).size,
    ).toBe(1001);
    expect(updates[0]?.[0].data.recipientEncrypted).toBeNull();
    expect(updates[0]?.[0].data.lastMessagePreview).toBeNull();
    const calls = onboardingUpdate.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(calls[0]?.[0].data).toMatchObject({
      representativeNameEncrypted: null,
      representativeCpfEncrypted: null,
      representativeBirthDateEncrypted: null,
      representativeMotherNameEncrypted: null,
      representativeEmailEncrypted: null,
      representativePhoneEncrypted: null,
      sensitiveDataKeyVersion: null,
    });
  });
});
