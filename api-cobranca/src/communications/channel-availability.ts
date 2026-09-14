import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function assertChannelAvailable(
  prisma: PrismaService,
  integration: 'META' | 'RESEND',
): Promise<void> {
  const state = await prisma.platformIntegrationState.findUnique({
    where: { integration },
  });
  // Existing centrally configured channels remain enabled until explicitly paused.
  if (state?.enabled === false)
    throw new ServiceUnavailableException({
      code: 'CENTRAL_CHANNEL_PAUSED',
      message: 'Este canal de comunicação está temporariamente pausado.',
    });
}
