import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingMethod,
  TemplateRequestStatus,
  WhatsappTemplatePurpose,
} from '@prisma/client';
import { ResendMailerService } from '../common/resend-mailer.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateTemplateRequestInput {
  ruleStepId?: string;
  purpose?: WhatsappTemplatePurpose;
  billingMethod?: BillingMethod;
  message: string;
}

const STATUS_LABELS: Record<TemplateRequestStatus, string> = {
  OPEN: 'Recebido',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluído',
  REJECTED: 'Não atendido',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Support requests for a custom WhatsApp template. The company only creates and reads its
 * own (company from the JWT); the platform admin lists all and moves their status with an
 * expected version. The admin is told by e-mail; a failed e-mail never loses the request,
 * which stays listed in the admin panel.
 */
@Injectable()
export class TemplateRequestService {
  private readonly logger = new Logger(TemplateRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: ResendMailerService,
  ) {}

  async create(
    companyId: string,
    userId: string,
    input: CreateTemplateRequestInput,
  ) {
    if (input.ruleStepId) {
      const step = await this.prisma.collectionRuleStep.findFirst({
        where: { id: input.ruleStepId, profile: { companyId } },
        select: { id: true },
      });
      if (!step) throw new NotFoundException('Etapa não encontrada.');
    }
    const request = await this.prisma.templateRequest.create({
      data: {
        companyId,
        requestedByUserId: userId,
        ruleStepId: input.ruleStepId ?? null,
        purpose: input.purpose ?? null,
        billingMethod: input.billingMethod ?? null,
        message: input.message.trim(),
      },
      include: {
        company: { select: { corporateName: true, tradeName: true } },
      },
    });
    await this.notifyAdmin(request).catch((error: unknown) =>
      this.logger.warn(
        `Aviso do pedido de template ${request.id} não enviado: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      ),
    );
    return this.view(request);
  }

  async listForCompany(companyId: string) {
    const rows = await this.prisma.templateRequest.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.view(row));
  }

  async listForAdmin(status?: TemplateRequestStatus) {
    const rows = await this.prisma.templateRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        company: { select: { corporateName: true, tradeName: true } },
      },
    });
    return rows.map((row) => ({
      ...this.view(row),
      companyId: row.companyId,
      companyName: row.company.tradeName ?? row.company.corporateName,
    }));
  }

  async updateStatus(
    id: string,
    status: TemplateRequestStatus,
    adminNote: string | null,
    expectedVersion: number,
  ) {
    const updated = await this.prisma.templateRequest.updateMany({
      where: { id, version: expectedVersion },
      data: {
        status,
        adminNote: adminNote?.trim() || null,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      const exists = await this.prisma.templateRequest.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Pedido não encontrado.');
      throw new ConflictException({
        code: 'VERSION_CHANGED',
        message: 'O pedido mudou. Atualize a lista.',
      });
    }
    return this.view(
      await this.prisma.templateRequest.findUniqueOrThrow({ where: { id } }),
    );
  }

  private view(row: {
    id: string;
    ruleStepId: string | null;
    purpose: WhatsappTemplatePurpose | null;
    billingMethod: BillingMethod | null;
    message: string;
    status: TemplateRequestStatus;
    adminNote: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      ruleStepId: row.ruleStepId,
      purpose: row.purpose,
      billingMethod: row.billingMethod,
      message: row.message,
      status: row.status,
      adminNote: row.adminNote,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async notifyAdmin(request: {
    id: string;
    message: string;
    purpose: WhatsappTemplatePurpose | null;
    billingMethod: BillingMethod | null;
    status: TemplateRequestStatus;
    company: { corporateName: string; tradeName: string | null };
  }): Promise<void> {
    const required = (name: string) => {
      const value = this.config.get<string>(name)?.trim();
      if (!value) throw new Error(`${name} não configurada.`);
      return value;
    };
    const company = request.company.tradeName ?? request.company.corporateName;
    await this.mailer.sendEmail({
      apiKey: required('RESEND_API_KEY'),
      from: required('RESEND_FROM_EMAIL'),
      replyTo: required('RESEND_REPLY_TO'),
      to: [required('PLATFORM_ALERT_EMAIL')],
      subject: `Pedido de template personalizado: ${company}`,
      html: [
        `<p>Empresa: ${escapeHtml(company)}</p>`,
        request.purpose ? `<p>Momento: ${request.purpose}</p>` : '',
        request.billingMethod
          ? `<p>Forma de pagamento: ${request.billingMethod}</p>`
          : '',
        `<p>Situação: ${STATUS_LABELS[request.status]}</p>`,
        `<p style="white-space:pre-line">${escapeHtml(request.message)}</p>`,
        '<p>Responda pelo painel administrativo da CifraMais (Catálogo de templates → Solicitações).</p>',
      ].join(''),
      idempotencyKey: `template-request-${request.id}`,
    });
  }
}
