import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeWhatsAppNumberForTransport } from '../common/whatsapp-number';
import { messageRecipient } from './message-context';

/** Global safety preference for the one shared number, independent of tenant authorization. */
export async function assertRecipientNotSuppressed(
  prisma: PrismaService,
  phoneNumber: string,
): Promise<void> {
  if (!/^\+?[\d().\s-]+$/.test(phoneNumber))
    throw new BadRequestException('Destinatario WhatsApp invalido');
  const recipient = messageRecipient({
    type: 'PHONE',
    value: normalizeWhatsAppNumberForTransport(phoneNumber),
  });
  const blocked = await prisma.communicationRecipientSuppression.findUnique({
    where: {
      channel_recipientHash: {
        channel: 'WHATSAPP',
        recipientHash: recipient.hash,
      },
    },
    select: { id: true },
  });
  if (blocked)
    throw new ConflictException({
      code: 'WHATSAPP_RECIPIENT_SUPPRESSED',
      message:
        'Destinatario pausado: solicitacao de cancelamento aguarda revisao administrativa.',
    });
}
