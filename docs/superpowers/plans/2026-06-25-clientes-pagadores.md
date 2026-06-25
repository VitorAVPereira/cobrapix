# Clientes Pagadores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a company-facing `Clientes` page backed by first-class debtor CRUD, defaulting new clients to the `NEW` payer profile and showing operational invoice summaries.

**Architecture:** Keep `Debtor` as the source of truth and add focused debtor list/create/update methods to `InvoicesService` plus authenticated routes under `/invoices/debtors`. The frontend adds typed API client methods, a new operational `/clientes` page, sidebar navigation, and URL-driven filtering in `/cobrancas`.

**Tech Stack:** NestJS, Prisma, class-validator, Jest, Next.js App Router, React client components, TailwindCSS, lucide-react, Testing Library.

---

## File Structure

- Modify `api-cobranca/src/invoices/dto/invoice.dto.ts`: add `CreateDebtorDto` and `UpdateDebtorDto`; tighten collection profile typing for new debtor flows.
- Modify `api-cobranca/src/invoices/invoices.controller.ts`: add `GET /invoices/debtors`, `POST /invoices/debtors`, `PUT /invoices/debtors/:debtorId`, and `debtorId` support for `GET /invoices`.
- Modify `api-cobranca/src/invoices/invoices.service.ts`: add debtor CRUD/listing, default `NEW` profile resolution, legacy profile backfill, invoice `debtorId` filtering, and mapper helpers.
- Modify `api-cobranca/src/invoices/invoices.service.spec.ts`: cover debtor CRUD/listing/default profile/filter behavior.
- Modify `front-cobranca/src/lib/api-client.ts`: add debtor types/methods and extend invoice query params.
- Create `front-cobranca/src/lib/__tests__/api-client-debtors.test.ts`: verify debtor endpoints and invoice query string.
- Modify `front-cobranca/src/components/ui/Sidebar.tsx`: add company-admin `Clientes` navigation item.
- Modify `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`: expect company admins to see `/clientes`, while platform admins still see `/admin/clientes`.
- Create `front-cobranca/src/app/(dashboard)/clientes/page.tsx`: client component for the operational clients table, modal, filters, action menu, and reused debtor modals.
- Create `front-cobranca/src/app/(dashboard)/clientes/__tests__/page.test.tsx`: cover rendering, creating, editing, action menu, and open-invoices navigation.
- Modify `front-cobranca/src/app/(dashboard)/cobrancas/page.tsx`: read `debtorId` and `status` from URL, pass them to `getInvoices`, and allow new-charge links from `Clientes` to open the existing debtor invoice flow.
- Modify `front-cobranca/src/components/features/DebtorSettingsModal.tsx`: remove the "Sem perfil manual" path when profile is required by the new invariant.

---

### Task 1: Backend DTOs And Service Contract Tests

**Files:**
- Modify: `api-cobranca/src/invoices/dto/invoice.dto.ts`
- Modify: `api-cobranca/src/invoices/invoices.service.spec.ts`
- Modify later in this task: `api-cobranca/src/invoices/invoices.service.ts`

- [ ] **Step 1: Add debtor DTOs**

Add these imports to `api-cobranca/src/invoices/dto/invoice.dto.ts` if missing:

```ts
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
```

Then add these classes after `CreateDebtorInvoiceDto`:

```ts
export class CreateDebtorDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  document!: string;

  @Matches(/^\+?[\d\s().-]{10,24}$/)
  phone_number!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsOptional()
  @IsUUID('4')
  collectionProfileId?: string;
}

export class UpdateDebtorDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @Matches(/^\+?[\d\s().-]{10,24}$/)
  phone_number?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  whatsappOptIn?: boolean;

  @IsOptional()
  @IsUUID('4')
  collectionProfileId?: string;
}
```

- [ ] **Step 2: Add failing service tests for debtor create/update/list**

Append this `describe` block near the end of the existing top-level `describe('InvoicesService', () => {` block in `api-cobranca/src/invoices/invoices.service.spec.ts`:

```ts
  describe('clientes pagadores', () => {
    const defaultProfile = {
      id: 'profile-new',
      name: 'Novo Cliente',
      profileType: 'NEW',
    };

    function buildDebtor(overrides: Partial<{
      id: string;
      name: string;
      document: string;
      phoneNumber: string;
      email: string | null;
      collectionProfileId: string | null;
    }> = {}) {
      return {
        id: overrides.id ?? 'debtor-1',
        companyId: 'company-1',
        name: overrides.name ?? 'Maria Silva',
        document: overrides.document ?? '12345678909',
        phoneNumber: overrides.phoneNumber ?? '+5511999999999',
        email: overrides.email ?? null,
        whatsappOptIn: false,
        whatsappOptInAt: null,
        whatsappOptInSource: null,
        collectionProfileId:
          overrides.collectionProfileId === undefined
            ? defaultProfile.id
            : overrides.collectionProfileId,
        collectionProfile:
          overrides.collectionProfileId === null ? null : defaultProfile,
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        updatedAt: new Date('2026-06-02T12:00:00.000Z'),
        invoices: [],
      };
    }

    it('cria cliente sem cobranca com perfil NEW quando nenhum perfil e enviado', async () => {
      const debtorCreate = jest.fn().mockResolvedValue(buildDebtor());
      const profileFindFirst = jest.fn().mockResolvedValue(defaultProfile);
      const prisma = {
        collectionProfile: { findFirst: profileFindFirst },
        debtor: {
          findMany: jest.fn().mockResolvedValue([]),
          create: debtorCreate,
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      const result = await service.createDebtor('company-1', {
        name: 'Maria Silva',
        document: '123.456.789-09',
        phone_number: '11999999999',
        email: null,
        whatsappOptIn: false,
      });

      expect(profileFindFirst).toHaveBeenCalledWith({
        where: { companyId: 'company-1', profileType: 'NEW', isActive: true },
        select: { id: true, name: true, profileType: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      expect(debtorCreate).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          name: 'Maria Silva',
          document: '12345678909',
          phoneNumber: '+5511999999999',
          email: null,
          whatsappOptIn: false,
          whatsappOptInAt: null,
          whatsappOptInSource: null,
          collectionProfileId: 'profile-new',
        },
        include: { collectionProfile: true },
      });
      expect(result.collectionProfile.profileType).toBe('NEW');
      expect(result.openInvoicesCount).toBe(0);
      expect(result.paidInvoicesCount).toBe(0);
    });

    it('rejeita cliente novo com WhatsApp duplicado na empresa', async () => {
      const prisma = {
        collectionProfile: { findFirst: jest.fn().mockResolvedValue(defaultProfile) },
        debtor: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'existing', phoneNumber: '+5511999999999' },
          ]),
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      await expect(
        service.createDebtor('company-1', {
          name: 'Maria Silva',
          document: '12345678909',
          phone_number: '11999999999',
          email: null,
          whatsappOptIn: false,
        }),
      ).rejects.toThrow('Ja existe cliente com este WhatsApp.');
    });

    it('lista clientes com totais de cobrancas e backfill de perfil NEW', async () => {
      const debtorWithInvoices = {
        ...buildDebtor(),
        invoices: [
          {
            status: 'PENDING',
            originalAmount: decimal(120),
            createdAt: new Date('2026-06-04T12:00:00.000Z'),
            paidAt: null,
          },
          {
            status: 'PAID',
            originalAmount: decimal(80),
            createdAt: new Date('2026-06-01T12:00:00.000Z'),
            paidAt: new Date('2026-06-03T12:00:00.000Z'),
          },
        ],
      };
      const debtorFindMany = jest.fn().mockResolvedValue([debtorWithInvoices]);
      const prisma = {
        collectionProfile: { findFirst: jest.fn().mockResolvedValue(defaultProfile) },
        debtor: {
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
          findMany: debtorFindMany,
          count: jest.fn().mockResolvedValue(1),
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      const result = await service.listDebtors('company-1', {
        page: 1,
        pageSize: 20,
        search: 'maria',
      });

      expect(prisma.debtor.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', collectionProfileId: null },
        data: { collectionProfileId: 'profile-new' },
      });
      expect(debtorFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-1' }) as unknown,
          include: expect.objectContaining({
            collectionProfile: true,
            invoices: expect.objectContaining({
              where: { status: { in: ['PENDING', 'PAID'] } },
            }) as unknown,
          }) as unknown,
        }),
      );
      expect(result.summary).toEqual({
        totalDebtors: 1,
        openInvoiceAmount: 120,
        openInvoiceCount: 1,
        paidInvoiceAmount: 80,
        paidInvoiceCount: 1,
      });
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          debtorId: 'debtor-1',
          openInvoicesCount: 1,
          openInvoicesAmount: 120,
          paidInvoicesCount: 1,
          paidInvoicesAmount: 80,
          collectionProfile: defaultProfile,
        }),
      );
    });

    it('edita cliente e rejeita remocao de perfil', async () => {
      const debtorFindFirst = jest.fn().mockResolvedValue({ id: 'debtor-1' });
      const debtorUpdate = jest.fn().mockResolvedValue(
        buildDebtor({ name: 'Maria Editada', email: 'maria@email.com' }),
      );
      const prisma = {
        collectionProfile: { findFirst: jest.fn().mockResolvedValue(defaultProfile) },
        debtor: {
          findFirst: debtorFindFirst,
          findMany: jest.fn().mockResolvedValue([]),
          update: debtorUpdate,
        },
      } as unknown as PrismaService;
      const service = new InvoicesService(
        prisma,
        buildMessageQueue(),
        buildPaymentService(),
      );

      const result = await service.updateDebtor('company-1', 'debtor-1', {
        name: 'Maria Editada',
        document: '123.456.789-09',
        phone_number: '+55 11 99999-9999',
        email: 'maria@email.com',
        collectionProfileId: 'profile-new',
      });

      expect(result?.name).toBe('Maria Editada');
      expect(debtorUpdate).toHaveBeenCalledWith({
        where: { id: 'debtor-1' },
        data: expect.objectContaining({
          name: 'Maria Editada',
          document: '12345678909',
          phoneNumber: '+5511999999999',
          email: 'maria@email.com',
          collectionProfileId: 'profile-new',
        }) as unknown,
        include: { collectionProfile: true },
      });

      await expect(
        service.updateDebtor('company-1', 'debtor-1', {
          collectionProfileId: null as unknown as string,
        }),
      ).rejects.toThrow('Perfil de pagador e obrigatorio.');
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd api-cobranca
npm test -- invoices.service.spec.ts --runInBand
```

Expected: FAIL with TypeScript or runtime errors naming missing `createDebtor`, `listDebtors`, and `updateDebtor` methods.

- [ ] **Step 4: Add debtor service types and method signatures**

In `api-cobranca/src/invoices/invoices.service.ts`, add these interfaces near the existing debtor interfaces:

```ts
interface DebtorCollectionProfileSummary {
  id: string;
  name: string;
  profileType: CollectionProfileType;
}

interface CreateDebtorInput {
  name: string;
  document: string;
  phone_number: string;
  email?: string | null;
  whatsappOptIn?: boolean;
  collectionProfileId?: string;
}

interface UpdateDebtorInput {
  name?: string;
  document?: string;
  phone_number?: string;
  email?: string | null;
  whatsappOptIn?: boolean;
  collectionProfileId?: string;
}

interface DebtorListParams {
  page: number;
  pageSize: number;
  search?: string;
  profileId?: string;
  paymentStatus?: 'all' | 'open' | 'paid' | 'no_open';
}

export interface DebtorListSummary {
  totalDebtors: number;
  openInvoiceAmount: number;
  openInvoiceCount: number;
  paidInvoiceAmount: number;
  paidInvoiceCount: number;
}

export interface DebtorListItem {
  debtorId: string;
  name: string;
  document: string;
  phone_number: string;
  email: string | null;
  whatsapp_opt_in: boolean;
  whatsappOptInAt: string | null;
  collectionProfile: DebtorCollectionProfileSummary;
  openInvoicesCount: number;
  openInvoicesAmount: number;
  paidInvoicesCount: number;
  paidInvoicesAmount: number;
  lastInvoiceAt: string | null;
  lastPaymentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DebtorWithSummaryRelations {
  id: string;
  name: string;
  document: string | null;
  phoneNumber: string;
  email: string | null;
  whatsappOptIn: boolean;
  whatsappOptInAt: Date | null;
  collectionProfile: DebtorCollectionProfileSummary | null;
  createdAt: Date;
  updatedAt: Date;
  invoices: Array<{
    status: string;
    originalAmount: { toNumber(): number };
    createdAt: Date;
    paidAt: Date | null;
  }>;
}
```

Add method stubs before `createInvoice`:

```ts
  async listDebtors(
    companyId: string,
    params: DebtorListParams,
  ): Promise<{
    data: DebtorListItem[];
    total: number;
    page: number;
    pageSize: number;
    summary: DebtorListSummary;
  }> {
    throw new Error('listDebtors not implemented');
  }

  async createDebtor(
    companyId: string,
    input: CreateDebtorInput,
  ): Promise<DebtorListItem> {
    throw new Error('createDebtor not implemented');
  }

  async updateDebtor(
    companyId: string,
    debtorId: string,
    input: UpdateDebtorInput,
  ): Promise<DebtorListItem | null> {
    throw new Error('updateDebtor not implemented');
  }
```

- [ ] **Step 5: Implement default profile and debtor mapper helpers**

Replace the stubs with implementations that call these helpers. Add helpers near `resolveCollectionProfileId`:

```ts
  private async getDefaultNewDebtorProfile(
    companyId: string,
  ): Promise<DebtorCollectionProfileSummary> {
    const profile = await this.prisma.collectionProfile.findFirst({
      where: { companyId, profileType: 'NEW', isActive: true },
      select: { id: true, name: true, profileType: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    if (!profile) {
      throw new BadRequestException(
        'Perfil Novo pagador nao encontrado para esta empresa.',
      );
    }

    return profile;
  }

  private async resolveRequiredCollectionProfileId(
    companyId: string,
    collectionProfileId: string | undefined,
  ): Promise<string> {
    if (!collectionProfileId) {
      return (await this.getDefaultNewDebtorProfile(companyId)).id;
    }

    const profile = await this.prisma.collectionProfile.findFirst({
      where: { id: collectionProfileId, companyId, isActive: true },
      select: { id: true },
    });

    if (!profile) {
      throw new BadRequestException('Perfil de cobranca invalido.');
    }

    return profile.id;
  }

  private async backfillMissingDebtorProfiles(companyId: string): Promise<void> {
    const defaultProfile = await this.getDefaultNewDebtorProfile(companyId);
    await this.prisma.debtor.updateMany({
      where: { companyId, collectionProfileId: null },
      data: { collectionProfileId: defaultProfile.id },
    });
  }

  private mapDebtorListItem(debtor: DebtorWithSummaryRelations): DebtorListItem {
    if (!debtor.collectionProfile) {
      throw new BadRequestException('Cliente sem perfil de pagador.');
    }

    const openInvoices = debtor.invoices.filter(
      (invoice) => invoice.status === 'PENDING',
    );
    const paidInvoices = debtor.invoices.filter(
      (invoice) => invoice.status === 'PAID',
    );
    const sumAmount = (
      invoices: Array<{ originalAmount: { toNumber(): number } }>,
    ): number =>
      Number(
        invoices
          .reduce((sum, invoice) => sum + invoice.originalAmount.toNumber(), 0)
          .toFixed(2),
      );
    const lastInvoiceAt =
      debtor.invoices
        .map((invoice) => invoice.createdAt)
        .sort((left, right) => right.getTime() - left.getTime())[0]
        ?.toISOString() ?? null;
    const lastPaymentAt =
      paidInvoices
        .map((invoice) => invoice.paidAt)
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => right.getTime() - left.getTime())[0]
        ?.toISOString() ?? null;

    return {
      debtorId: debtor.id,
      name: debtor.name,
      document: debtor.document ?? '',
      phone_number: this.normalizePhoneNumberForResponse(debtor.phoneNumber),
      email: debtor.email,
      whatsapp_opt_in: debtor.whatsappOptIn,
      whatsappOptInAt: debtor.whatsappOptInAt?.toISOString() ?? null,
      collectionProfile: debtor.collectionProfile,
      openInvoicesCount: openInvoices.length,
      openInvoicesAmount: sumAmount(openInvoices),
      paidInvoicesCount: paidInvoices.length,
      paidInvoicesAmount: sumAmount(paidInvoices),
      lastInvoiceAt,
      lastPaymentAt,
      createdAt: debtor.createdAt.toISOString(),
      updatedAt: debtor.updatedAt.toISOString(),
    };
  }
```

- [ ] **Step 6: Implement listDebtors**

Use this implementation shape:

```ts
  async listDebtors(
    companyId: string,
    params: DebtorListParams,
  ): Promise<{
    data: DebtorListItem[];
    total: number;
    page: number;
    pageSize: number;
    summary: DebtorListSummary;
  }> {
    await this.backfillMissingDebtorProfiles(companyId);

    const where: Prisma.DebtorWhereInput = { companyId };
    if (params.profileId) {
      where.collectionProfileId = params.profileId;
    }
    if (params.search) {
      const normalizedDocument = normalizeDebtorDocument(params.search);
      const normalizedPhone = params.search.replace(/\D/g, '');
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { document: { contains: normalizedDocument || params.search } },
        { phoneNumber: { contains: normalizedPhone || params.search } },
        { email: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.paymentStatus === 'open') {
      where.invoices = { some: { status: 'PENDING' } };
    }
    if (params.paymentStatus === 'paid') {
      where.invoices = { some: { status: 'PAID' } };
    }
    if (params.paymentStatus === 'no_open') {
      where.invoices = { none: { status: 'PENDING' } };
    }

    const include = {
      collectionProfile: {
        select: { id: true, name: true, profileType: true },
      },
      invoices: {
        where: { status: { in: ['PENDING', 'PAID'] } },
        select: {
          status: true,
          originalAmount: true,
          createdAt: true,
          paidAt: true,
        },
      },
    };

    const [debtors, total] = await Promise.all([
      this.prisma.debtor.findMany({
        where,
        include,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.debtor.count({ where }),
    ]);

    const data = debtors.map((debtor) =>
      this.mapDebtorListItem(debtor as DebtorWithSummaryRelations),
    );
    const summary = data.reduce<DebtorListSummary>(
      (acc, debtor) => ({
        totalDebtors: total,
        openInvoiceAmount: Number(
          (acc.openInvoiceAmount + debtor.openInvoicesAmount).toFixed(2),
        ),
        openInvoiceCount: acc.openInvoiceCount + debtor.openInvoicesCount,
        paidInvoiceAmount: Number(
          (acc.paidInvoiceAmount + debtor.paidInvoicesAmount).toFixed(2),
        ),
        paidInvoiceCount: acc.paidInvoiceCount + debtor.paidInvoicesCount,
      }),
      {
        totalDebtors: total,
        openInvoiceAmount: 0,
        openInvoiceCount: 0,
        paidInvoiceAmount: 0,
        paidInvoiceCount: 0,
      },
    );

    return { data, total, page: params.page, pageSize: params.pageSize, summary };
  }
```

- [ ] **Step 7: Implement createDebtor and updateDebtor**

Use `ConflictException` for duplicate WhatsApp and `BadRequestException` for empty profile:

```ts
  async createDebtor(
    companyId: string,
    input: CreateDebtorInput,
  ): Promise<DebtorListItem> {
    const document = this.normalizeRequiredDebtorDocument(input.document);
    const phoneNumber = normalizeWhatsAppNumber(input.phone_number);
    const lookupCandidates = getWhatsAppNumberLookupCandidates(phoneNumber);
    const existingDebtors = await this.prisma.debtor.findMany({
      where: { companyId, phoneNumber: { in: lookupCandidates } },
      select: { id: true, phoneNumber: true },
    });

    if (existingDebtors.length > 0) {
      throw new ConflictException('Ja existe cliente com este WhatsApp.');
    }

    const collectionProfileId = await this.resolveRequiredCollectionProfileId(
      companyId,
      input.collectionProfileId,
    );
    const debtor = await this.prisma.debtor.create({
      data: {
        companyId,
        name: input.name.trim(),
        document,
        phoneNumber,
        email: input.email?.trim() || null,
        whatsappOptIn: input.whatsappOptIn === true,
        whatsappOptInAt: input.whatsappOptIn === true ? new Date() : null,
        whatsappOptInSource:
          input.whatsappOptIn === true ? 'manual-client-page' : null,
        collectionProfileId,
      },
      include: { collectionProfile: true },
    });

    return this.mapDebtorListItem({
      ...debtor,
      invoices: [],
    } as DebtorWithSummaryRelations);
  }

  async updateDebtor(
    companyId: string,
    debtorId: string,
    input: UpdateDebtorInput,
  ): Promise<DebtorListItem | null> {
    const current = await this.prisma.debtor.findFirst({
      where: { id: debtorId, companyId },
      select: { id: true, phoneNumber: true, whatsappOptInAt: true },
    });

    if (!current) {
      return null;
    }

    const data: Prisma.DebtorUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.document !== undefined) {
      data.document = this.normalizeRequiredDebtorDocument(input.document);
    }
    if (input.email !== undefined) {
      data.email = input.email?.trim() || null;
    }
    if (input.phone_number !== undefined) {
      const phoneNumber = normalizeWhatsAppNumber(input.phone_number);
      const lookupCandidates = getWhatsAppNumberLookupCandidates(phoneNumber);
      const existingDebtor = await this.prisma.debtor.findMany({
        where: {
          companyId,
          phoneNumber: { in: lookupCandidates },
          NOT: { id: debtorId },
        },
        select: { id: true },
      });
      if (existingDebtor.length > 0) {
        throw new ConflictException('Ja existe cliente com este WhatsApp.');
      }
      data.phoneNumber = phoneNumber;
    }
    if (input.collectionProfileId !== undefined) {
      if (!input.collectionProfileId) {
        throw new BadRequestException('Perfil de pagador e obrigatorio.');
      }
      data.collectionProfile = {
        connect: {
          id: await this.resolveRequiredCollectionProfileId(
            companyId,
            input.collectionProfileId,
          ),
        },
      };
    }
    if (input.whatsappOptIn !== undefined) {
      data.whatsappOptIn = input.whatsappOptIn;
      data.whatsappOptInAt = input.whatsappOptIn
        ? current.whatsappOptInAt ?? new Date()
        : null;
      data.whatsappOptInSource = input.whatsappOptIn
        ? 'manual-client-page'
        : 'manual-client-page-revoked';
    }

    const debtor = await this.prisma.debtor.update({
      where: { id: debtorId },
      data,
      include: { collectionProfile: true },
    });

    return this.mapDebtorListItem({
      ...debtor,
      invoices: [],
    } as DebtorWithSummaryRelations);
  }
```

- [ ] **Step 8: Run backend service tests**

Run:

```bash
cd api-cobranca
npm test -- invoices.service.spec.ts --runInBand
```

Expected: PASS for the new debtor tests and existing invoice tests.

- [ ] **Step 9: Commit backend service work**

```bash
git add api-cobranca/src/invoices/dto/invoice.dto.ts api-cobranca/src/invoices/invoices.service.ts api-cobranca/src/invoices/invoices.service.spec.ts
git commit -m "feat: add debtor service operations"
```

---

### Task 2: Backend Routes And Invoice Filtering

**Files:**
- Modify: `api-cobranca/src/invoices/invoices.controller.ts`
- Modify: `api-cobranca/src/invoices/invoices.service.ts`
- Test: `api-cobranca/src/invoices/invoices.service.spec.ts`

- [ ] **Step 1: Add failing test for debtorId filtering in findPaginated**

Append this test to `api-cobranca/src/invoices/invoices.service.spec.ts`:

```ts
  it('filtra cobrancas por debtorId e status na listagem paginada', async () => {
    const invoiceFindMany = jest.fn().mockResolvedValue([]);
    const invoiceCount = jest.fn().mockResolvedValue(0);
    const prisma = {
      invoice: {
        findMany: invoiceFindMany,
        count: invoiceCount,
      },
    } as unknown as PrismaService;
    const service = new InvoicesService(
      prisma,
      buildMessageQueue(),
      buildPaymentService(),
    );

    await service.findPaginated('company-1', {
      page: 1,
      pageSize: 20,
      debtorId: 'debtor-1',
      status: 'PENDING',
    });

    expect(invoiceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', debtorId: 'debtor-1', status: 'PENDING' },
      }),
    );
    expect(invoiceCount).toHaveBeenCalledWith({
      where: { companyId: 'company-1', debtorId: 'debtor-1', status: 'PENDING' },
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd api-cobranca
npm test -- invoices.service.spec.ts --runInBand
```

Expected: FAIL because `debtorId` is not accepted by the `findPaginated` params type or is not applied to the Prisma where clause.

- [ ] **Step 3: Extend findPaginated params and where clause**

In `api-cobranca/src/invoices/invoices.service.ts`, update the params type and where construction:

```ts
      debtorId?: string;
```

Add after status handling:

```ts
    if (params.debtorId) {
      where.debtorId = params.debtorId;
    }
```

- [ ] **Step 4: Add controller routes**

Update imports in `api-cobranca/src/invoices/invoices.controller.ts`:

```ts
  CreateDebtorDto,
  CreateDebtorInvoiceDto,
  CreateInvoiceDto,
  UpdateDebtorDto,
  UpdateDebtorSettingsDto,
  UpdateRecurringInvoiceDto,
```

Update `findAll` signature and service call:

```ts
    @Query('status') status?: string,
    @Query('debtorId') debtorId?: string,
```

```ts
    if (debtorId && !this.isUuid(debtorId)) {
      throw new HttpException('Cliente invalido.', HttpStatus.BAD_REQUEST);
    }
```

```ts
      debtorId: debtorId || undefined,
```

Add routes before `@Post('debtors/:debtorId/invoices')`:

```ts
  @Get('debtors')
  async listDebtors(
    @GetUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('profileId') profileId?: string,
    @Query('paymentStatus') paymentStatus?: string,
  ): Promise<unknown> {
    if (profileId && !this.isUuid(profileId)) {
      throw new HttpException('Perfil invalido.', HttpStatus.BAD_REQUEST);
    }

    const normalizedPaymentStatus = this.normalizeDebtorPaymentStatus(
      paymentStatus,
    );

    return this.invoicesService.listDebtors(user.companyId, {
      page: this.parsePositiveInt(page, 1),
      pageSize: Math.min(
        Math.max(this.parsePositiveInt(pageSize, 20), 1),
        100,
      ),
      search: search?.trim() || undefined,
      profileId: profileId || undefined,
      paymentStatus: normalizedPaymentStatus,
    });
  }

  @Post('debtors')
  async createDebtor(
    @GetUser() user: AuthenticatedUser,
    @Body() dto: CreateDebtorDto,
  ): Promise<unknown> {
    return this.invoicesService.createDebtor(user.companyId, {
      name: dto.name,
      document: dto.document,
      phone_number: dto.phone_number,
      email: dto.email,
      whatsappOptIn: dto.whatsappOptIn,
      collectionProfileId: dto.collectionProfileId,
    });
  }

  @Put('debtors/:debtorId')
  async updateDebtor(
    @GetUser() user: AuthenticatedUser,
    @Param('debtorId') debtorId: string,
    @Body() dto: UpdateDebtorDto,
  ): Promise<unknown> {
    if (!this.isUuid(debtorId)) {
      throw new HttpException('Cliente invalido.', HttpStatus.BAD_REQUEST);
    }

    const debtor = await this.invoicesService.updateDebtor(
      user.companyId,
      debtorId,
      {
        name: dto.name,
        document: dto.document,
        phone_number: dto.phone_number,
        email: dto.email,
        whatsappOptIn: dto.whatsappOptIn,
        collectionProfileId: dto.collectionProfileId,
      },
    );

    if (!debtor) {
      throw new HttpException('Cliente nao encontrado.', HttpStatus.NOT_FOUND);
    }

    return debtor;
  }
```

Add helper:

```ts
  private normalizeDebtorPaymentStatus(
    value?: string,
  ): 'all' | 'open' | 'paid' | 'no_open' | undefined {
    if (!value || value === 'all') return undefined;

    if (value === 'open' || value === 'paid' || value === 'no_open') {
      return value;
    }

    throw new HttpException(
      'Filtro de pagamento invalido.',
      HttpStatus.BAD_REQUEST,
    );
  }
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd api-cobranca
npm test -- invoices.service.spec.ts --runInBand
npm run lint
```

Expected: PASS for tests and lint.

- [ ] **Step 6: Commit backend route work**

```bash
git add api-cobranca/src/invoices/invoices.controller.ts api-cobranca/src/invoices/invoices.service.ts api-cobranca/src/invoices/invoices.service.spec.ts
git commit -m "feat: expose debtor endpoints"
```

---

### Task 3: Frontend API Client

**Files:**
- Modify: `front-cobranca/src/lib/api-client.ts`
- Create: `front-cobranca/src/lib/__tests__/api-client-debtors.test.ts`

- [ ] **Step 1: Write failing API client tests**

Create `front-cobranca/src/lib/__tests__/api-client-debtors.test.ts`:

```ts
import {
  ApiClient,
  type CreateDebtorInput,
  type UpdateDebtorInput,
} from "../api-client";

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

global.fetch = mockFetch;

describe("ApiClient debtors", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
        summary: {
          totalDebtors: 0,
          openInvoiceAmount: 0,
          openInvoiceCount: 0,
          paidInvoiceAmount: 0,
          paidInvoiceCount: 0,
        },
      }),
    } as Response);
  });

  it("fetches debtors with filled query params only", async () => {
    const apiClient = new ApiClient("http://api.test", "token");

    await apiClient.getDebtors({
      page: 2,
      pageSize: 50,
      search: "maria",
      profileId: "profile-1",
      paymentStatus: "open",
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/invoices/debtors?page=2&pageSize=50&search=maria&profileId=profile-1&paymentStatus=open",
    );
  });

  it("creates debtor using POST", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ debtorId: "debtor-1" }),
    } as Response);
    const apiClient = new ApiClient("http://api.test", "token");
    const input: CreateDebtorInput = {
      name: "Maria Silva",
      document: "12345678909",
      phone_number: "11999999999",
      email: null,
      whatsappOptIn: true,
    };

    await apiClient.createDebtor(input);

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/invoices/debtors",
    );
    expect(mockFetch.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(mockFetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));
  });

  it("updates debtor using PUT", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ debtorId: "debtor-1" }),
    } as Response);
    const apiClient = new ApiClient("http://api.test", "token");
    const input: UpdateDebtorInput = {
      name: "Maria Editada",
      email: "maria@email.com",
      collectionProfileId: "profile-new",
    };

    await apiClient.updateDebtor("debtor-1", input);

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/invoices/debtors/debtor-1",
    );
    expect(mockFetch.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(mockFetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));
  });

  it("fetches invoices with debtorId and status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0, page: 1, pageSize: 20 }),
    } as Response);
    const apiClient = new ApiClient("http://api.test", "token");

    await apiClient.getInvoices({
      debtorId: "debtor-1",
      status: "PENDING",
      page: 1,
      pageSize: 20,
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "http://api.test/invoices?page=1&pageSize=20&status=PENDING&debtorId=debtor-1",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd front-cobranca
npx jest src/lib/__tests__/api-client-debtors.test.ts --runInBand
```

Expected: FAIL with missing exported types or methods.

- [ ] **Step 3: Add API client types and methods**

In `front-cobranca/src/lib/api-client.ts`, add:

```ts
export type DebtorPaymentStatusFilter = "all" | "open" | "paid" | "no_open";

export interface DebtorListSummary {
  totalDebtors: number;
  openInvoiceAmount: number;
  openInvoiceCount: number;
  paidInvoiceAmount: number;
  paidInvoiceCount: number;
}

export interface DebtorListItem {
  debtorId: string;
  name: string;
  document: string;
  phone_number: string;
  email: string | null;
  whatsapp_opt_in: boolean;
  whatsappOptInAt: string | null;
  collectionProfile: {
    id: string;
    name: string;
    profileType: CollectionProfileType;
  };
  openInvoicesCount: number;
  openInvoicesAmount: number;
  paidInvoicesCount: number;
  paidInvoicesAmount: number;
  lastInvoiceAt: string | null;
  lastPaymentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DebtorListResponse {
  data: DebtorListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: DebtorListSummary;
}

export interface CreateDebtorInput {
  name: string;
  document: string;
  phone_number: string;
  email?: string | null;
  whatsappOptIn?: boolean;
  collectionProfileId?: string;
}

export interface UpdateDebtorInput {
  name?: string;
  document?: string;
  phone_number?: string;
  email?: string | null;
  whatsappOptIn?: boolean;
  collectionProfileId?: string;
}

export interface DebtorListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  profileId?: string;
  paymentStatus?: DebtorPaymentStatusFilter;
}
```

Extend `getInvoices` params with `debtorId?: string` and add:

```ts
    if (params.debtorId) qs.set("debtorId", params.debtorId);
```

Add methods:

```ts
  async getDebtors(
    params: DebtorListParams = {},
  ): Promise<DebtorListResponse> {
    const query = this.buildQueryString({
      page: params.page,
      pageSize: params.pageSize,
      search: params.search,
      profileId: params.profileId,
      paymentStatus: params.paymentStatus,
    });

    return this.fetch<DebtorListResponse>(`/invoices/debtors${query}`);
  }

  async createDebtor(data: CreateDebtorInput): Promise<DebtorListItem> {
    return this.fetch<DebtorListItem>("/invoices/debtors", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDebtor(
    debtorId: string,
    data: UpdateDebtorInput,
  ): Promise<DebtorListItem> {
    return this.fetch<DebtorListItem>(`/invoices/debtors/${debtorId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }
```

- [ ] **Step 4: Run API client tests**

Run:

```bash
cd front-cobranca
npx jest src/lib/__tests__/api-client-debtors.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit API client work**

```bash
git add front-cobranca/src/lib/api-client.ts front-cobranca/src/lib/__tests__/api-client-debtors.test.ts
git commit -m "feat: add debtor api client"
```

---

### Task 4: Sidebar Navigation

**Files:**
- Modify: `front-cobranca/src/components/ui/Sidebar.tsx`
- Modify: `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Update failing sidebar expectation**

In `front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx`, replace the final assertion in `"keeps operational navigation visible for company admins"`:

```ts
    expect(
      screen.getByRole("link", { name: /clientes/i }),
    ).toHaveAttribute("href", "/clientes");
```

Keep the platform-admin test expecting `/admin/clientes`.

- [ ] **Step 2: Run sidebar test to verify it fails**

Run:

```bash
cd front-cobranca
npx jest src/components/ui/__tests__/Sidebar.test.tsx --runInBand
```

Expected: FAIL because company admins do not yet see a `/clientes` link.

- [ ] **Step 3: Add Clientes item to company-admin menu**

In `front-cobranca/src/components/ui/Sidebar.tsx`, import `Users` from `lucide-react` and add this item to `mainItems` after `Cobrancas`:

```ts
  {
    href: "/clientes",
    label: "Clientes",
    icon: Users,
  },
```

- [ ] **Step 4: Run sidebar test**

Run:

```bash
cd front-cobranca
npx jest src/components/ui/__tests__/Sidebar.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit navigation work**

```bash
git add front-cobranca/src/components/ui/Sidebar.tsx front-cobranca/src/components/ui/__tests__/Sidebar.test.tsx
git commit -m "feat: add clients navigation"
```

---

### Task 5: Clientes Page

**Files:**
- Create: `front-cobranca/src/app/(dashboard)/clientes/page.tsx`
- Create: `front-cobranca/src/app/(dashboard)/clientes/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing page test**

Create `front-cobranca/src/app/(dashboard)/clientes/__tests__/page.test.tsx`:

```tsx
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClientesPage from "../page";

const push = jest.fn();
const getDebtors = jest.fn();
const getRules = jest.fn();
const createDebtor = jest.fn();
const updateDebtor = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => ({
    getDebtors,
    getRules,
    createDebtor,
    updateDebtor,
  }),
}));

jest.mock("@/components/features/DebtorPaymentHistoryModal", () => ({
  DebtorPaymentHistoryModal: ({ debtorName }: { debtorName: string }) => (
    <div>Historico de {debtorName}</div>
  ),
}));

jest.mock("@/components/features/DebtorSettingsModal", () => ({
  DebtorSettingsModal: ({ debtorName }: { debtorName: string }) => (
    <div>Configuracao de {debtorName}</div>
  ),
}));

const debtorResponse = {
  data: [
    {
      debtorId: "debtor-1",
      name: "Maria Silva",
      document: "12345678909",
      phone_number: "+5511999999999",
      email: null,
      whatsapp_opt_in: true,
      whatsappOptInAt: "2026-06-01T12:00:00.000Z",
      collectionProfile: {
        id: "profile-new",
        name: "Novo Cliente",
        profileType: "NEW",
      },
      openInvoicesCount: 2,
      openInvoicesAmount: 120,
      paidInvoicesCount: 3,
      paidInvoicesAmount: 300,
      lastInvoiceAt: "2026-06-04T12:00:00.000Z",
      lastPaymentAt: "2026-06-03T12:00:00.000Z",
      createdAt: "2026-06-01T12:00:00.000Z",
      updatedAt: "2026-06-02T12:00:00.000Z",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  summary: {
    totalDebtors: 1,
    openInvoiceAmount: 120,
    openInvoiceCount: 2,
    paidInvoiceAmount: 300,
    paidInvoiceCount: 3,
  },
};

describe("ClientesPage", () => {
  beforeEach(() => {
    push.mockReset();
    getDebtors.mockReset();
    getRules.mockReset();
    createDebtor.mockReset();
    updateDebtor.mockReset();
    getDebtors.mockResolvedValue(debtorResponse);
    getRules.mockResolvedValue([
      {
        id: "profile-new",
        companyId: "company-1",
        name: "Novo Cliente",
        profileType: "NEW",
        isDefault: true,
        isActive: true,
        daysOverdueMin: null,
        daysOverdueMax: null,
        steps: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
  });

  it("renders operational debtor data", async () => {
    render(<ClientesPage />);

    expect(await screen.findByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("Novo Cliente")).toBeInTheDocument();
    expect(screen.getByText("2 cobrancas")).toBeInTheDocument();
    expect(screen.getByText("3 pagas")).toBeInTheDocument();
    expect(screen.queryByText(/sem perfil/i)).not.toBeInTheDocument();
  });

  it("opens actions menu and navigates to open invoices", async () => {
    const user = userEvent.setup();
    render(<ClientesPage />);

    await screen.findByText("Maria Silva");
    await user.click(screen.getByRole("button", { name: /abrir acoes/i }));
    await user.click(screen.getByRole("menuitem", { name: /ver cobrancas em aberto/i }));

    expect(push).toHaveBeenCalledWith(
      "/cobrancas?debtorId=debtor-1&status=PENDING",
    );
  });

  it("creates debtor with Novo pagador as default profile", async () => {
    const user = userEvent.setup();
    createDebtor.mockResolvedValue(debtorResponse.data[0]);
    render(<ClientesPage />);

    await user.click(await screen.findByRole("button", { name: /novo cliente/i }));
    expect(screen.getByLabelText(/perfil de pagador/i)).toHaveValue("profile-new");
    await user.type(screen.getByLabelText(/^nome/i), "Joao Souza");
    await user.type(screen.getByLabelText(/cpf\/cnpj/i), "12345678909");
    await user.type(screen.getByLabelText(/whatsapp/i), "11999999999");
    await user.click(screen.getByRole("button", { name: /salvar cliente/i }));

    await waitFor(() => {
      expect(createDebtor).toHaveBeenCalledWith({
        name: "Joao Souza",
        document: "12345678909",
        phone_number: "11999999999",
        email: null,
        whatsappOptIn: false,
        collectionProfileId: "profile-new",
      });
    });
  });
});
```

- [ ] **Step 2: Run page test to verify it fails**

Run:

```bash
cd front-cobranca
npx jest 'src/app/(dashboard)/clientes/__tests__/page.test.tsx' --runInBand
```

Expected: FAIL because the page file does not exist.

- [ ] **Step 3: Implement page skeleton, format helpers, and load state**

Create `front-cobranca/src/app/(dashboard)/clientes/page.tsx` as a client component. Include these top-level helpers and state:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  History,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { DebtorPaymentHistoryModal } from "@/components/features/DebtorPaymentHistoryModal";
import { DebtorSettingsModal } from "@/components/features/DebtorSettingsModal";
import type {
  CollectionRuleProfile,
  DebtorListItem,
  DebtorPaymentStatusFilter,
} from "@/lib/api-client";
import { normalizeRequiredDebtorDocument } from "@/lib/debtor-document";
import { useApiClient } from "@/lib/use-api-client";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp-number";

interface ClientForm {
  name: string;
  document: string;
  whatsapp: string;
  email: string;
  whatsappOptIn: boolean;
  collectionProfileId: string;
}

const emptyForm: ClientForm = {
  name: "",
  document: "",
  whatsapp: "",
  email: "",
  whatsappOptIn: false,
  collectionProfileId: "",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string | string[] } }).data;
    if (Array.isArray(data?.message)) return data.message[0] ?? fallback;
    if (data?.message) return data.message;
  }
  return fallback;
}
```

Use `useEffect` to load `apiClient.getDebtors({ page: 1, pageSize: 20, search, profileId, paymentStatus })` and `apiClient.getRules()` in parallel. Render loading, error, cards, filters, table, modal, and action menu.

- [ ] **Step 4: Implement create/edit modal behavior**

Inside the page:

- Select default profile as `profiles.find((profile) => profile.profileType === "NEW")?.id ?? profiles[0]?.id ?? ""`.
- On "Novo cliente", set the form to `emptyForm` plus the default profile id.
- On edit, fill form from the selected debtor.
- Submit with:

```ts
const payload = {
  name: form.name.trim(),
  document: normalizeRequiredDebtorDocument(form.document),
  phone_number: normalizeWhatsAppNumber(form.whatsapp),
  email: form.email.trim() || null,
  whatsappOptIn: form.whatsappOptIn,
  collectionProfileId: form.collectionProfileId,
};
```

When editing, call `apiClient.updateDebtor(selected.debtorId, payload)`. When creating, call `apiClient.createDebtor(payload)`.

- [ ] **Step 5: Implement table actions**

Use a row-local `openActionDebtorId` state and render an icon button:

```tsx
<button
  type="button"
  aria-label={`Abrir acoes do cliente ${debtor.name}`}
  onClick={() =>
    setOpenActionDebtorId((current) =>
      current === debtor.debtorId ? null : debtor.debtorId,
    )
  }
  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
>
  <MoreVertical size={17} />
</button>
```

Render menu buttons with `role="menuitem"`:

- Editar cliente.
- Nova cobranca.
- Ver cobrancas em aberto.
- Historico de pagamentos.
- Configurar perfil/cobranca.

For open invoices:

```ts
router.push(`/cobrancas?debtorId=${debtor.debtorId}&status=PENDING`);
```

- [ ] **Step 6: Run page test**

Run:

```bash
cd front-cobranca
npx jest 'src/app/(dashboard)/clientes/__tests__/page.test.tsx' --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit Clientes page**

```bash
git add 'front-cobranca/src/app/(dashboard)/clientes/page.tsx' 'front-cobranca/src/app/(dashboard)/clientes/__tests__/page.test.tsx'
git commit -m "feat: add clients page"
```

---

### Task 6: Cobrancas URL Filters And New Charge Link

**Files:**
- Modify: `front-cobranca/src/app/(dashboard)/cobrancas/page.tsx`
- Create: `front-cobranca/src/app/(dashboard)/cobrancas/__tests__/page-url-filters.test.tsx`

- [ ] **Step 1: Write failing URL filter test**

Create `front-cobranca/src/app/(dashboard)/cobrancas/__tests__/page-url-filters.test.tsx`:

```tsx
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import CobrancasPage from "../page";

const getInvoices = jest.fn();
const getBillingSettings = jest.fn();
const searchParams = new URLSearchParams("debtorId=debtor-1&status=PENDING");

jest.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => ({
    getInvoices,
    getBillingSettings,
    importInvoices: jest.fn(),
    createInvoice: jest.fn(),
    createDebtorInvoice: jest.fn(),
    runSelectedBilling: jest.fn(),
    createPayment: jest.fn(),
    getInvoicePaymentStatus: jest.fn(),
    cancelInvoice: jest.fn(),
  }),
}));

jest.mock("@/components/features/InvoiceTable", () => ({
  InvoiceTable: () => <div>Tabela de cobrancas</div>,
}));

jest.mock("@/components/features/UploadCSV", () => ({
  UploadCSV: () => <div>Upload CSV</div>,
}));

jest.mock("@/components/features/DebtorSettingsModal", () => ({
  DebtorSettingsModal: () => <div>Configuracao</div>,
}));

jest.mock("@/components/features/DebtorPaymentHistoryModal", () => ({
  DebtorPaymentHistoryModal: () => <div>Historico</div>,
}));

describe("CobrancasPage URL filters", () => {
  beforeEach(() => {
    getInvoices.mockReset();
    getBillingSettings.mockReset();
    getInvoices.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    getBillingSettings.mockResolvedValue({
      preferredBillingMethod: "PIX",
      enabledBillingMethods: ["PIX"],
      collectionReminderDays: [0],
      autoGenerateFirstCharge: true,
      autoDiscountEnabled: false,
      autoDiscountDaysAfterDue: null,
      autoDiscountPercentage: null,
      businessSegment: "GENERAL",
      paymentNotificationEnabled: true,
      paymentNotificationEmails: [],
      tariffs: {},
    });
  });

  it("passes debtorId and status from the URL to getInvoices", async () => {
    render(<CobrancasPage />);

    await waitFor(() => {
      expect(getInvoices).toHaveBeenCalledWith(
        expect.objectContaining({
          debtorId: "debtor-1",
          status: "PENDING",
        }),
      );
    });
    expect(
      screen.getByText(/filtradas pelo cliente selecionado/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run URL filter test to verify it fails**

Run:

```bash
cd front-cobranca
npx jest 'src/app/(dashboard)/cobrancas/__tests__/page-url-filters.test.tsx' --runInBand
```

Expected: FAIL because `CobrancasPage` does not read `debtorId` from URL search params.

- [ ] **Step 3: Add URL search params to Cobrancas page**

Import `useSearchParams`:

```ts
import { useSearchParams } from "next/navigation";
```

Inside `CobrancasPage`:

```ts
const searchParams = useSearchParams();
const debtorIdFilter = searchParams.get("debtorId") ?? undefined;
const statusFilter = searchParams.get("status") ?? undefined;
```

Update `apiClient.getInvoices` call:

```ts
const result = await apiClient.getInvoices({
  page: pagination.pageIndex + 1,
  pageSize: pagination.pageSize,
  search: searchQuery.trim() || undefined,
  status: statusFilter || undefined,
  debtorId: debtorIdFilter,
});
```

Add `debtorIdFilter` and `statusFilter` to the `fetchInvoices` dependency array.

- [ ] **Step 2: Add visible filtered context**

When `debtorIdFilter` exists, show a compact info band above the table:

```tsx
{debtorIdFilter && (
  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
    Exibindo cobrancas filtradas pelo cliente selecionado.
  </div>
)}
```

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd front-cobranca
npx jest 'src/app/(dashboard)/cobrancas/__tests__/page-url-filters.test.tsx' --runInBand
npx jest src/lib/__tests__/api-client-debtors.test.ts --runInBand
npx jest 'src/app/(dashboard)/clientes/__tests__/page.test.tsx' --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit Cobrancas filter work**

```bash
git add 'front-cobranca/src/app/(dashboard)/cobrancas/page.tsx' 'front-cobranca/src/app/(dashboard)/cobrancas/__tests__/page-url-filters.test.tsx' front-cobranca/src/lib/__tests__/api-client-debtors.test.ts
git commit -m "feat: filter charges by client"
```

---

### Task 7: Require Profile In Debtor Settings Modal

**Files:**
- Modify: `front-cobranca/src/components/features/DebtorSettingsModal.tsx`
- Create: `front-cobranca/src/components/features/__tests__/DebtorSettingsModal.test.tsx`

- [ ] **Step 1: Write failing modal test**

Create `front-cobranca/src/components/features/__tests__/DebtorSettingsModal.test.tsx`:

```tsx
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DebtorSettingsModal } from "../DebtorSettingsModal";

const getDebtorBillingSettings = jest.fn();
const getRules = jest.fn();
const updateDebtorBillingSettings = jest.fn();

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => ({
    getDebtorBillingSettings,
    getRules,
    updateDebtorBillingSettings,
  }),
}));

describe("DebtorSettingsModal", () => {
  beforeEach(() => {
    getDebtorBillingSettings.mockReset();
    getRules.mockReset();
    updateDebtorBillingSettings.mockReset();
    getDebtorBillingSettings.mockResolvedValue({
      debtorId: "debtor-1",
      debtorName: "Maria Silva",
      document: "12345678909",
      whatsappOptIn: true,
      whatsappOptInAt: "2026-06-01T00:00:00.000Z",
      whatsappOptInSource: "manual-client-page",
      collectionProfile: {
        id: "profile-new",
        name: "Novo Cliente",
        profileType: "NEW",
      },
      useGlobalBillingSettings: true,
      customPreferredBillingMethod: null,
      customCollectionReminderDays: [],
      customAutoGenerateFirstCharge: null,
      customAutoDiscountEnabled: null,
      customAutoDiscountDaysAfterDue: null,
      customAutoDiscountPercentage: null,
      globalSettings: {
        preferredBillingMethod: "PIX",
        enabledBillingMethods: ["PIX"],
        collectionReminderDays: [0],
        autoGenerateFirstCharge: true,
        autoDiscountEnabled: false,
        autoDiscountDaysAfterDue: null,
        autoDiscountPercentage: null,
        tariffs: {},
      },
      effectiveSettings: {
        preferredBillingMethod: "PIX",
        enabledBillingMethods: ["PIX"],
        collectionReminderDays: [0],
        autoGenerateFirstCharge: true,
        autoDiscountEnabled: false,
        autoDiscountDaysAfterDue: null,
        autoDiscountPercentage: null,
        tariffs: {},
      },
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    getRules.mockResolvedValue([
      {
        id: "profile-new",
        companyId: "company-1",
        name: "Novo Cliente",
        profileType: "NEW",
        isDefault: true,
        isActive: true,
        daysOverdueMin: null,
        daysOverdueMax: null,
        steps: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    updateDebtorBillingSettings.mockResolvedValue({});
  });

  it("does not allow saving without a payer profile", async () => {
    const user = userEvent.setup();
    render(
      <DebtorSettingsModal
        debtorId="debtor-1"
        debtorName="Maria Silva"
        onClose={jest.fn()}
      />,
    );

    expect(await screen.findByText("Novo Cliente")).toBeInTheDocument();
    expect(screen.queryByText(/sem perfil manual/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /salvar configuracoes/i }));

    expect(updateDebtorBillingSettings).toHaveBeenCalledWith(
      "debtor-1",
      expect.objectContaining({ collectionProfileId: "profile-new" }),
    );
  });
});
```

- [ ] **Step 2: Run modal test to verify it fails**

Run:

```bash
cd front-cobranca
npx jest src/components/features/__tests__/DebtorSettingsModal.test.tsx --runInBand
```

Expected: FAIL because the modal still renders "Sem perfil manual" and allows `collectionProfileId: null`.

- [ ] **Step 3: Remove the no-profile option**

In `DebtorSettingsModal`, remove the button that sets `selectedProfileId` to an empty string. Keep only actual profile buttons.

- [ ] **Step 4: Guard save when profile is missing**

Before calling `apiClient.updateDebtorBillingSettings`, add:

```ts
if (!selectedProfileId) {
  setError("Selecione um perfil de pagador.");
  setSaving(false);
  return;
}
```

Change payload:

```ts
collectionProfileId: selectedProfileId,
```

- [ ] **Step 5: Update empty profile summary text**

Replace `"Sem perfil definido"` with `"Selecione um perfil de pagador"` for the transient loading or invalid state.

- [ ] **Step 6: Run targeted frontend tests**

Run:

```bash
cd front-cobranca
npx jest src/components/features/__tests__/DebtorSettingsModal.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit modal profile invariant**

```bash
git add front-cobranca/src/components/features/DebtorSettingsModal.tsx front-cobranca/src/components/features/__tests__/DebtorSettingsModal.test.tsx
git commit -m "feat: require debtor profile"
```

---

### Task 8: Full Verification

**Files:**
- No new source files unless previous tasks reveal test fixes needed.

- [ ] **Step 1: Run backend verification**

```bash
cd api-cobranca
npm test -- --runInBand
npm run lint
```

Expected: all backend tests pass and lint exits 0.

- [ ] **Step 2: Run frontend verification**

```bash
cd front-cobranca
npx jest --runInBand
npm run lint
```

Expected: all frontend tests pass and lint exits 0.

- [ ] **Step 3: Run builds**

```bash
cd api-cobranca
npm run build
cd ../front-cobranca
npm run build
```

Expected: both builds exit 0.

- [ ] **Step 4: Inspect final git state**

```bash
git status --short
git log --oneline -5
```

Expected: only intentional files are changed or the working tree is clean after commits. Recent commits should include the task commits from this plan.

---

## Self-Review

- Spec coverage: backend debtor CRUD, default `NEW` profile, no no-profile metric, table summaries, menu icon, open-invoices redirect, API client, sidebar, Cobrancas filtering, modal profile invariant, and tests are covered by Tasks 1 through 8.
- Plan scan: the plan avoids deferred work and gives exact files, commands, and expected outcomes.
- Type consistency: frontend uses `DebtorListItem`, `DebtorListResponse`, `CreateDebtorInput`, `UpdateDebtorInput`; backend uses matching `CreateDebtorInput`, `UpdateDebtorInput`, `DebtorListItem`, and `DebtorListSummary`.
