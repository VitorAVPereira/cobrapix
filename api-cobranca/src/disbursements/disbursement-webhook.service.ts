import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DISBURSEMENT_REASONS } from './disbursement-reasons';

export type SentPixResult =
  | 'APPLIED'
  // Repeated notice, or one about a refund (refunds are not handled in this version).
  | 'IGNORED'
  | 'UNKNOWN_SEND_ID'
  | 'SEND_KEY_MISMATCH'
  | 'SEND_STATUS_CONFLICT';

const IN_FLIGHT = ['SENDING', 'IN_PROCESSING', 'UNCERTAIN'] as const;

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim()
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : null;
}

/**
 * Result of a Pix sent by a collaborator payment (`tipo: SOLICITACAO`). Depends only on
 * persistence so the Pix webhook can use it without a module cycle. Transitions only leave
 * in-flight states: a paid or failed item never changes again.
 */
@Injectable()
export class DisbursementWebhookService {
  constructor(private readonly prisma: PrismaService) {}

  static isSentPix(event: Record<string, unknown>): event is Record<
    string,
    unknown
  > & {
    gnExtras: Record<string, unknown> & { idEnvio: string };
  } {
    const extras = event.gnExtras;
    return (
      event.tipo === 'SOLICITACAO' &&
      !!extras &&
      typeof extras === 'object' &&
      typeof (extras as Record<string, unknown>).idEnvio === 'string'
    );
  }

  async apply(
    event: Record<string, unknown> & {
      gnExtras: Record<string, unknown> & { idEnvio: string };
    },
  ): Promise<{ result: SentPixResult; companyId?: string }> {
    const idEnvio = event.gnExtras.idEnvio;
    const item = /^[0-9a-f]{32}$/.test(idEnvio)
      ? await this.prisma.disbursementItem.findUnique({
          where: { idEnvio },
          select: {
            id: true,
            companyId: true,
            status: true,
            batch: { select: { issuerIdentity: { select: { pixKey: true } } } },
          },
        })
      : null;
    // A send made outside CifraMais from the same account.
    if (!item) return { result: 'UNKNOWN_SEND_ID' };
    const companyId = item.companyId;
    // The notice must come from the paying key of the account frozen at the request.
    const pixKey = item.batch.issuerIdentity?.pixKey;
    if (!pixKey || event.chave !== pixKey)
      return { result: 'SEND_KEY_MISMATCH', companyId };
    if (Array.isArray(event.devolucoes) && event.devolucoes.length)
      return { result: 'IGNORED', companyId };
    const e2eId = text(event.endToEndId, 64);
    const where = { id: item.id, status: { in: [...IN_FLIGHT] } };
    let changed = 0;
    if (event.status === 'REALIZADO') {
      const at =
        typeof event.horario === 'string' ? new Date(event.horario) : null;
      changed = (
        await this.prisma.disbursementItem.updateMany({
          where,
          data: {
            status: 'PAID',
            ...(e2eId ? { e2eId } : {}),
            settledAt: at && !Number.isNaN(at.getTime()) ? at : new Date(),
          },
        })
      ).count;
      if (!changed && item.status !== 'PAID')
        return { result: 'SEND_STATUS_CONFLICT', companyId };
    } else if (event.status === 'NAO_REALIZADO') {
      const error = event.gnExtras.erro as Record<string, unknown> | undefined;
      changed = (
        await this.prisma.disbursementItem.updateMany({
          where,
          data: {
            status: 'FAILED',
            ...(e2eId ? { e2eId } : {}),
            failureCode: text(error?.codigo, 64) ?? 'NAO_REALIZADO',
            failureReason:
              text(error?.motivo, 300) ?? DISBURSEMENT_REASONS.NOT_REALIZED,
          },
        })
      ).count;
      if (!changed && item.status !== 'FAILED')
        return { result: 'SEND_STATUS_CONFLICT', companyId };
    } else return { result: 'IGNORED', companyId };
    return { result: changed ? 'APPLIED' : 'IGNORED', companyId };
  }
}
