import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { GlobalMessageTemplate, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OfficialTemplateStatus } from '../whatsapp/whatsapp.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';
import { templateCompatibility } from './template-provider-state';
import {
  getTemplateDefinition,
  TEMPLATE_DEFINITIONS,
} from './template-catalog';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async create(
    _companyId: string,
    dto: CreateTemplateDto,
  ): Promise<GlobalMessageTemplate> {
    const existing = await this.prisma.globalMessageTemplate.findUnique({
      where: { slug: dto.slug },
    });
    if (existing)
      throw new HttpException(
        `Template com slug "${dto.slug}" ja existe.`,
        HttpStatus.CONFLICT,
      );
    return this.prisma.globalMessageTemplate.create({
      data: this.fromDto(dto),
    });
  }

  async findAll(companyId: string): Promise<MessageTemplateView[]> {
    await this.ensureGlobalCatalog();
    const [templates, preferences] = await Promise.all([
      this.prisma.globalMessageTemplate.findMany({
        where: { isActive: true },
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

  async submitToMeta(
    companyId: string,
    id: string,
  ): Promise<{ template: GlobalMessageTemplate; meta: unknown }> {
    const template = await this.findGlobalOrThrow(id);
    const meta = await this.whatsappService.createOfficialTemplate({
      companyId,
      template,
    });
    return { template: await this.findGlobalOrThrow(id), meta };
  }

  async syncMetaStatuses(companyId: string): Promise<GlobalMessageTemplate[]> {
    const templates = await this.prisma.globalMessageTemplate.findMany({
      where: { metaTemplateName: { not: null } },
    });
    const official =
      await this.whatsappService.listOfficialTemplateStatuses(companyId);
    const byKey = new Map(
      official.map((item) => [
        this.providerKey(item.name, item.language),
        item,
      ]),
    );
    const syncedAt = new Date();
    await Promise.all(
      templates.map((template) => this.syncStatus(template, byKey, syncedAt)),
    );
    return this.prisma.globalMessageTemplate.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Concludes a pending review by re-reading the provider catalog. The template is
   * released only when category, body, footer and buttons match the local template
   * and its positional variables; otherwise it stays blocked and the reason is returned.
   */
  async confirmReview(
    companyId: string,
    id: string,
  ): Promise<GlobalMessageTemplate> {
    const template = await this.findGlobalOrThrow(id);
    if (!template.metaTemplateName)
      throw new HttpException(
        'Template ainda não foi enviado ao provedor.',
        HttpStatus.CONFLICT,
      );
    const key = this.providerKey(
      template.metaTemplateName,
      template.metaLanguage,
    );
    const status = (
      await this.whatsappService.listOfficialTemplateStatuses(companyId)
    ).find((item) => this.providerKey(item.name, item.language) === key);
    if (!status)
      throw new HttpException(
        'Template não encontrado no catálogo do provedor.',
        HttpStatus.CONFLICT,
      );
    const sameCategory = status.category === template.category;
    const sameContent = templateCompatibility(template, status.components);
    // A provider event applied meanwhile changes updatedAt; never release over it.
    const updated = await this.prisma.globalMessageTemplate.updateMany({
      where: { id, updatedAt: template.updatedAt },
      data: {
        metaStatus: status.status,
        metaTemplateId: status.id,
        metaProviderCategory: status.category,
        metaQuality: status.quality,
        metaComponents: status.components as Prisma.InputJsonValue | undefined,
        metaRejectedReason: status.rejectedReason,
        metaReviewRequired: !(sameCategory && sameContent),
        lastMetaSyncAt: new Date(),
      },
    });
    if (!updated.count)
      throw new HttpException(
        'O template foi alterado pelo provedor durante a revisão. Tente novamente.',
        HttpStatus.CONFLICT,
      );
    if (!sameCategory)
      throw new HttpException(
        `A categoria no provedor (${status.category ?? 'desconhecida'}) difere da categoria local (${template.category}).`,
        HttpStatus.CONFLICT,
      );
    if (!sameContent)
      throw new HttpException(
        'O conteúdo aprovado no provedor (corpo, rodapé, botões ou variáveis) difere do template local.',
        HttpStatus.CONFLICT,
      );
    return this.findGlobalOrThrow(id);
  }

  async resolveApproved(
    companyId: string,
    slug: string,
  ): Promise<MessageTemplateView | null> {
    await this.ensureGlobalCatalog();
    const template = await this.prisma.globalMessageTemplate.findFirst({
      where: {
        slug,
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
        metaTemplateName: this.whatsappService.buildMetaTemplateName(
          definition.slug,
        ),
        metaLanguage: 'pt_BR',
        category: 'UTILITY',
        metaStatus: 'LOCAL',
      })),
      skipDuplicates: true,
    });
  }

  private fromDto(
    dto: CreateTemplateDto,
  ): Prisma.GlobalMessageTemplateCreateInput {
    const definition = getTemplateDefinition(dto.slug);
    return {
      name: definition?.name ?? dto.name.trim(),
      slug: dto.slug,
      content: dto.content,
      footerText: dto.footerText?.trim() || null,
      paymentButtonEnabled: dto.paymentButtonEnabled ?? true,
      paymentButtonLabel: dto.paymentButtonLabel?.trim() || 'Abrir pagamento',
      copyCodeButtonEnabled: dto.copyCodeButtonEnabled ?? false,
      copyCodeSource: dto.copyCodeSource ?? 'AUTO',
      isActive: dto.isActive ?? true,
      metaTemplateName:
        dto.metaTemplateName ??
        this.whatsappService.buildMetaTemplateName(dto.slug),
      metaLanguage: dto.metaLanguage ?? 'pt_BR',
      category: dto.category ?? 'UTILITY',
      metaStatus: 'LOCAL',
    };
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
  private findGlobalOrThrow(id: string): Promise<GlobalMessageTemplate> {
    return this.prisma.globalMessageTemplate.findUniqueOrThrow({
      where: { id },
    });
  }
  private providerKey(name: string, language: string): string {
    return `${name.trim().toLowerCase()}::${language.trim().toLowerCase()}`;
  }
  private async syncStatus(
    template: GlobalMessageTemplate,
    statuses: Map<string, OfficialTemplateStatus>,
    syncedAt: Date,
  ): Promise<void> {
    if (!template.metaTemplateName) return;
    const status = statuses.get(
      this.providerKey(template.metaTemplateName, template.metaLanguage),
    );
    if (!status) return;
    await this.prisma.globalMessageTemplate.update({
      where: { id: template.id },
      data: {
        metaStatus: status.status,
        metaTemplateId: status.id,
        metaProviderCategory: status.category,
        metaQuality: status.quality,
        metaComponents: status.components as Prisma.InputJsonValue | undefined,
        metaReviewRequired:
          template.metaReviewRequired ||
          status.category !== template.category ||
          !templateCompatibility(template, status.components),
        metaRejectedReason: status.rejectedReason,
        lastMetaSyncAt: syncedAt,
      },
    });
  }
}
