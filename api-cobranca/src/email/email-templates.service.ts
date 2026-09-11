import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GlobalEmailTemplate } from '@prisma/client';
import {
  ResendMailerService,
  type ResendTemplatePayload,
  type ResendTemplateVariableInput,
} from '../common/resend-mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmailTemplateDto, UpdateEmailTemplateDto } from './dto';
import {
  DEFAULT_EMAIL_TEMPLATE_DEFINITION,
  EMAIL_TEMPLATE_DEFINITIONS,
  TEMPLATE_VARIABLE_TAGS,
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
  greeting: string;
  instructions: string;
  signature: string;
}

const DEFAULT_GREETING = 'Olá';
const DEFAULT_INSTRUCTIONS =
  'Acesse o link seguro para consultar e pagar sua cobrança.';
const DEFAULT_SIGNATURE = 'Equipe de cobrança';

@Injectable()
export class EmailTemplatesService {
  private readonly supported = new Set<string>(TEMPLATE_VARIABLE_TAGS);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resendMailer: ResendMailerService,
    private readonly config: ConfigService,
  ) {}

  async findAll(companyId: string): Promise<ResolvedEmailTemplate[]> {
    await this.ensureGlobalCatalog();
    const [templates, preferences] = await Promise.all([
      this.prisma.globalEmailTemplate.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.companyTemplatePreference.findMany({
        where: { companyId, channel: 'EMAIL' },
      }),
    ]);
    const bySlug = new Map(
      preferences.map((preference) => [preference.slug, preference]),
    );
    return templates.map((template) =>
      this.toResolved(template, bySlug.get(template.slug)),
    );
  }

  async ensureDefaultTemplates(
    companyId: string,
  ): Promise<ResolvedEmailTemplate[]> {
    return this.findAll(companyId);
  }

  async create(
    _companyId: string,
    dto: CreateEmailTemplateDto,
  ): Promise<GlobalEmailTemplate> {
    this.validate(dto.subject);
    this.validate(dto.content);
    const existing = await this.prisma.globalEmailTemplate.findUnique({
      where: { slug: dto.slug },
    });
    if (existing)
      throw new HttpException(
        `Template de email com slug "${dto.slug}" ja existe.`,
        HttpStatus.CONFLICT,
      );
    return this.prisma.globalEmailTemplate.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug,
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
  ): Promise<ResolvedEmailTemplate> {
    const template = await this.findGlobal(id);
    this.assertSafe(dto);
    await this.prisma.companyTemplatePreference.upsert({
      where: {
        companyId_channel_slug: {
          companyId,
          channel: 'EMAIL',
          slug: template.slug,
        },
      },
      create: {
        companyId,
        channel: 'EMAIL',
        slug: template.slug,
        globalEmailTemplateId: template.id,
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
    return this.findActiveOrDefault(companyId, template.slug);
  }

  async remove(_companyId: string, id: string): Promise<{ deleted: true }> {
    await this.prisma.globalEmailTemplate.update({
      where: { id },
      data: { isActive: false },
    });
    return { deleted: true };
  }

  async publish(_companyId: string, id: string): Promise<GlobalEmailTemplate> {
    const template = await this.findGlobal(id);
    const apiKey = this.required('RESEND_API_KEY');
    const alias = template.resendAlias ?? this.alias(template.slug);
    const payload = this.payload(apiKey, alias, template);
    const result = template.resendTemplateId
      ? await this.resendMailer.updateTemplate({
          ...payload,
          idOrAlias: template.resendTemplateId,
        })
      : await this.resendMailer.createTemplate(payload);
    await this.resendMailer.publishTemplate({ apiKey, idOrAlias: result.id });
    const now = new Date();
    return this.prisma.globalEmailTemplate.update({
      where: { id },
      data: {
        resendTemplateId: result.id,
        resendAlias: alias,
        resendStatus: 'published',
        resendPublishedAt: now,
        lastResendSyncAt: now,
        resendError: null,
      },
    });
  }

  async findActiveOrDefault(
    companyId: string,
    slug: string | null,
  ): Promise<ResolvedEmailTemplate> {
    await this.ensureGlobalCatalog();
    const definition =
      EMAIL_TEMPLATE_DEFINITIONS.find((item) => item.slug === slug) ??
      DEFAULT_EMAIL_TEMPLATE_DEFINITION;
    const template = await this.prisma.globalEmailTemplate.findFirst({
      where: { slug: slug ?? definition.slug, isActive: true },
    });
    if (!template)
      return {
        id: null,
        ...definition,
        isActive: true,
        resendTemplateId: null,
        resendAlias: null,
        greeting: DEFAULT_GREETING,
        instructions: DEFAULT_INSTRUCTIONS,
        signature: DEFAULT_SIGNATURE,
      };
    const preference = await this.prisma.companyTemplatePreference.findUnique({
      where: {
        companyId_channel_slug: {
          companyId,
          channel: 'EMAIL',
          slug: template.slug,
        },
      },
    });
    return this.toResolved(template, preference);
  }

  private async ensureGlobalCatalog(): Promise<void> {
    await Promise.all(
      EMAIL_TEMPLATE_DEFINITIONS.map((definition) =>
        this.prisma.globalEmailTemplate.upsert({
          where: { slug: definition.slug },
          create: { ...definition, isActive: true },
          update: {},
        }),
      ),
    );
  }
  private findGlobal(id: string): Promise<GlobalEmailTemplate> {
    return this.prisma.globalEmailTemplate.findUniqueOrThrow({ where: { id } });
  }
  private toResolved(
    template: GlobalEmailTemplate,
    preference?: {
      isActive: boolean;
      greeting: string | null;
      instructions: string | null;
      signature: string | null;
    } | null,
  ): ResolvedEmailTemplate {
    return {
      id: template.id,
      slug: template.slug,
      name: template.name,
      subject: template.subject,
      content: template.content,
      isActive: preference?.isActive ?? template.isActive,
      resendTemplateId: template.resendTemplateId,
      resendAlias: template.resendAlias,
      greeting: preference?.greeting ?? DEFAULT_GREETING,
      instructions: preference?.instructions ?? DEFAULT_INSTRUCTIONS,
      signature: preference?.signature ?? DEFAULT_SIGNATURE,
    };
  }
  private assertSafe(dto: UpdateEmailTemplateDto): void {
    for (const value of [dto.greeting, dto.instructions, dto.signature])
      if (value && /\{\{|\}\}|https?:\/\/|\r|\n/i.test(value))
        throw new HttpException(
          'Personalizacao deve ser texto simples, sem links, quebras de linha ou variaveis.',
          HttpStatus.BAD_REQUEST,
        );
  }
  private clean(value: string | undefined): string | null {
    return value?.trim() || null;
  }
  private validate(text: string): void {
    const unsupported = Array.from(
      text.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g),
    )
      .map((match) => match[1])
      .find(
        (variable) => variable !== undefined && !this.supported.has(variable),
      );
    if (unsupported)
      throw new HttpException(
        `Placeholder nao suportado: {{${unsupported}}}.`,
        HttpStatus.BAD_REQUEST,
      );
  }
  private required(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) throw new Error('Canal central Resend indisponivel.');
    return value;
  }
  private alias(slug: string): string {
    return `ciframais_${slug.replace(/[^a-zA-Z0-9]+/g, '_')}`;
  }
  private payload(
    apiKey: string,
    alias: string,
    template: GlobalEmailTemplate,
  ): ResendTemplatePayload {
    return {
      apiKey,
      name: template.name,
      alias,
      from: this.required('RESEND_FROM_EMAIL'),
      subject: this.syntax(template.subject),
      html: `<p>${this.syntax(this.escape(template.content)).replace(/\n/g, '<br>')}</p>`,
      text: this.syntax(template.content),
      variables: this.variables(template.subject, template.content),
    };
  }
  private syntax(text: string): string {
    return text.replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
      (_match: string, variable: string) => `{{{${variable.toUpperCase()}}}}`,
    );
  }
  private escape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  private variables(
    subject: string,
    content: string,
  ): ResendTemplateVariableInput[] {
    return Array.from(
      new Set(
        Array.from(
          `${subject}\n${content}`.matchAll(
            /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
          ),
        )
          .map((match) => match[1])
          .filter((value): value is string => value !== undefined),
      ),
    ).map((key) => ({
      key: key.toUpperCase(),
      type: 'string',
      fallbackValue: '',
    }));
  }
}
