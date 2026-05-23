import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { MessageTemplate, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';
import {
  getTemplateDefinition,
  TEMPLATE_DEFINITIONS,
  TEMPLATE_VARIABLE_TAGS,
} from './template-catalog';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private readonly supportedVariableTags = new Set<string>(
    TEMPLATE_VARIABLE_TAGS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async create(
    companyId: string,
    dto: CreateTemplateDto,
  ): Promise<MessageTemplate> {
    this.validateTemplateContent(dto.content);
    if (dto.footerText !== undefined) {
      this.validateTemplateContent(dto.footerText);
    }
    const definition = getTemplateDefinition(dto.slug);
    const existing = await this.prisma.messageTemplate.findFirst({
      where: { companyId, slug: dto.slug },
    });

    if (existing) {
      throw new HttpException(
        `Template com slug "${dto.slug}" ja existe.`,
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.messageTemplate.create({
      data: {
        name: definition?.name ?? dto.name,
        slug: dto.slug,
        content: dto.content,
        footerText: dto.footerText ?? definition?.footerText ?? null,
        paymentButtonEnabled:
          dto.paymentButtonEnabled ?? definition?.paymentButtonEnabled ?? true,
        paymentButtonLabel:
          dto.paymentButtonLabel ??
          definition?.paymentButtonLabel ??
          'Abrir pagamento',
        copyCodeButtonEnabled:
          dto.copyCodeButtonEnabled ??
          definition?.copyCodeButtonEnabled ??
          false,
        copyCodeSource:
          dto.copyCodeSource ?? definition?.copyCodeSource ?? 'AUTO',
        isActive: dto.isActive ?? true,
        metaTemplateName:
          dto.metaTemplateName ??
          this.whatsappService.buildMetaTemplateName(dto.slug),
        metaLanguage: dto.metaLanguage ?? 'pt_BR',
        category: dto.category ?? 'UTILITY',
        companyId,
      },
    });
  }

  async findAll(companyId: string): Promise<MessageTemplate[]> {
    await this.ensureDefaultTemplates(companyId);

    return this.prisma.messageTemplate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async ensureDefaultTemplates(companyId: string): Promise<MessageTemplate[]> {
    const slugs = TEMPLATE_DEFINITIONS.map((definition) => definition.slug);
    const existingTemplates = await this.prisma.messageTemplate.findMany({
      where: {
        companyId,
        slug: { in: slugs },
      },
      select: { slug: true },
    });
    const existingSlugs = new Set(
      existingTemplates.map((template) => template.slug),
    );
    const missingTemplates = TEMPLATE_DEFINITIONS.filter(
      (definition) => !existingSlugs.has(definition.slug),
    );

    if (missingTemplates.length > 0) {
      await this.prisma.messageTemplate.createMany({
        data: missingTemplates.map((definition) =>
          this.buildDefaultTemplateCreateInput(companyId, definition),
        ),
        skipDuplicates: true,
      });
    }

    return this.prisma.messageTemplate.findMany({
      where: {
        companyId,
        slug: { in: slugs },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(companyId: string, id: string): Promise<MessageTemplate> {
    const template = await this.prisma.messageTemplate.findFirst({
      where: { id, companyId },
    });

    if (!template) {
      throw new HttpException('Template nao encontrado.', HttpStatus.NOT_FOUND);
    }

    return template;
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTemplateDto,
  ): Promise<MessageTemplate> {
    const template = await this.prisma.messageTemplate.findFirst({
      where: { id, companyId },
    });

    if (!template) {
      throw new HttpException('Template nao encontrado.', HttpStatus.NOT_FOUND);
    }

    if (dto.content !== undefined) {
      this.validateTemplateContent(dto.content);
    }

    if (dto.footerText !== undefined) {
      this.validateTemplateContent(dto.footerText);
    }

    if (dto.slug && dto.slug !== template.slug) {
      const existing = await this.prisma.messageTemplate.findFirst({
        where: { companyId, slug: dto.slug },
      });

      if (existing) {
        throw new HttpException(
          `Template com slug "${dto.slug}" ja existe.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const nextSlug = dto.slug ?? template.slug;
    const definition = getTemplateDefinition(nextSlug);
    const componentChanged =
      dto.content !== undefined ||
      dto.footerText !== undefined ||
      dto.paymentButtonEnabled !== undefined ||
      dto.paymentButtonLabel !== undefined ||
      dto.copyCodeButtonEnabled !== undefined ||
      dto.copyCodeSource !== undefined;

    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        name: definition?.name ?? dto.name ?? template.name,
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.footerText !== undefined && {
          footerText: dto.footerText.trim() || null,
        }),
        ...(dto.paymentButtonEnabled !== undefined && {
          paymentButtonEnabled: dto.paymentButtonEnabled,
        }),
        ...(dto.paymentButtonLabel !== undefined && {
          paymentButtonLabel:
            dto.paymentButtonLabel.trim() || 'Abrir pagamento',
        }),
        ...(dto.copyCodeButtonEnabled !== undefined && {
          copyCodeButtonEnabled: dto.copyCodeButtonEnabled,
        }),
        ...(dto.copyCodeSource !== undefined && {
          copyCodeSource: dto.copyCodeSource,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.metaTemplateName !== undefined && {
          metaTemplateName: dto.metaTemplateName,
        }),
        ...(dto.metaLanguage !== undefined && {
          metaLanguage: dto.metaLanguage,
        }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(componentChanged && {
          metaStatus: 'LOCAL',
          metaRejectedReason: null,
        }),
      },
    });
  }

  async submitToMeta(
    companyId: string,
    id: string,
  ): Promise<{ template: MessageTemplate; meta: unknown }> {
    const template = await this.findOne(companyId, id);
    const meta = await this.whatsappService.createOfficialTemplate({
      companyId,
      template,
    });
    const updated = await this.findOne(companyId, id);

    return { template: updated, meta };
  }

  private validateTemplateContent(content: string): void {
    const variables = Array.from(
      content.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    )
      .map((match) => match[1])
      .filter((variable): variable is string => typeof variable === 'string');
    const invalidVariables = Array.from(
      new Set(
        variables.filter(
          (variable) => !this.supportedVariableTags.has(variable),
        ),
      ),
    );

    if (invalidVariables.length === 0) {
      return;
    }

    this.logger.warn(
      `Template rejeitado com variaveis nao suportadas: ${invalidVariables.join(', ')}`,
    );

    throw new HttpException(
      `Variaveis nao suportadas: ${invalidVariables
        .map((variable) => `{{${variable}}}`)
        .join(', ')}.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  private buildDefaultTemplateCreateInput(
    companyId: string,
    definition: (typeof TEMPLATE_DEFINITIONS)[number],
  ): Prisma.MessageTemplateCreateManyInput {
    return {
      name: definition.name,
      slug: definition.slug,
      content: definition.defaultContent,
      footerText: definition.footerText,
      paymentButtonEnabled: definition.paymentButtonEnabled,
      paymentButtonLabel: definition.paymentButtonLabel,
      copyCodeButtonEnabled: definition.copyCodeButtonEnabled,
      copyCodeSource: definition.copyCodeSource,
      isActive: true,
      metaTemplateName: this.whatsappService.buildMetaTemplateName(
        definition.slug,
      ),
      metaLanguage: 'pt_BR',
      category: 'UTILITY',
      metaStatus: 'LOCAL',
      companyId,
    };
  }
}
