import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { GlobalMessageTemplate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTemplateDto } from './dto';
import { TEMPLATE_DEFINITIONS } from './template-catalog';

export type MessageTemplateView = GlobalMessageTemplate & {
  greeting: string;
  instructions: string;
  signature: string;
};

const DEFAULT_GREETING = 'Olá';
const DEFAULT_INSTRUCTIONS =
  'Use o botão abaixo para acessar o pagamento seguro.';
const DEFAULT_SIGNATURE = 'Equipe de cobrança';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string): Promise<MessageTemplateView[]> {
    await this.ensureGlobalCatalog();
    const [templates, preferences] = await Promise.all([
      this.prisma.globalMessageTemplate.findMany({
        where: { isActive: true, origin: 'LEGACY_INTERNAL' },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.companyTemplatePreference.findMany({
        where: { companyId, channel: 'WHATSAPP' },
      }),
    ]);
    const bySlug = new Map(
      preferences.map((preference) => [preference.slug, preference]),
    );
    return templates.map((template) =>
      this.toView(template, bySlug.get(template.slug)),
    );
  }

  async ensureDefaultTemplates(
    companyId: string,
  ): Promise<MessageTemplateView[]> {
    return this.findAll(companyId);
  }

  async findOne(companyId: string, id: string): Promise<MessageTemplateView> {
    const template = await this.prisma.globalMessageTemplate.findUnique({
      where: { id },
    });
    if (!template || !template.isActive)
      throw new HttpException('Template nao encontrado.', HttpStatus.NOT_FOUND);
    const preference = await this.prisma.companyTemplatePreference.findUnique({
      where: {
        companyId_channel_slug: {
          companyId,
          channel: 'WHATSAPP',
          slug: template.slug,
        },
      },
    });
    return this.toView(template, preference);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTemplateDto,
  ): Promise<MessageTemplateView> {
    const template = await this.prisma.globalMessageTemplate.findUnique({
      where: { id },
    });
    if (!template)
      throw new HttpException('Template nao encontrado.', HttpStatus.NOT_FOUND);
    this.assertSafePersonalization(dto);
    await this.prisma.companyTemplatePreference.upsert({
      where: {
        companyId_channel_slug: {
          companyId,
          channel: 'WHATSAPP',
          slug: template.slug,
        },
      },
      create: {
        companyId,
        channel: 'WHATSAPP',
        slug: template.slug,
        globalMessageTemplateId: template.id,
        isActive: dto.isActive ?? true,
        greeting: this.clean(dto.greeting),
        instructions: this.clean(dto.instructions),
        signature: this.clean(dto.signature),
      },
      update: {
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.greeting !== undefined && {
          greeting: this.clean(dto.greeting),
        }),
        ...(dto.instructions !== undefined && {
          instructions: this.clean(dto.instructions),
        }),
        ...(dto.signature !== undefined && {
          signature: this.clean(dto.signature),
        }),
      },
    });
    return this.findOne(companyId, id);
  }

  async resolveApproved(
    companyId: string,
    slug: string,
  ): Promise<MessageTemplateView | null> {
    await this.ensureGlobalCatalog();
    const template = await this.prisma.globalMessageTemplate.findFirst({
      where: {
        slug,
        origin: 'LEGACY_INTERNAL',
        isActive: true,
        metaStatus: 'APPROVED',
        metaReviewRequired: false,
      },
    });
    return template ? this.findOne(companyId, template.id) : null;
  }

  private async ensureGlobalCatalog(): Promise<void> {
    await this.prisma.globalMessageTemplate.createMany({
      data: TEMPLATE_DEFINITIONS.map((definition) => ({
        name: definition.name,
        slug: definition.slug,
        content: definition.defaultContent,
        footerText: definition.footerText,
        paymentButtonEnabled: definition.paymentButtonEnabled,
        paymentButtonLabel: definition.paymentButtonLabel,
        copyCodeButtonEnabled: definition.copyCodeButtonEnabled,
        copyCodeSource: definition.copyCodeSource,
        metaTemplateName: `cobrapix_${definition.slug.replace(/-/g, '_')}`,
        metaLanguage: 'pt_BR',
        category: 'UTILITY',
        metaStatus: 'LOCAL',
      })),
      skipDuplicates: true,
    });
  }

  private assertSafePersonalization(dto: UpdateTemplateDto): void {
    for (const value of [dto.greeting, dto.instructions, dto.signature]) {
      if (value && /\{\{|\}\}|https?:\/\/|\r|\n/i.test(value))
        throw new HttpException(
          'Personalizacao deve ser texto simples, sem links, quebras de linha ou variaveis.',
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  private toView(
    template: GlobalMessageTemplate,
    preference?: {
      isActive: boolean;
      greeting: string | null;
      instructions: string | null;
      signature: string | null;
    } | null,
  ): MessageTemplateView {
    return {
      ...template,
      isActive: preference?.isActive ?? template.isActive,
      greeting: preference?.greeting ?? DEFAULT_GREETING,
      instructions: preference?.instructions ?? DEFAULT_INSTRUCTIONS,
      signature: preference?.signature ?? DEFAULT_SIGNATURE,
    };
  }
  private clean(value: string | undefined): string | null {
    return value?.trim() || null;
  }
}
