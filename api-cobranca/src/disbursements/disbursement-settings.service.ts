import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DisbursementSettings, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialEligibilityService } from '../financial-activation/financial-eligibility.service';
import { TemplatePolicyService } from '../templates/template-policy.service';
import {
  DISBURSEMENT_PURPOSES,
  TemplateBlockCode,
} from '../templates/template-contracts';
import { decisionLabels } from '../templates/template-renderer';
import { DisbursementSettingsDto } from './dto/disbursement-settings.dto';

const TEMPLATE_LABELS: Record<(typeof DISBURSEMENT_PURPOSES)[number], string> =
  {
    DISBURSEMENT_APPROVAL: 'Pedido de aprovação',
    DISBURSEMENT_EXPIRED: 'Lote expirado',
    DISBURSEMENT_FAILED: 'Falhas no lote',
  };
const BLOCK_REASONS: Partial<Record<TemplateBlockCode, string>> = {
  DEFAULT_MISSING: 'sem template padrão definido para a empresa',
  NOT_GRANTED: 'template não liberado para a empresa',
  NOT_APPROVED: 'template não aprovado na Meta',
  UNSUPPORTED: 'template com formato não suportado',
  REVIEW_REQUIRED: 'mapeamento pendente de revisão',
};

type Client = Prisma.TransactionClient | PrismaService;
export interface ReadinessItem {
  code: string;
  message: string;
}
export interface DisbursementReadiness {
  ready: boolean;
  missing: ReadinessItem[];
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

@Injectable()
export class DisbursementSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: FinancialEligibilityService,
    private readonly policy: TemplatePolicyService,
  ) {}

  /** The highest version is the current one; older versions are the change history. */
  current(
    companyId: string,
    client: Client = this.prisma,
  ): Promise<DisbursementSettings | null> {
    return client.disbursementSettings.findFirst({
      where: { companyId },
      orderBy: { version: 'desc' },
    });
  }

  /** Company routes answer as if the feature did not exist while it is not enabled. */
  async assertEnabled(companyId: string): Promise<DisbursementSettings> {
    const current = await this.current(companyId);
    if (!current?.enabled)
      throw new NotFoundException(
        'Pagamentos a colaboradores não estão disponíveis.',
      );
    return current;
  }

  /** What the company may see: the approver's name and a masked phone, never the number. */
  async companyStatus(companyId: string) {
    const current = await this.current(companyId);
    if (!current?.enabled)
      return { enabled: false, approverName: null, approverPhoneMasked: null };
    const phone = current.approverPhone;
    return {
      enabled: true,
      approverName: current.approverName,
      approverPhoneMasked: `(${phone.slice(2, 4)}) •••••-${phone.slice(-4)}`,
    };
  }

  async view(companyId: string) {
    await this.assertCompany(companyId);
    const [history, readiness] = await Promise.all([
      this.prisma.disbursementSettings.findMany({
        where: { companyId },
        orderBy: { version: 'desc' },
        take: 20,
      }),
      this.readiness(companyId),
    ]);
    return { current: history[0] ?? null, history, readiness };
  }

  /** Payments leave the company's own Efí account (phase A), from its Pix key. */
  async readiness(companyId: string): Promise<DisbursementReadiness> {
    const missing: ReadinessItem[] = [];
    try {
      const profile = await this.eligibility.resolveIssuance(companyId);
      if (
        profile.accountMode !== 'CUSTOMER_ACCOUNT' ||
        profile.payoutMode !== 'DIRECT_TO_CUSTOMER'
      )
        missing.push({
          code: 'FINANCIAL_MODE_NOT_SUPPORTED',
          message:
            'Pagamentos a colaboradores exigem a conta Efí da própria empresa.',
        });
      else {
        const identity = await this.prisma.efiAccountIdentity.findFirst({
          where: {
            id: profile.issuerIdentityId,
            companyId,
            ownership: 'COMPANY',
          },
          select: { pixKey: true },
        });
        if (!identity?.pixKey)
          missing.push({
            code: 'PIX_KEY_MISSING',
            message: 'A conta Efí ativa não tem chave Pix cadastrada.',
          });
      }
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const response = error.getResponse() as Partial<ReadinessItem>;
      missing.push({
        code: response.code ?? 'FINANCIAL_PROFILE_NOT_READY',
        message: response.message ?? 'Ativação financeira indisponível.',
      });
    }
    // Without these messages nothing could be approved, expired or reported.
    for (const purpose of DISBURSEMENT_PURPOSES) {
      const decision = await this.prisma.$transaction((tx) =>
        this.policy.resolve(tx, companyId, { mode: 'DEFAULT', purpose }),
      );
      if (!decision.allowed)
        missing.push({
          code: 'TEMPLATE_UNAVAILABLE',
          message: `Template "${TEMPLATE_LABELS[purpose]}": ${BLOCK_REASONS[decision.code] ?? decision.code}.`,
        });
      else if (
        purpose === 'DISBURSEMENT_APPROVAL' &&
        !decisionLabels(
          decision.template.parsed,
          decision.template.mapping.decisionButtons,
        )
      )
        missing.push({
          code: 'TEMPLATE_DECISION_BUTTONS',
          message:
            'O template de pedido de aprovação precisa dos botões de aprovar e recusar mapeados.',
        });
    }
    return { ready: missing.length === 0, missing };
  }

  async configure(
    companyId: string,
    userId: string,
    dto: DisbursementSettingsDto,
  ): Promise<DisbursementSettings> {
    await this.assertCompany(companyId);
    if (dto.enabled) {
      const readiness = await this.readiness(companyId);
      if (!readiness.ready)
        throw new ConflictException({
          code: 'DISBURSEMENT_NOT_READY',
          message:
            'A empresa ainda não está pronta para pagamentos a colaboradores.',
          missing: readiness.missing,
        });
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`;
      const current = await this.current(companyId, tx);
      if ((current?.version ?? 0) !== dto.expectedVersion)
        conflict(
          'VERSION_CHANGED',
          'Configuração alterada. Recarregue os dados.',
        );
      const settings = await tx.disbursementSettings.create({
        data: {
          companyId,
          version: (current?.version ?? 0) + 1,
          enabled: dto.enabled,
          approverName: dto.approverName.trim(),
          approverPhone: dto.approverPhone,
          changedByUserId: userId,
        },
      });
      if (!dto.enabled) await this.cancelUnsent(tx, companyId);
      // A request sent to the previous approver can no longer authorize a payment.
      else if (current && current.approverPhone !== dto.approverPhone)
        await this.returnPendingRequestsToDraft(tx, companyId);
      return settings;
    });
  }

  /** Items already sent stay under verification: money may have left the account. */
  private async cancelUnsent(tx: Prisma.TransactionClient, companyId: string) {
    await tx.disbursementItem.updateMany({
      where: {
        companyId,
        status: 'PENDING',
        batch: { status: { in: ['AWAITING_APPROVAL', 'PROCESSING'] } },
      },
      data: { status: 'CANCELED' },
    });
    await tx.disbursementApproval.updateMany({
      where: { companyId, state: 'AWAITING' },
      data: { state: 'INVALIDATED' },
    });
    await tx.disbursementBatch.updateMany({
      where: { companyId, status: 'AWAITING_APPROVAL' },
      data: { status: 'CANCELED', version: { increment: 1 } },
    });
    // Nothing may ask for approval by itself when the feature is turned back on.
    await tx.disbursementBatch.updateMany({
      where: { companyId, status: 'SCHEDULED' },
      data: {
        status: 'DRAFT',
        scheduleProblem:
          'Os pagamentos a colaboradores foram desligados. Agende de novo quando forem religados.',
        version: { increment: 1 },
      },
    });
    await tx.disbursementSchedule.updateMany({
      where: { companyId, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date(), version: { increment: 1 } },
    });
  }

  private async returnPendingRequestsToDraft(
    tx: Prisma.TransactionClient,
    companyId: string,
  ) {
    await tx.disbursementApproval.updateMany({
      where: { companyId, state: 'AWAITING' },
      data: { state: 'INVALIDATED' },
    });
    await tx.disbursementBatch.updateMany({
      where: { companyId, status: 'AWAITING_APPROVAL' },
      data: { status: 'DRAFT', version: { increment: 1 } },
    });
  }

  private async assertCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
  }
}
