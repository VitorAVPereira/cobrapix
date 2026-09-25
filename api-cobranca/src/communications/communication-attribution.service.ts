import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  CommunicationAttributionMethod,
  CommunicationRecipientType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MessageContext, MessageContextInput } from './message-context';
import { reevaluateReplies, validateMessageContext } from './reply-attribution';

type AttributionActor =
  | { type: 'PLATFORM_ADMIN'; userId: string }
  | { type: 'SYSTEM' };

export interface AssignKnownContextInput {
  messageId: string;
  expectedRevision: number;
  expectedCompanyId: string | null;
  context: MessageContextInput;
  method: CommunicationAttributionMethod;
  actor: AttributionActor;
  reason: string;
}

/** Manual and system attribution with revision control and audit. Reference resolution: reply-attribution.ts. */
@Injectable()
export class CommunicationAttributionService {
  constructor(private readonly prisma: PrismaService) {}

  validateContext(
    tx: Prisma.TransactionClient,
    input: MessageContextInput,
    recipient: { hash: string; type: CommunicationRecipientType },
  ): Promise<MessageContext> {
    return validateMessageContext(tx, input, recipient);
  }

  async assignKnownContext(
    input: AssignKnownContextInput,
  ): Promise<{ messageId: string; revision: number; context: MessageContext }> {
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedCompanyId === undefined
    ) {
      throw new BadRequestException(
        'Revisao e contexto esperados sao obrigatorios',
      );
    }
    if (
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      input.reason.trim().length > 500
    ) {
      throw new BadRequestException('Informe um motivo de ate 500 caracteres');
    }
    if (!Object.values(CommunicationAttributionMethod).includes(input.method)) {
      throw new BadRequestException('Metodo de atribuicao invalido');
    }
    if (input.actor.type === 'SYSTEM' && input.method === 'MANUAL') {
      throw new ForbiddenException('Atribuicao manual exige administrador');
    }
    return this.prisma.$transaction(async (tx) => {
      if (input.actor.type === 'PLATFORM_ADMIN') {
        const actor = await tx.user.findUnique({
          where: { id: input.actor.userId },
          select: { role: true },
        });
        if (actor?.role !== 'PLATFORM_ADMIN' || input.method !== 'MANUAL') {
          throw new ForbiddenException(
            'Atribuicao exige administrador e metodo manual',
          );
        }
      } else if (input.actor.type !== 'SYSTEM') {
        throw new ForbiddenException('Ator de atribuicao invalido');
      }
      const message = await tx.communicationMessage.findFirst({
        where: { id: input.messageId, companyId: input.expectedCompanyId },
        include: {
          conversation: true,
          outboundIntent: { select: { id: true } },
        },
      });
      if (!message || message.attributionRevision !== input.expectedRevision) {
        throw new ConflictException(
          'A mensagem foi alterada; atualize os dados',
        );
      }
      if (message.outboundIntent)
        throw new ConflictException(
          'Contexto de uma intencao de envio e imutavel',
        );
      if (
        message.anonymizedAt ||
        message.conversation.recipientAnonymizedAt ||
        message.retentionExpiresAt <= new Date() ||
        message.conversation.retentionExpiresAt <= new Date()
      ) {
        throw new ConflictException('Mensagem fora do periodo de retencao');
      }
      if (message.conversation.channel !== 'WHATSAPP')
        throw new BadRequestException(
          'Contexto disponivel apenas para WhatsApp',
        );
      const context = await this.validateContext(tx, input.context, {
        hash: message.conversation.recipientHash,
        type:
          message.recipientType ??
          message.conversation.recipientType ??
          'PHONE',
      });
      if (input.method === 'UNASSIGNED' && context.companyId)
        throw new BadRequestException(
          'Metodo sem atribuicao exige contexto vazio',
        );
      const updated = await tx.communicationMessage.updateMany({
        where: {
          id: message.id,
          companyId: input.expectedCompanyId,
          attributionRevision: input.expectedRevision,
          anonymizedAt: null,
          retentionExpiresAt: { gt: new Date() },
        },
        data: {
          ...context,
          attributionMethod: input.method,
          attributionRevision: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          'A mensagem foi alterada; atualize os dados',
        );
      const revision = input.expectedRevision + 1;
      await tx.communicationAttributionAudit.create({
        data: {
          messageId: message.id,
          actorType: input.actor.type,
          actorUserId:
            input.actor.type === 'PLATFORM_ADMIN' ? input.actor.userId : null,
          method: input.method,
          oldContext: {
            companyId: message.companyId,
            invoiceId: message.invoiceId,
            debtorId: message.debtorId,
          },
          newContext: { ...context },
          reason: input.reason.trim(),
          revision,
        },
      });
      // Replies citing this message follow its new context within the same transaction.
      await reevaluateReplies(tx, message.id);
      return { messageId: message.id, revision, context };
    });
  }
}
