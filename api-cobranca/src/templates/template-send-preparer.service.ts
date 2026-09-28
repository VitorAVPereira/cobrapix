import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { OutboundIntentService } from '../communications/outbound-intent.service';
import { TemplatePendingService } from '../communications/template-pending.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateContextService } from './template-context.service';
import {
  ReadyTemplate,
  TemplateBlockCode,
  TemplateSendRequest,
} from './template-contracts';
import { lockLogicalKey } from './template-locks';
import { TemplatePolicyService } from './template-policy.service';
import { renderSend, reserveTemplateIntent } from './template-reservation';

type Tx = Prisma.TransactionClient;

export type PrepareResult =
  | { status: 'QUEUED'; intentId: string }
  | { status: 'BLOCKED'; pendingId: string; code: TemplateBlockCode | null };

export interface PrepareOptions {
  /**
   * After a definitive rejection that never reached the provider, prepare the next
   * generation of the same communication (daily activation notices). Never after an
   * accepted, uncertain or in-flight attempt.
   */
  renewAfterRejection?: boolean;
}

/**
 * Single entry point for template sends: policy, trusted context, rendering and the
 * reservation in one transaction serialized by the logical key. It never transmits and
 * never picks another template; a refusal becomes a persistent hold (admin replies get
 * an immediate error instead, since the admin is present to act on it).
 */
@Injectable()
export class TemplateSendPreparerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: PaymentCryptoService,
    private readonly intents: OutboundIntentService,
    private readonly pending: TemplatePendingService,
    private readonly policy: TemplatePolicyService,
    private readonly context: TemplateContextService,
  ) {}

  async prepare(
    request: TemplateSendRequest,
    options: PrepareOptions = {},
  ): Promise<PrepareResult> {
    if (
      !request.logicalKey ||
      request.logicalKey.length > 180 ||
      !request.context.companyId
    )
      throw new BadRequestException('Envio de template inválido.');
    return this.prisma.$transaction(
      async (tx) => {
        await lockLogicalKey(tx, request.logicalKey);
        const hold = await this.pending.findByLogicalKey(
          tx,
          request.logicalKey,
        );
        if (hold)
          return hold.state === 'RESUMED' && hold.currentIntentId
            ? { status: 'QUEUED' as const, intentId: hold.currentIntentId }
            : { status: 'BLOCKED' as const, pendingId: hold.id, code: null };
        // Repeated producers return what already exists for this communication.
        const previous = await tx.communicationOutboundIntent.findFirst({
          where: {
            OR: [
              { logicalKey: request.logicalKey },
              { idempotencyKey: request.logicalKey },
            ],
          },
          orderBy: [{ generation: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            state: true,
            transmission: true,
            generation: true,
          },
        });
        let generation = 0;
        if (previous) {
          const renew =
            options.renewAfterRejection &&
            previous.state === 'FAILED' &&
            previous.transmission === 'NOT_SENT';
          if (!renew)
            return { status: 'QUEUED' as const, intentId: previous.id };
          generation = previous.generation + 1;
        }
        const decision = await this.policy.resolve(
          tx,
          request.context.companyId,
          request.selection,
        );
        if (!decision.allowed) return this.refuse(tx, request, decision.code);
        return this.reserve(tx, request, decision.template, generation);
      },
      { timeout: 15_000 },
    );
  }

  private async reserve(
    tx: Tx,
    request: TemplateSendRequest,
    template: ReadyTemplate,
    generation: number,
  ): Promise<PrepareResult> {
    const rendered = await renderSend(
      this.context,
      this.crypto,
      tx,
      request,
      template,
    );
    if (!rendered.ok) {
      // The admin is present: context errors (wrong invoice or company) answer directly.
      if (request.origin === 'ADMIN_REPLY' && rendered.cause instanceof Error)
        throw rendered.cause;
      return this.refuse(tx, request, rendered.code, template, rendered.field);
    }
    const intentId = await reserveTemplateIntent(
      {
        intents: this.intents,
        crypto: this.crypto,
        transportChannelId: this.config.getOrThrow<string>(
          'META_PHONE_NUMBER_ID',
        ),
      },
      tx,
      {
        request,
        template,
        rendered,
        idempotencyKey: generation
          ? `${request.logicalKey}#${generation}`
          : request.logicalKey,
        generation,
      },
    );
    return { status: 'QUEUED', intentId };
  }

  private async refuse(
    tx: Tx,
    request: TemplateSendRequest,
    code: TemplateBlockCode,
    template?: ReadyTemplate,
    field?: string,
  ): Promise<PrepareResult> {
    if (request.origin === 'ADMIN_REPLY')
      throw new HttpException(
        {
          code,
          ...(field ? { field } : {}),
          message:
            code === 'VALUE_MISSING'
              ? 'Faltam dados do contexto para preencher o template.'
              : 'Template indisponível para a empresa selecionada.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const hold = await this.pending.block(tx, {
      request,
      code,
      ...(template ? { snapshot: template.snapshot } : {}),
    });
    return { status: 'BLOCKED', pendingId: hold.id, code };
  }
}
