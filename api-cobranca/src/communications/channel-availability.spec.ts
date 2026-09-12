import { PrismaService } from '../prisma/prisma.service';
import { assertChannelAvailable } from './channel-availability';

describe('central channel operational pause', () => {
  it.each(['META', 'RESEND'] as const)(
    'blocks %s when an administrator pauses it',
    async (integration) => {
      const prisma = {
        platformIntegrationState: {
          findUnique: jest.fn().mockResolvedValue({ enabled: false }),
        },
      };
      await expect(
        assertChannelAvailable(prisma as unknown as PrismaService, integration),
      ).rejects.toMatchObject({ status: 503 });
      expect(prisma.platformIntegrationState.findUnique).toHaveBeenCalledWith({
        where: { integration },
      });
    },
  );
  it('keeps a configured preexisting channel available without a pause record', async () => {
    const prisma = {
      platformIntegrationState: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    await expect(
      assertChannelAvailable(prisma as unknown as PrismaService, 'META'),
    ).resolves.toBeUndefined();
  });
});
