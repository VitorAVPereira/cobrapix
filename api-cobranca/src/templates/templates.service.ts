import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { MessageTemplate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';
import {
  getTemplateDefinition,
  TEMPLATE_VARIABLE_TAGS,
} from './template-catalog';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private readonly supportedVariableTags = new Set<string>(TEMPLATE_VARIABLE_TAGS);

  constructor(private readonly prisma: PrismaService) {}

  async create(
    companyId: string,
    dto: CreateTemplateDto,
  ): Promise<MessageTemplate> {
    this.validateTemplateContent(dto.content);
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
        isActive: dto.isActive ?? true,
        companyId,
      },
    });
  }

  async findAll(companyId: string): Promise<MessageTemplate[]> {
    return this.prisma.messageTemplate.findMany({
      where: { companyId },
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

    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        name: definition?.name ?? dto.name ?? template.name,
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  private validateTemplateContent(content: string): void {
    const variables = Array.from(
      content.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g),
      (match) => match[1],
    );
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
        .map((variable) => `{${variable}}`)
        .join(', ')}.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
