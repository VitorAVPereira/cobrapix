# Email Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable, previewable Email templates as a separate channel from WhatsApp templates, and use them for real email sends.

**Architecture:** Keep WhatsApp templates on `MessageTemplate` and add a separate `EmailTemplate` model, service, controller and frontend API methods. The collection billing flow resolves the rule step's WhatsApp template slug, then uses the matching active Email template subject/body for `EMAIL` sends, falling back to catalog defaults when needed.

**Tech Stack:** NestJS, Prisma, PostgreSQL migrations, class-validator, Jest, Next.js App Router, React, TailwindCSS.

---

## File Structure

- Create `api-cobranca/prisma/migrations/20260526120000_add_email_templates/migration.sql`: SQL migration for the `EmailTemplate` table and relation index.
- Modify `api-cobranca/prisma/schema.prisma`: add `Company.emailTemplates` and the `EmailTemplate` model.
- Create `api-cobranca/src/email/email-template-catalog.ts`: email-specific defaults derived from supported billing slugs.
- Create `api-cobranca/src/email/dto/create-email-template.dto.ts`: validated create DTO.
- Create `api-cobranca/src/email/dto/update-email-template.dto.ts`: validated update DTO.
- Create `api-cobranca/src/email/dto/index.ts`: DTO barrel.
- Create `api-cobranca/src/email/email-templates.service.ts`: multi-tenant persistence, default creation, placeholder validation and active-template resolution.
- Create `api-cobranca/src/email/email-templates.controller.ts`: authenticated `/email/templates` API.
- Modify `api-cobranca/src/email/email.module.ts`: register and export the new service/controller.
- Modify `api-cobranca/src/billing/billing.service.ts`: render email subject/body from `EmailTemplate`.
- Modify `api-cobranca/src/billing/billing.service.spec.ts`: cover email template use in real billing sends.
- Create `api-cobranca/src/email/email-templates.service.spec.ts`: cover default creation, validation and updates.
- Modify `front-cobranca/src/lib/api-client.ts`: add Email template types and API methods.
- Modify `front-cobranca/src/app/(dashboard)/configuracoes/templates/page.tsx`: add WhatsApp/Email channel tabs and Email editor/preview.
- Modify `front-cobranca/src/app/(dashboard)/configuracoes/templates/__tests__/page.test.tsx`: cover the channel tabs and email save flow.

---

### Task 1: Prisma Model And Migration

**Files:**
- Modify: `api-cobranca/prisma/schema.prisma`
- Create: `api-cobranca/prisma/migrations/20260526120000_add_email_templates/migration.sql`

- [ ] **Step 1: Add the Prisma relation and model**

Add `emailTemplates EmailTemplate[]` to `model Company`, near the existing `templates MessageTemplate[]` relation:

```prisma
  templates            MessageTemplate[]
  emailTemplates       EmailTemplate[]
```

Add this model after `MessageTemplate`:

```prisma
model EmailTemplate {
  id        String  @id @default(uuid())
  name      String
  slug      String
  subject   String
  content   String  @db.Text
  isActive  Boolean @default(true)
  companyId String
  company   Company @relation(fields: [companyId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([companyId, slug])
}
```

- [ ] **Step 2: Add the SQL migration**

Create `api-cobranca/prisma/migrations/20260526120000_add_email_templates/migration.sql`:

```sql
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailTemplate_companyId_slug_key" ON "EmailTemplate"("companyId", "slug");

ALTER TABLE "EmailTemplate"
ADD CONSTRAINT "EmailTemplate_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma Client**

Run:

```bash
cd api-cobranca && npm run prisma:generate
```

Expected: Prisma Client generation completes successfully.

- [ ] **Step 4: Commit**

```bash
git add api-cobranca/prisma/schema.prisma api-cobranca/prisma/migrations/20260526120000_add_email_templates/migration.sql
git commit -m "feat: add email template schema"
```

---

### Task 2: Email Template Service

**Files:**
- Create: `api-cobranca/src/email/email-template-catalog.ts`
- Create: `api-cobranca/src/email/dto/create-email-template.dto.ts`
- Create: `api-cobranca/src/email/dto/update-email-template.dto.ts`
- Create: `api-cobranca/src/email/dto/index.ts`
- Create: `api-cobranca/src/email/email-templates.service.ts`
- Create: `api-cobranca/src/email/email-templates.service.spec.ts`

- [ ] **Step 1: Write the failing service tests**

Create `api-cobranca/src/email/email-templates.service.spec.ts`:

```ts
import type { EmailTemplate } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { PrismaService } from '../prisma/prisma.service';

function createEmailTemplateFixture(
  overrides: Partial<EmailTemplate> = {},
): EmailTemplate {
  return {
    id: 'email-template-1',
    name: 'Vencimento hoje',
    slug: 'vencimento-hoje',
    subject: 'Sua cobranca vence hoje',
    content: 'Ola {{nome_devedor}}, sua cobranca de {{valor}} vence hoje.',
    isActive: true,
    companyId: 'company-1',
    createdAt: new Date('2026-05-26T12:00:00.000Z'),
    updatedAt: new Date('2026-05-26T12:00:00.000Z'),
    ...overrides,
  };
}

function createService(input?: {
  existingSlugs?: string[];
  templates?: EmailTemplate[];
}) {
  const templates =
    input?.templates ?? [createEmailTemplateFixture({ slug: 'vencimento-hoje' })];
  const prisma = {
    emailTemplate: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(
          (input?.existingSlugs ?? []).map((slug) => ({ slug })),
        )
        .mockResolvedValue(templates),
      createMany: jest.fn().mockResolvedValue({ count: 6 }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: EmailTemplate }) =>
        createEmailTemplateFixture(data),
      ),
      update: jest.fn(async ({ data }: { data: Partial<EmailTemplate> }) =>
        createEmailTemplateFixture(data),
      ),
    },
  } as unknown as PrismaService;

  return {
    service: new EmailTemplatesService(prisma),
    prisma: prisma as unknown as {
      emailTemplate: {
        findMany: jest.Mock;
        createMany: jest.Mock;
        findFirst: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
    },
  };
}

describe('EmailTemplatesService', () => {
  it('cria templates de email padrao quando faltam slugs da empresa', async () => {
    const { service, prisma } = createService();

    await service.ensureDefaultTemplates('company-1');

    expect(prisma.emailTemplate.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          companyId: 'company-1',
          slug: 'cobranca-emissao',
          subject: expect.stringContaining('{{nome_empresa}}') as string,
          isActive: true,
        }),
        expect.objectContaining({
          companyId: 'company-1',
          slug: 'atraso-critico',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('rejeita placeholders desconhecidos no assunto e no corpo', async () => {
    const { service } = createService();

    await expect(
      service.create('company-1', {
        name: 'Vencimento hoje',
        slug: 'vencimento-hoje',
        subject: 'Ola {{apelido}}',
        content: 'Cobranca de {{valor}}',
      }),
    ).rejects.toBeInstanceOf(HttpException);

    await expect(
      service.create('company-1', {
        name: 'Vencimento hoje',
        slug: 'vencimento-hoje',
        subject: 'Cobranca de {{valor}}',
        content: 'Ola {{apelido}}',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('atualiza assunto, corpo e status ativo com filtro de empresa', async () => {
    const { service, prisma } = createService();
    prisma.emailTemplate.findFirst.mockResolvedValueOnce(
      createEmailTemplateFixture(),
    );

    await service.update('company-1', 'email-template-1', {
      subject: 'Novo assunto {{valor}}',
      content: 'Novo corpo para {{nome_devedor}}',
      isActive: false,
    });

    expect(prisma.emailTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: 'email-template-1', companyId: 'company-1' },
    });
    expect(prisma.emailTemplate.update).toHaveBeenCalledWith({
      where: { id: 'email-template-1' },
      data: {
        subject: 'Novo assunto {{valor}}',
        content: 'Novo corpo para {{nome_devedor}}',
        isActive: false,
      },
    });
  });

  it('resolve template ativo por slug ou retorna o default seguro', async () => {
    const { service, prisma } = createService();
    prisma.emailTemplate.findFirst.mockResolvedValueOnce(null);

    const template = await service.findActiveOrDefault(
      'company-1',
      'vencimento-hoje',
    );

    expect(prisma.emailTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        slug: 'vencimento-hoje',
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        subject: true,
        content: true,
        isActive: true,
      },
    });
    expect(template.slug).toBe('vencimento-hoje');
    expect(template.subject).toContain('{{nome_empresa}}');
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd api-cobranca && npm test -- email-templates.service.spec.ts --runInBand
```

Expected: FAIL because `email-templates.service.ts` does not exist.

- [ ] **Step 3: Add the catalog**

Create `api-cobranca/src/email/email-template-catalog.ts`:

```ts
import {
  TEMPLATE_DEFINITIONS,
  TEMPLATE_SLUGS,
  TEMPLATE_VARIABLE_TAGS,
} from '../templates/template-catalog';

export { TEMPLATE_SLUGS, TEMPLATE_VARIABLE_TAGS };

export interface EmailTemplateDefinition {
  readonly slug: string;
  readonly name: string;
  readonly subject: string;
  readonly content: string;
}

const defaultBodyBySlug: Record<string, string> = {
  'cobranca-emissao':
    'Ola, {{nome_devedor}}.\n\nSua cobranca de {{valor}} da {{nome_empresa}} foi emitida com vencimento em {{data_vencimento}}.\n\nAcesse a pagina segura para pagar por {{metodo_pagamento}}: {{payment_link}}',
  'pre-vencimento':
    'Ola, {{nome_devedor}}.\n\nEstamos passando para lembrar que a cobranca de {{valor}} da {{nome_empresa}} vence em {{data_vencimento}}.\n\nPara pagar com seguranca, acesse: {{payment_link}}',
  'vencimento-hoje':
    'Ola, {{nome_devedor}}.\n\nSua cobranca de {{valor}} da {{nome_empresa}} vence hoje, {{data_vencimento}}.\n\nPara evitar atraso, acesse a pagina segura de pagamento: {{payment_link}}',
  'atraso-primeiro-aviso':
    'Ola, {{nome_devedor}}.\n\nIdentificamos uma cobranca em aberto de {{valor}} da {{nome_empresa}}, vencida em {{data_vencimento}}.\n\nRegularize com seguranca por aqui: {{payment_link}}',
  'atraso-recorrente':
    'Ola, {{nome_devedor}}.\n\nAinda consta uma cobranca pendente de {{valor}} da {{nome_empresa}}, com vencimento em {{data_vencimento}}.\n\nAcesse a pagina de pagamento: {{payment_link}}',
  'atraso-critico':
    'Ola, {{nome_devedor}}.\n\nSua cobranca de {{valor}} da {{nome_empresa}} segue pendente desde {{data_vencimento}}.\n\nAcesse a pagina segura para regularizar: {{payment_link}}',
};

const subjectBySlug: Record<string, string> = {
  'cobranca-emissao': '{{nome_empresa}}: cobranca emitida',
  'pre-vencimento': '{{nome_empresa}}: lembrete de vencimento',
  'vencimento-hoje': '{{nome_empresa}}: sua cobranca vence hoje',
  'atraso-primeiro-aviso': '{{nome_empresa}}: cobranca em aberto',
  'atraso-recorrente': '{{nome_empresa}}: lembrete de cobranca pendente',
  'atraso-critico': '{{nome_empresa}}: regularizacao de cobranca',
};

export const EMAIL_TEMPLATE_DEFINITIONS: readonly EmailTemplateDefinition[] =
  TEMPLATE_DEFINITIONS.map((definition) => ({
    slug: definition.slug,
    name: definition.name,
    subject: subjectBySlug[definition.slug] ?? '{{nome_empresa}}: cobranca',
    content:
      defaultBodyBySlug[definition.slug] ??
      'Ola, {{nome_devedor}}.\n\nVoce tem uma cobranca de {{valor}} da {{nome_empresa}} com vencimento em {{data_vencimento}}.\n\nAcesse: {{payment_link}}',
  }));

export const DEFAULT_EMAIL_TEMPLATE_DEFINITION =
  EMAIL_TEMPLATE_DEFINITIONS[0];

export function getEmailTemplateDefinition(
  slug: string,
): EmailTemplateDefinition | null {
  return (
    EMAIL_TEMPLATE_DEFINITIONS.find(
      (definition) => definition.slug === slug,
    ) ?? null
  );
}
```

- [ ] **Step 4: Add DTOs**

Create `api-cobranca/src/email/dto/create-email-template.dto.ts`:

```ts
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TEMPLATE_SLUGS } from '../email-template-catalog';

export class CreateEmailTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsIn(TEMPLATE_SLUGS)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

Create `api-cobranca/src/email/dto/update-email-template.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEmailTemplateDto {
  @IsString()
  @IsOptional()
  @MaxLength(160)
  subject?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  content?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

Create `api-cobranca/src/email/dto/index.ts`:

```ts
export * from './create-email-template.dto';
export * from './update-email-template.dto';
```

- [ ] **Step 5: Add the service implementation**

Create `api-cobranca/src/email/email-templates.service.ts`:

```ts
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
```

- [ ] **Step 6: Run the service tests and verify they pass**

Run:

```bash
cd api-cobranca && npm test -- email-templates.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api-cobranca/src/email/email-template-catalog.ts api-cobranca/src/email/dto api-cobranca/src/email/email-templates.service.ts api-cobranca/src/email/email-templates.service.spec.ts
git commit -m "feat: add email template service"
```

---

### Task 3: Email Template API

**Files:**
- Create: `api-cobranca/src/email/email-templates.controller.ts`
- Modify: `api-cobranca/src/email/email.module.ts`

- [ ] **Step 1: Add the controller**

Create `api-cobranca/src/email/email-templates.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateEmailTemplateDto, UpdateEmailTemplateDto } from './dto';
import { EmailTemplatesService } from './email-templates.service';

interface AuthenticatedUser {
  companyId: string;
}

@Controller('email/templates')
@UseGuards(JwtAuthGuard)
export class EmailTemplatesController {
  constructor(private readonly emailTemplatesService: EmailTemplatesService) {}

  @Get()
  async findAll(@GetUser() user: AuthenticatedUser) {
    return this.emailTemplatesService.findAll(user.companyId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateEmailTemplateDto,
  ) {
    return this.emailTemplatesService.create(user.companyId, dto);
  }

  @Patch(':id')
  async update(
    @GetUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.emailTemplatesService.update(user.companyId, id, dto);
  }
}
```

- [ ] **Step 2: Register the service and controller**

Update `api-cobranca/src/email/email.module.ts`:

```ts
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesService } from './email-templates.service';
```

Change the module metadata:

```ts
  controllers: [EmailController, EmailTemplatesController],
  providers: [
    EmailService,
    EmailTemplatesService,
    EmailProcessor,
    EmailQueueService,
    ResendMailerService,
  ],
  exports: [EmailService, EmailTemplatesService, EmailQueueService],
```

- [ ] **Step 3: Verify the backend compiles**

Run:

```bash
cd api-cobranca && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add api-cobranca/src/email/email-templates.controller.ts api-cobranca/src/email/email.module.ts
git commit -m "feat: expose email template api"
```

---

### Task 4: Use Email Templates In Billing Sends

**Files:**
- Modify: `api-cobranca/src/billing/billing.service.ts`
- Modify: `api-cobranca/src/billing/billing.service.spec.ts`

- [ ] **Step 1: Write the failing billing test**

In `api-cobranca/src/billing/billing.service.spec.ts`, update the test helper:

```ts
import { EmailTemplatesService } from '../email/email-templates.service';
```

Add `email?: string | null;` to `TestInvoiceOverrides` and set `debtor.email` from overrides:

```ts
email?: string | null;
```

```ts
email: overrides.email ?? null,
```

In `createService`, add an `emailTemplateService` mock and return it:

```ts
const emailTemplatesService = {
  findActiveOrDefault: jest.fn().mockResolvedValue({
    id: 'email-template-1',
    slug: 'vencimento-hoje',
    name: 'Vencimento hoje',
    subject: '{{nome_empresa}}: cobranca de {{valor}}',
    content:
      'Ola {{nome_devedor}}, acesse {{payment_link}} ate {{data_vencimento}}.',
    isActive: true,
  }),
} as unknown as EmailTemplatesService;
```

Pass it to `new BillingService(...)` after `emailService`, and include this typed return:

```ts
emailQueue: emailQueue as unknown as { addBulk: jest.Mock };
emailService: emailService as unknown as {
  buildCollectionEmailHtml: jest.Mock;
};
emailTemplatesService: emailTemplatesService as unknown as {
  findActiveOrDefault: jest.Mock;
};
```

Add this test inside `describe('BillingService', () => { ... })`:

```ts
it('usa template de email ativo para assunto e corpo do envio EMAIL', async () => {
  const invoice = buildInvoice({
    email: 'maria@example.com',
    gatewayId: 'tx-invoice-1',
    efiTxid: 'tx-invoice-1',
    efiPixCopiaECola: 'pix-copia-e-cola',
  });
  const { service, emailQueue, emailService, emailTemplatesService } =
    createService({
      invoices: [invoice],
    });
  const ruleEngine = Reflect.get(
    service,
    'ruleEngine',
  ) as CollectionRuleEngine & {
    getNextStep: jest.Mock;
  };
  ruleEngine.getNextStep.mockResolvedValue({
    ruleStepId: 'step-1',
    channel: 'EMAIL',
    templateId: 'template-1',
    delayDays: 0,
  });

  const result = await service.executeBilling('company-1');

  expect(result).toEqual({ queued: 1, skipped: 0 });
  expect(emailTemplatesService.findActiveOrDefault).toHaveBeenCalledWith(
    'company-1',
    'vencimento-hoje',
  );
  expect(emailService.buildCollectionEmailHtml).toHaveBeenCalledWith(
    expect.objectContaining({
      bodyText:
        'Ola Maria Silva, acesse pix-copia-e-cola ate 28/04/2026.',
    }),
  );
  expect(emailQueue.addBulk).toHaveBeenCalledWith([
    expect.objectContaining({
      email: 'maria@example.com',
      subject: 'Empresa Teste: cobranca de R$ 150,00',
    }),
  ]);
});
```

- [ ] **Step 2: Run the billing test and verify it fails**

Run:

```bash
cd api-cobranca && npm test -- billing.service.spec.ts --runInBand
```

Expected: FAIL because `BillingService` constructor and email-send logic do not use `EmailTemplatesService`.

- [ ] **Step 3: Inject `EmailTemplatesService` into BillingService**

In `api-cobranca/src/billing/billing.service.ts`, add:

```ts
import { EmailTemplatesService } from '../email/email-templates.service';
```

Add the constructor parameter after `private emailService: EmailService`:

```ts
    private emailTemplatesService: EmailTemplatesService,
```

- [ ] **Step 4: Add email template rendering helpers**

Add this helper near `buildMessageFromTemplate`:

```ts
  private buildTemplateText(
    templateContent: string,
    params: {
      debtorName: string;
      originalAmount: number;
      dueDate: Date;
      companyName: string;
      paymentData: PaymentMessageData;
    },
  ): string {
    const replacements = this.buildTemplateReplacements(params);
    const contentWithoutEmptyPaymentLines = this.removeEmptyVariableLines(
      templateContent,
      replacements,
    );

    const rendered = Object.entries(replacements)
      .reduce(
        (content, [key, value]) =>
          content
            .replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value)
            .replace(new RegExp(`{${key}}`, 'g'), value),
        contentWithoutEmptyPaymentLines,
      )
      .replace(/\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return this.spintaxService.process(rendered).trim();
  }
```

Change `buildMessageFromTemplate` to call the helper and then process spintax/payment instruction:

```ts
    const message = this.buildTemplateText(templateContent, params);

    return this.ensurePaymentInstruction(message, params.paymentData);
```

- [ ] **Step 5: Use the email template in the EMAIL channel branch**

Replace the current `const template = await this.resolveTemplate(...)` and `templateBody` logic in the `EMAIL` branch with:

```ts
          const template = await this.resolveTemplate(
            company.id,
            templateId,
            false,
          );
          const emailTemplate = await this.emailTemplatesService.findActiveOrDefault(
            company.id,
            template?.slug ?? null,
          );
          const renderParams = {
            debtorName: invoice.debtor.name,
            originalAmount: Number(invoice.originalAmount),
            dueDate: invoice.dueDate,
            companyName: company.corporateName,
            paymentData,
          };
          const templateBody = this.buildTemplateText(
            emailTemplate.content,
            renderParams,
          );
          const subject = this.buildTemplateText(
            emailTemplate.subject,
            renderParams,
          );
```

Use `subject` in the queued email job:

```ts
            subject,
```

- [ ] **Step 6: Run the billing test and verify it passes**

Run:

```bash
cd api-cobranca && npm test -- billing.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api-cobranca/src/billing/billing.service.ts api-cobranca/src/billing/billing.service.spec.ts
git commit -m "feat: use email templates in billing sends"
```

---

### Task 5: Frontend API Client

**Files:**
- Modify: `front-cobranca/src/lib/api-client.ts`

- [ ] **Step 1: Add Email template types**

Near the existing `MessageTemplate` types, add:

```ts
export interface EmailTemplate {
  id: string;
  name: string;
  slug: string;
  subject: string;
  content: string;
  isActive: boolean;
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveEmailTemplateInput {
  name: string;
  slug: MessageTemplateSlug;
  subject: string;
  content: string;
  isActive?: boolean;
}
```

- [ ] **Step 2: Add Email template methods**

Near the existing template API methods, add:

```ts
  async getEmailTemplates(): Promise<EmailTemplate[]> {
    return this.fetch<EmailTemplate[]>('/email/templates');
  }

  async createEmailTemplate(
    data: SaveEmailTemplateInput,
  ): Promise<EmailTemplate> {
    return this.fetch<EmailTemplate>('/email/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateEmailTemplate(
    id: string,
    data: Partial<SaveEmailTemplateInput>,
  ): Promise<EmailTemplate> {
    return this.fetch<EmailTemplate>(`/email/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
```

- [ ] **Step 3: Run frontend type-aware tests for API usage**

Run:

```bash
cd front-cobranca && npx jest src/app/\(dashboard\)/configuracoes/templates/__tests__/page.test.tsx --runInBand
```

Expected: existing tests still pass or fail only because the page mock does not include the new methods yet.

- [ ] **Step 4: Commit**

```bash
git add front-cobranca/src/lib/api-client.ts
git commit -m "feat: add email template frontend api"
```

---

### Task 6: Templates Page Email Tab

**Files:**
- Modify: `front-cobranca/src/app/(dashboard)/configuracoes/templates/page.tsx`
- Modify: `front-cobranca/src/app/(dashboard)/configuracoes/templates/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing frontend test**

Update the imports in `page.test.tsx`:

```ts
  EmailTemplate,
  SaveEmailTemplateInput,
```

Add mocks:

```ts
const mockGetEmailTemplates = jest.fn() as jest.MockedFunction<
  () => Promise<EmailTemplate[]>
>;
const mockUpdateEmailTemplate = jest.fn() as jest.MockedFunction<
  (
    id: string,
    data: Partial<SaveEmailTemplateInput>,
  ) => Promise<EmailTemplate>
>;
const mockCreateEmailTemplate = jest.fn() as jest.MockedFunction<
  (data: SaveEmailTemplateInput) => Promise<EmailTemplate>
>;
```

Add them to `mockApiClient`:

```ts
  getEmailTemplates: mockGetEmailTemplates,
  updateEmailTemplate: mockUpdateEmailTemplate,
  createEmailTemplate: mockCreateEmailTemplate,
```

Create fixture:

```ts
function createEmailTemplateFixture(
  overrides: Partial<EmailTemplate> = {},
): EmailTemplate {
  return {
    id: 'email-template-1',
    name: 'Vencimento hoje',
    slug: 'vencimento-hoje',
    subject: '{{nome_empresa}}: sua cobranca vence hoje',
    content: 'Ola, {{nome_devedor}}. Acesse {{payment_link}}.',
    isActive: true,
    companyId: 'company-1',
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}
```

Reset mocks in `beforeEach`:

```ts
mockGetEmailTemplates.mockReset();
mockUpdateEmailTemplate.mockReset();
mockCreateEmailTemplate.mockReset();
mockGetEmailTemplates.mockResolvedValue([createEmailTemplateFixture()]);
mockUpdateEmailTemplate.mockImplementation(async (_id, data) =>
  createEmailTemplateFixture(data),
);
mockCreateEmailTemplate.mockImplementation(async (data) =>
  createEmailTemplateFixture(data),
);
```

Add the test:

```ts
it('permite editar e pre-visualizar templates de email em uma aba propria', async () => {
  const user = userEvent.setup();

  render(<TemplatesPage />);

  await user.click(await screen.findByRole('button', { name: 'Email' }));

  expect(mockGetEmailTemplates).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Assunto do email')).toHaveValue(
    '{{nome_empresa}}: sua cobranca vence hoje',
  );
  expect(screen.getByText('Clinica Exemplo: sua cobranca vence hoje')).toBeInTheDocument();

  await user.clear(screen.getByLabelText('Assunto do email'));
  await user.type(
    screen.getByLabelText('Assunto do email'),
    '{{nome_empresa}}: pagamento pendente',
  );
  await user.clear(screen.getByLabelText('Corpo do email'));
  await user.type(
    screen.getByLabelText('Corpo do email'),
    'Ola {{nome_devedor}}, pague {{valor}} por aqui: {{payment_link}}',
  );
  await user.click(screen.getByRole('button', { name: /salvar/i }));

  await waitFor(() => expect(mockUpdateEmailTemplate).toHaveBeenCalledTimes(1));
  expect(mockUpdateEmailTemplate).toHaveBeenCalledWith(
    'email-template-1',
    expect.objectContaining({
      subject: '{{nome_empresa}}: pagamento pendente',
      content:
        'Ola {{nome_devedor}}, pague {{valor}} por aqui: {{payment_link}}',
      isActive: true,
    }),
  );
});
```

- [ ] **Step 2: Run the frontend test and verify it fails**

Run:

```bash
cd front-cobranca && npx jest src/app/\(dashboard\)/configuracoes/templates/__tests__/page.test.tsx --runInBand
```

Expected: FAIL because the Email tab and API calls do not exist.

- [ ] **Step 3: Add Email state and helpers**

In `page.tsx`, import the new types and `Mail` icon:

```ts
  Mail,
```

```ts
  EmailTemplate,
  SaveEmailTemplateInput,
```

Add:

```ts
type ChannelTab = 'whatsapp' | 'email';

interface EmailTemplateFormState {
  id: string | null;
  name: string;
  slug: MessageTemplateSlug;
  subject: string;
  content: string;
  isActive: boolean;
}
```

Add defaults:

```ts
const EMPTY_EMAIL_FORM: EmailTemplateFormState = {
  id: null,
  name: DEFAULT_TEMPLATE_OPTION.name,
  slug: DEFAULT_TEMPLATE_OPTION.slug,
  subject: '{{nome_empresa}}: cobranca',
  content:
    'Ola, {{nome_devedor}}.\n\nVoce tem uma cobranca de {{valor}} com vencimento em {{data_vencimento}}.\n\nAcesse: {{payment_link}}',
  isActive: true,
};
```

Add conversion:

```ts
function emailTemplateToForm(
  template: EmailTemplate,
): EmailTemplateFormState {
  const option = getTemplateOption(template.slug);

  return {
    id: template.id,
    name: option?.name ?? template.name,
    slug: (option?.slug ?? template.slug) as MessageTemplateSlug,
    subject: template.subject,
    content: template.content,
    isActive: template.isActive,
  };
}
```

Change `sortTemplates` in `page.tsx` to accept both WhatsApp and Email template records:

```ts
function sortTemplates<T extends { slug: string; name: string }>(
  templates: T[],
): T[] {
  return [...templates].sort((left, right) => {
    const leftOrder =
      TEMPLATE_ORDER.get(left.slug as MessageTemplateSlug) ?? 999;
    const rightOrder =
      TEMPLATE_ORDER.get(right.slug as MessageTemplateSlug) ?? 999;

    return leftOrder - rightOrder || left.name.localeCompare(right.name);
  });
}
```

- [ ] **Step 4: Add Email loading and saving**

Add state:

```ts
const [activeChannel, setActiveChannel] = useState<ChannelTab>('whatsapp');
const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
const [emailForm, setEmailForm] =
  useState<EmailTemplateFormState>(EMPTY_EMAIL_FORM);
const [loadingEmail, setLoadingEmail] = useState(true);
const [savingEmail, setSavingEmail] = useState(false);
```

Add a `useEffect` to load email templates:

```ts
useEffect(() => {
  let active = true;

  async function loadEmailTemplates(): Promise<void> {
    setLoadingEmail(true);

    try {
      const data = sortTemplates(await apiClient.getEmailTemplates());
      if (!active) return;

      setEmailTemplates(data);
      const firstTemplate =
        data.find((template) => template.slug === DEFAULT_TEMPLATE_OPTION.slug) ??
        data[0];
      setEmailForm(
        firstTemplate ? emailTemplateToForm(firstTemplate) : EMPTY_EMAIL_FORM,
      );
    } catch (loadError) {
      if (active) setError(getErrorMessage(loadError));
    } finally {
      if (active) setLoadingEmail(false);
    }
  }

  void loadEmailTemplates();

  return () => {
    active = false;
  };
}, [apiClient]);
```

Add helpers:

```ts
function updateEmailForm<K extends keyof EmailTemplateFormState>(
  key: K,
  value: EmailTemplateFormState[K],
): void {
  setEmailForm((current) => ({ ...current, [key]: value }));
  setSuccess(null);
}

function selectEmailTemplate(template: EmailTemplate): void {
  setEmailForm(emailTemplateToForm(template));
  setError(null);
  setSuccess(null);
}

function insertEmailVariable(tag: string): void {
  updateEmailForm(
    'content',
    `${emailForm.content}${emailForm.content.endsWith(' ') ? '' : ' '}${tag}`,
  );
}
```

Add `saveEmailTemplate`:

```ts
async function saveEmailTemplate(): Promise<void> {
  const option = getTemplateOption(emailForm.slug);
  const payload: SaveEmailTemplateInput = {
    name: option?.name ?? emailForm.name.trim(),
    slug: option?.slug ?? emailForm.slug,
    subject: emailForm.subject.trim(),
    content: emailForm.content.trim(),
    isActive: emailForm.isActive,
  };

  if (!payload.subject || !payload.content) {
    setError('Preencha assunto e corpo do email antes de salvar.');
    return;
  }

  setSavingEmail(true);
  setError(null);
  setSuccess(null);

  try {
    const saved = emailForm.id
      ? await apiClient.updateEmailTemplate(emailForm.id, payload)
      : await apiClient.createEmailTemplate(payload);

    setEmailTemplates((current) => {
      const nextTemplates = current.some((template) => template.id === saved.id)
        ? current.map((template) =>
            template.id === saved.id ? saved : template,
          )
        : [...current, saved];

      return sortTemplates(nextTemplates);
    });
    setEmailForm(emailTemplateToForm(saved));
    setSuccess('Template de email salvo com sucesso.');
  } catch (saveError) {
    setError(getErrorMessage(saveError));
  } finally {
    setSavingEmail(false);
  }
}
```

- [ ] **Step 5: Add channel tabs and dynamic actions**

Above the status and editor grid, add channel buttons:

```tsx
<div className="flex w-fit rounded-md border border-slate-200 bg-white p-1">
  <button
    type="button"
    onClick={() => setActiveChannel('whatsapp')}
    className={`inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold transition ${
      activeChannel === 'whatsapp'
        ? 'bg-slate-950 text-white'
        : 'text-slate-600 hover:bg-slate-100'
    }`}
  >
    <Smartphone size={16} />
    WhatsApp
  </button>
  <button
    type="button"
    onClick={() => setActiveChannel('email')}
    className={`inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold transition ${
      activeChannel === 'email'
        ? 'bg-slate-950 text-white'
        : 'text-slate-600 hover:bg-slate-100'
    }`}
  >
    <Mail size={16} />
    Email
  </button>
</div>
```

Change the Save button handler:

```tsx
onClick={() =>
  activeChannel === 'whatsapp'
    ? void saveTemplate()
    : void saveEmailTemplate()
}
disabled={
  activeChannel === 'whatsapp'
    ? saving || loading
    : savingEmail || loadingEmail
}
```

Render `Novo` and `Enviar Meta` only when `activeChannel === 'whatsapp'`.

- [ ] **Step 6: Render the Email editor and preview**

Wrap the existing WhatsApp status and grid in `activeChannel === 'whatsapp'`.

Add the Email grid when `activeChannel === 'email'`:

```tsx
<div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_420px]">
  <section className="rounded-md border border-slate-200 bg-white">
    <div className="border-b border-slate-200 px-4 py-3">
      <h2 className="text-sm font-semibold text-slate-900">Emails</h2>
    </div>
    <div className="max-h-155 overflow-y-auto p-2">
      {loadingEmail ? (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} />
          Carregando templates
        </div>
      ) : (
        emailTemplates.map((template) => {
          const active = template.id === emailForm.id;

          return (
            <button
              key={template.id}
              type="button"
              onClick={() => selectEmailTemplate(template)}
              className={`mb-2 w-full rounded-md border px-3 py-3 text-left transition ${
                active
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span className="block truncate text-sm font-semibold text-slate-900">
                {template.name}
              </span>
              <span
                className={`mt-2 inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
                  template.isActive
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {template.isActive ? 'Ativo' : 'Inativo'}
              </span>
            </button>
          );
        })
      )}
    </div>
  </section>

  <section className="rounded-md border border-slate-200 bg-white p-5">
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <label className="space-y-1.5">
        <span className="text-sm font-medium text-slate-700">
          Tipo de template
        </span>
        <select
          value={emailForm.slug}
          disabled
          className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          {TEMPLATE_OPTIONS.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => updateEmailForm('isActive', !emailForm.isActive)}
        className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
      >
        {emailForm.isActive ? (
          <ToggleRight className="text-emerald-600" size={22} />
        ) : (
          <ToggleLeft className="text-slate-500" size={22} />
        )}
        {emailForm.isActive ? 'Ativo' : 'Inativo'}
      </button>
    </div>

    <label className="mt-5 block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">
        Assunto do email
      </span>
      <input
        aria-label="Assunto do email"
        value={emailForm.subject}
        onChange={(event) => updateEmailForm('subject', event.target.value)}
        maxLength={160}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>

    <div className="mt-5 space-y-2">
      <span className="text-sm font-medium text-slate-700">Placeholders</span>
      <div className="flex flex-wrap gap-2">
        {VARIABLES.map((variable) => (
          <button
            key={variable.tag}
            type="button"
            onClick={() => insertEmailVariable(variable.tag)}
            title={variable.tag}
            className="max-w-full rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-left text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
          >
            <span className="block">{variable.label}</span>
            <code className="block break-all font-mono text-[11px] font-medium text-emerald-900">
              {variable.tag}
            </code>
          </button>
        ))}
      </div>
    </div>

    <label className="mt-5 block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">Corpo do email</span>
      <textarea
        aria-label="Corpo do email"
        value={emailForm.content}
        onChange={(event) => updateEmailForm('content', event.target.value)}
        rows={12}
        className="w-full resize-none rounded-md border border-slate-300 px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  </section>
</div>
```

Add an email preview aside with:

```tsx
const emailPreviewSubject = useMemo(
  () => renderPreviewText(emailForm.subject),
  [emailForm.subject],
);
const emailPreviewBody = useMemo(
  () => renderPreviewText(emailForm.content),
  [emailForm.content],
);
const emailPreviewParagraphs = useMemo(
  () =>
    emailPreviewBody
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0),
  [emailPreviewBody],
);
```

Use this preview aside as the third column of the Email grid:

```tsx
<aside className="rounded-md border border-slate-200 bg-white">
  <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
    <Mail size={18} />
    <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
  </div>

  <div className="bg-slate-100 p-5">
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase text-slate-500">
          Assunto
        </p>
        <p className="mt-1 break-words text-sm font-semibold text-slate-950">
          {emailPreviewSubject || 'O assunto aparecera aqui.'}
        </p>
      </div>

      <div className="bg-emerald-600 px-5 py-5 text-white">
        <p className="text-lg font-bold">Clinica Exemplo</p>
        <p className="mt-1 text-sm text-emerald-50">Cobranca via Pix</p>
      </div>

      <div className="space-y-4 px-5 py-5 text-sm leading-6 text-slate-700">
        {emailPreviewParagraphs.length > 0 ? (
          emailPreviewParagraphs.map((paragraph) => (
            <p key={paragraph} className="whitespace-pre-line break-words">
              {paragraph}
            </p>
          ))
        ) : (
          <p>O corpo do email aparecera aqui.</p>
        )}

        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          <div className="border-r border-slate-200 p-3">
            <span className="text-xs text-slate-500">Valor</span>
            <p className="mt-1 text-lg font-bold text-emerald-700">
              R$ 150,00
            </p>
          </div>
          <div className="p-3">
            <span className="text-xs text-slate-500">Vencimento</span>
            <p className="mt-1 font-semibold text-slate-900">22/04/2026</p>
          </div>
        </div>

        <button
          type="button"
          className="w-full rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white"
        >
          Pagar agora
        </button>
      </div>
    </div>
  </div>
</aside>
```

- [ ] **Step 7: Run the frontend test and verify it passes**

Run:

```bash
cd front-cobranca && npx jest src/app/\(dashboard\)/configuracoes/templates/__tests__/page.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add front-cobranca/src/app/\(dashboard\)/configuracoes/templates/page.tsx front-cobranca/src/app/\(dashboard\)/configuracoes/templates/__tests__/page.test.tsx
git commit -m "feat: add email template editor"
```

---

### Task 7: Full Verification

**Files:**
- Verify all modified backend and frontend files.

- [ ] **Step 1: Run focused backend tests**

```bash
cd api-cobranca && npm test -- email-templates.service.spec.ts billing.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run backend build**

```bash
cd api-cobranca && npm run build
```

Expected: PASS.

- [ ] **Step 3: Run focused frontend tests**

```bash
cd front-cobranca && npx jest src/app/\(dashboard\)/configuracoes/templates/__tests__/page.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run frontend lint**

```bash
cd front-cobranca && npm run lint
```

Expected: PASS or only pre-existing warnings unrelated to the changed templates files.

- [ ] **Step 5: Run frontend build**

```bash
cd front-cobranca && npm run build
```

Expected: PASS.

- [ ] **Step 6: Start the frontend dev server for manual UI review**

```bash
cd front-cobranca && npm run dev
```

Expected: Next.js starts on `http://localhost:3000` or the next available port.

- [ ] **Step 7: Manual browser checks**

Open the templates page and verify:

- The default channel is WhatsApp.
- WhatsApp component tabs, Meta status, save and submit actions still appear.
- The Email tab loads templates.
- The Email subject/body editor updates the preview.
- Saving Email shows a success message.
- No controls overlap at desktop width and mobile width.

- [ ] **Step 8: Final git review**

```bash
git status --short
git diff --stat HEAD
```

Expected: only intentional changes for Email templates plus pre-existing unrelated workspace changes.
