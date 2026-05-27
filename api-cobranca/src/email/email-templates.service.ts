import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { EmailTemplate, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
}

@Injectable()
export class EmailTemplatesService {
  private readonly supportedVariableTags = new Set<string>(
    TEMPLATE_VARIABLE_TAGS,
  );

  constructor(private readonly prisma: PrismaService) {}

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
      where: { companyId, slug: { in: slugs } },
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

    if (existing) {
      throw new HttpException(
        `Template de email com slug "${dto.slug}" ja existe.`,
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.emailTemplate.create({
      data: {
        companyId,
        slug: dto.slug,
        name: definition?.name ?? dto.name,
        subject: dto.subject.trim(),
        content: dto.content.trim(),
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateEmailTemplateDto,
  ): Promise<EmailTemplate> {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id, companyId },
    });

    if (!template) {
      throw new HttpException(
        'Template de email nao encontrado.',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.subject !== undefined) this.validateTemplateText(dto.subject);
    if (dto.content !== undefined) this.validateTemplateText(dto.content);

    const data: Prisma.EmailTemplateUpdateInput = {
      ...(dto.subject !== undefined && { subject: dto.subject.trim() }),
      ...(dto.content !== undefined && { content: dto.content.trim() }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };

    return this.prisma.emailTemplate.update({
      where: { id },
      data,
    });
  }

  async findActiveOrDefault(
    companyId: string,
    slug: string | null,
  ): Promise<ResolvedEmailTemplate> {
    if (slug) {
      const template = await this.prisma.emailTemplate.findFirst({
        where: { companyId, slug, isActive: true },
        select: {
          id: true,
          slug: true,
          name: true,
          subject: true,
          content: true,
          isActive: true,
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
    };
  }

  private validateTemplateText(content: string): void {
    const variables = Array.from(
      content.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    ).map((match) => match[1]);
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
}
