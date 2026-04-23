import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateTemplateDto) {
    const existing = await this.prisma.messageTemplate.findFirst({
      where: { companyId, slug: dto.slug },
    });

    if (existing) {
      throw new HttpException(
        `Template com slug "${dto.slug}" já existe.`,
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.messageTemplate.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        content: dto.content,
        isActive: dto.isActive ?? true,
        companyId,
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.messageTemplate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const template = await this.prisma.messageTemplate.findFirst({
      where: { id, companyId },
    });

    if (!template) {
      throw new HttpException('Template não encontrado.', HttpStatus.NOT_FOUND);
    }

    return template;
  }

  async update(companyId: string, id: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.messageTemplate.findFirst({
      where: { id, companyId },
    });

    if (!template) {
      throw new HttpException('Template não encontrado.', HttpStatus.NOT_FOUND);
    }

    if (dto.slug && dto.slug !== template.slug) {
      const existing = await this.prisma.messageTemplate.findFirst({
        where: { companyId, slug: dto.slug },
      });

      if (existing) {
        throw new HttpException(
          `Template com slug "${dto.slug}" já existe.`,
          HttpStatus.CONFLICT,
        );
      }
    }

    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }
}