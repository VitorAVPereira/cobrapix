import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { EmailTemplate, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatResendFromAddress,
  type ResendTemplatePayload,
  type ResendTemplateVariableInput,
  ResendMailerService,
} from '../common/resend-mailer.service';
import { PaymentCryptoService } from '../payment/payment-crypto.service';
import { CreateEmailTemplateDto, UpdateEmailTemplateDto } from './dto';
import {
  DEFAULT_EMAIL_TEMPLATE_DEFINITION,
  EMAIL_TEMPLATE_DEFINITIONS,
  TEMPLATE_VARIABLE_TAGS,
  getEmailTemplateDefinition,
} from './email-template-catalog';

export interface ResolvedEmailTemplate {
  id: string | null;
  slug: string;
  name: string;
  subject: string;
  content: string;
  isActive: boolean;
  resendTemplateId: string | null;
  resendAlias: string | null;
}

interface CompanyResendConfig {
  corporateName: string;
  resendApiKeyEncrypted: string | null;
  resendFromEmail: string | null;
}

interface SyncableEmailTemplate {
  name: string;
  slug: string;
  subject: string;
  content: string;
  resendTemplateId: string | null;
  resendAlias: string | null;
}

interface ResendSyncFields {
  resendTemplateId: string;
  resendAlias: string;
  resendStatus: string;
  resendPublishedAt: Date;
  lastResendSyncAt: Date;
  resendError: null;
}

@Injectable()
export class EmailTemplatesService {
  private readonly supportedVariableTags = new Set<string>(
    TEMPLATE_VARIABLE_TAGS,
  );
  private readonly fallbackByVariable: Record<string, string> = {
    nome_devedor: 'Cliente',
    nome_empresa: 'Empresa',
    valor: 'R$ 0,00',
    data_vencimento: '01/01/2026',
    metodo_pagamento: 'PIX',
    payment_link: 'https://cobrapix.com/pagar',
    pix_copia_e_cola: '00020101021226860014br.gov.bcb.pix',
    boleto_linha_digitavel:
      '00000.00000 00000.000000 00000.000000 0 00000000000000',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PaymentCryptoService,
    private readonly resendMailer: ResendMailerService,
  ) {}

  async findAll(companyId: string): Promise<EmailTemplate[]> {
    return this.ensureDefaultTemplates(companyId);
  }

  async ensureDefaultTemplates(companyId: string): Promise<EmailTemplate[]> {
    const slugs = EMAIL_TEMPLATE_DEFINITIONS.map(
      (definition) => definition.slug,
    );
    const existingTemplates = await this.prisma.emailTemplate.findMany({
      where: { companyId, slug: { in: slugs } },
      select: { slug: true },
    });
    const existingSlugs = new Set(
      existingTemplates.map((template) => template.slug),
    );
    const missingTemplates = EMAIL_TEMPLATE_DEFINITIONS.filter(
      (definition) => !existingSlugs.has(definition.slug),
    );

    if (missingTemplates.length > 0) {
      await this.prisma.emailTemplate.createMany({
        data: missingTemplates.map((definition) => ({
          companyId,
          slug: definition.slug,
          name: definition.name,
          subject: definition.subject,
          content: definition.content,
          isActive: true,
        })),
        skipDuplicates: true,
      });
    }

    return this.prisma.emailTemplate.findMany({
      where: { companyId, slug: { in: slugs }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    companyId: string,
    dto: CreateEmailTemplateDto,
  ): Promise<EmailTemplate> {
    this.validateTemplateText(dto.subject);
    this.validateTemplateText(dto.content);

    const definition = getEmailTemplateDefinition(dto.slug);
    const existing = await this.prisma.emailTemplate.findFirst({
      where: { companyId, slug: dto.slug },
    });

    if (existing && !existing.deletedAt) {
      throw new HttpException(
        `Template de email com slug "${dto.slug}" ja existe.`,
        HttpStatus.CONFLICT,
      );
    }

    const name = definition?.name ?? dto.name.trim();
    const subject = dto.subject.trim();
    const content = dto.content.trim();
    const syncFields = await this.syncTemplateToResend(companyId, {
      name,
      slug: dto.slug,
      subject,
      content,
      resendTemplateId: existing?.resendTemplateId ?? null,
      resendAlias: existing?.resendAlias ?? null,
    });

    if (existing?.deletedAt) {
      await this.prisma.emailTemplate.updateMany({
        where: { id: existing.id, companyId },
        data: {
          name,
          subject,
          content,
          isActive: dto.isActive ?? true,
          deletedAt: null,
          ...syncFields,
        },
      });

      return this.findOneOrThrow(companyId, existing.id);
    }

    return this.prisma.emailTemplate.create({
      data: {
        companyId,
        slug: dto.slug,
        name,
        subject,
        content,
        isActive: dto.isActive ?? true,
        ...syncFields,
      },
    });
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateEmailTemplateDto,
  ): Promise<EmailTemplate> {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id, companyId, deletedAt: null },
    });

    if (!template) {
      throw new HttpException(
        'Template de email nao encontrado.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.subject !== undefined) this.validateTemplateText(dto.subject);
    if (dto.content !== undefined) this.validateTemplateText(dto.content);
    if (dto.slug && dto.slug !== template.slug) {
      const existing = await this.prisma.emailTemplate.findFirst({
        where: { companyId, slug: dto.slug, deletedAt: null },
      });

      if (existing) {
        throw new HttpException(
          `Template de email com slug "${dto.slug}" ja existe.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const nextSlug = dto.slug ?? template.slug;
    const definition = getEmailTemplateDefinition(nextSlug);
    const nextTemplate: SyncableEmailTemplate = {
      name: definition?.name ?? dto.name?.trim() ?? template.name,
      slug: nextSlug,
      subject: dto.subject?.trim() ?? template.subject,
      content: dto.content?.trim() ?? template.content,
      resendTemplateId: template.resendTemplateId,
      resendAlias: template.resendAlias,
    };
    const shouldSyncResend =
      dto.name !== undefined ||
      dto.slug !== undefined ||
      dto.subject !== undefined ||
      dto.content !== undefined ||
      !template.resendTemplateId;
    const syncFields = shouldSyncResend
      ? await this.syncTemplateToResend(companyId, nextTemplate)
      : {};

    const data: Prisma.EmailTemplateUpdateManyMutationInput = {
      ...(dto.name !== undefined && { name: nextTemplate.name }),
      ...(dto.slug !== undefined && { slug: nextSlug }),
      ...(dto.subject !== undefined && { subject: nextTemplate.subject }),
      ...(dto.content !== undefined && { content: nextTemplate.content }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...syncFields,
    };

    await this.prisma.emailTemplate.updateMany({
      where: { id, companyId },
      data,
    });

    return this.findOneOrThrow(companyId, id);
  }

  async remove(companyId: string, id: string): Promise<{ deleted: true }> {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id, companyId, deletedAt: null },
    });

    if (!template) {
      throw new HttpException(
        'Template de email nao encontrado.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (template.resendTemplateId || template.resendAlias) {
      const apiKey = await this.getResendApiKey(companyId);
      await this.resendMailer.deleteTemplate({
        apiKey,
        idOrAlias: template.resendTemplateId ?? template.resendAlias ?? id,
      });
    }

    const deletedAt = new Date();
    await this.prisma.emailTemplate.updateMany({
      where: { id, companyId },
      data: {
        deletedAt,
        isActive: false,
        resendStatus: 'deleted',
        lastResendSyncAt: deletedAt,
        resendError: null,
      },
    });

    return { deleted: true };
  }

  async publish(companyId: string, id: string): Promise<EmailTemplate> {
    const template = await this.findOneOrThrow(companyId, id);
    const syncFields = await this.syncTemplateToResend(companyId, template);

    await this.prisma.emailTemplate.updateMany({
      where: { id, companyId },
      data: syncFields,
    });

    return this.findOneOrThrow(companyId, id);
  }

  async findActiveOrDefault(
    companyId: string,
    slug: string | null,
  ): Promise<ResolvedEmailTemplate> {
    if (slug) {
      const template = await this.prisma.emailTemplate.findFirst({
        where: { companyId, slug, isActive: true, deletedAt: null },
        select: {
          id: true,
          slug: true,
          name: true,
          subject: true,
          content: true,
          isActive: true,
          resendTemplateId: true,
          resendAlias: true,
        },
      });

      if (template) return template;
    }

    const definition =
      (slug ? getEmailTemplateDefinition(slug) : null) ??
      DEFAULT_EMAIL_TEMPLATE_DEFINITION;

    return {
      id: null,
      slug: definition.slug,
      name: definition.name,
      subject: definition.subject,
      content: definition.content,
      isActive: true,
      resendTemplateId: null,
      resendAlias: null,
    };
  }

  private async findOneOrThrow(
    companyId: string,
    id: string,
  ): Promise<EmailTemplate> {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id, companyId, deletedAt: null },
    });

    if (!template) {
      throw new HttpException(
        'Template de email nao encontrado.',
        HttpStatus.NOT_FOUND,
      );
    }

    return template;
  }

  private async syncTemplateToResend(
    companyId: string,
    template: SyncableEmailTemplate,
  ): Promise<ResendSyncFields> {
    const company = await this.getCompanyResendConfig(companyId);
    const apiKey = this.crypto.decrypt(company.resendApiKeyEncrypted);
    const alias = template.resendAlias ?? this.buildResendAlias(template.slug);
    const payload = this.buildResendTemplatePayload(apiKey, company, {
      ...template,
      resendAlias: alias,
    });
    const result = template.resendTemplateId
      ? await this.resendMailer.updateTemplate({
          ...payload,
          idOrAlias: template.resendTemplateId,
        })
      : await this.resendMailer.createTemplate(payload);

    await this.resendMailer.publishTemplate({
      apiKey,
      idOrAlias: result.id,
    });

    const syncedAt = new Date();

    return {
      resendTemplateId: result.id,
      resendAlias: alias,
      resendStatus: 'published',
      resendPublishedAt: syncedAt,
      lastResendSyncAt: syncedAt,
      resendError: null,
    };
  }

  private async getCompanyResendConfig(
    companyId: string,
  ): Promise<CompanyResendConfig & { resendApiKeyEncrypted: string }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        corporateName: true,
        resendApiKeyEncrypted: true,
        resendFromEmail: true,
      },
    });

    if (!company?.resendApiKeyEncrypted) {
      throw new Error('Resend API key nao configurada para esta empresa.');
    }

    if (!company.resendFromEmail) {
      throw new Error('Remetente Resend nao configurado para esta empresa.');
    }

    return {
      corporateName: company.corporateName,
      resendApiKeyEncrypted: company.resendApiKeyEncrypted,
      resendFromEmail: company.resendFromEmail,
    };
  }

  private async getResendApiKey(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { resendApiKeyEncrypted: true },
    });

    if (!company?.resendApiKeyEncrypted) {
      throw new Error('Resend API key nao configurada para esta empresa.');
    }

    return this.crypto.decrypt(company.resendApiKeyEncrypted);
  }

  private buildResendTemplatePayload(
    apiKey: string,
    company: CompanyResendConfig,
    template: SyncableEmailTemplate,
  ): ResendTemplatePayload {
    return {
      apiKey,
      name: template.name,
      alias: template.resendAlias ?? this.buildResendAlias(template.slug),
      from: formatResendFromAddress(
        company.corporateName,
        company.resendFromEmail ?? '',
      ),
      subject: this.toResendTemplateSyntax(template.subject),
      html: this.buildResendHtml(template.content),
      text: this.toResendTemplateSyntax(template.content),
      variables: this.extractResendVariables(
        template.subject,
        template.content,
      ),
    };
  }

  private buildResendHtml(content: string): string {
    return this.toResendTemplateSyntax(this.escapeHtml(content))
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0)
      .map(
        (paragraph) =>
          `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;white-space:pre-line">${paragraph}</p>`,
      )
      .join('');
  }

  private extractResendVariables(
    subject: string,
    content: string,
  ): ResendTemplateVariableInput[] {
    const variables = Array.from(
      `${subject}\n${content}`.matchAll(
        /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      ),
    )
      .map((match) => match[1])
      .filter((variable): variable is string => typeof variable === 'string');
    const uniqueVariables = Array.from(new Set(variables));

    return uniqueVariables.map((variable) => ({
      key: this.toResendVariableKey(variable),
      type: 'string',
      fallbackValue: this.fallbackByVariable[variable] ?? '',
    }));
  }

  private toResendTemplateSyntax(content: string): string {
    return content.replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (_match: string, variable: string): string =>
        `{{{${this.toResendVariableKey(variable)}}}}`,
    );
  }

  private toResendVariableKey(variable: string): string {
    return variable.trim().toUpperCase();
  }

  private buildResendAlias(slug: string): string {
    return `cobrapix_${slug.replace(/[^a-zA-Z0-9]+/g, '_')}`;
  }

  private validateTemplateText(content: string): void {
    const variables = Array.from(
      content.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    )
      .map((match) => match[1])
      .filter((variable): variable is string => typeof variable === 'string');
    const unsupported = variables.find(
      (variable) => !this.supportedVariableTags.has(variable),
    );

    if (unsupported) {
      throw new HttpException(
        `Placeholder nao suportado: {{${unsupported}}}.`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
