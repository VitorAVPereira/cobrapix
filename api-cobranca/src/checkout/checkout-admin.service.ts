import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutSellerTerms, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  conflict,
  maskDocument,
  normalizeDocument,
  normalizePayoutPixKey,
  versionChanged,
} from './checkout-rules';
import {
  CheckoutTermsDto,
  CreateCheckoutClientDto,
  UpdateCheckoutTermsDto,
} from './dto/checkout-admin.dto';

type Tx = Prisma.TransactionClient;

// Audit and support need years of history of what the seller agreed to pay.
const AUDIT_RETENTION_MS = 5 * 365.25 * 86_400_000;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class CheckoutAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const companies = await this.prisma.company.findMany({
      where: { product: 'CHECKOUT' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        corporateName: true,
        document: true,
        email: true,
        status: true,
        createdAt: true,
        checkoutSellerTerms: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, platformFeeBasisPoints: true },
        },
        _count: {
          select: { checkoutProducts: { where: { active: true } } },
        },
      },
    });
    return companies.map(({ checkoutSellerTerms, _count, ...company }) => ({
      ...company,
      currentTerms: checkoutSellerTerms[0] ?? null,
      activeProducts: _count.checkoutProducts,
    }));
  }

  async detail(companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, product: 'CHECKOUT' },
      select: {
        id: true,
        corporateName: true,
        document: true,
        email: true,
        phoneNumber: true,
        status: true,
        createdAt: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            mustChangePassword: true,
          },
        },
        checkoutSellerTerms: { orderBy: { version: 'desc' } },
      },
    });
    if (!company)
      throw new NotFoundException('Cliente de checkout não encontrado.');
    const { checkoutSellerTerms, ...rest } = company;
    return { ...rest, terms: checkoutSellerTerms };
  }

  async create(dto: CreateCheckoutClientDto, adminUserId: string) {
    const document = normalizeDocument(dto.company.document);
    if (!document) throw this.invalid('CPF ou CNPJ da empresa inválido.');
    const terms = this.normalizeTerms(dto.terms);
    const userEmail = dto.firstUser.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: userEmail, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingUser)
      conflict(
        'USER_EMAIL_IN_USE',
        'Já existe um usuário cadastrado com este e-mail.',
      );

    const temporaryPassword = randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    try {
      const company = await this.prisma.$transaction(async (tx) => {
        const created = await tx.company.create({
          data: {
            product: 'CHECKOUT',
            corporateName: dto.company.corporateName.trim(),
            document,
            email: dto.company.email.trim().toLowerCase(),
            phoneNumber: dto.company.phoneNumber.replace(/\D/g, ''),
            users: {
              create: {
                email: userEmail,
                name: dto.firstUser.name.trim(),
                password: passwordHash,
                role: UserRole.COMPANY_ADMIN,
                mustChangePassword: true,
              },
            },
            checkoutSettings: {
              create: { displayName: dto.company.corporateName.trim() },
            },
          },
          select: { id: true },
        });
        await this.writeTerms(tx, created.id, 1, terms, adminUserId);
        return created;
      });
      return { client: await this.detail(company.id), temporaryPassword };
    } catch (error) {
      // Same document or e-mail, including a double click on "create".
      if (isUniqueViolation(error))
        conflict(
          'CHECKOUT_CLIENT_EXISTS',
          'Já existe uma empresa com este CPF/CNPJ ou e-mail.',
        );
      throw error;
    }
  }

  async updateTerms(
    companyId: string,
    dto: UpdateCheckoutTermsDto,
    adminUserId: string,
  ) {
    const terms = this.normalizeTerms(dto);
    try {
      await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.findFirst({
          where: { id: companyId, product: 'CHECKOUT' },
          select: {
            checkoutSellerTerms: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { version: true },
            },
          },
        });
        if (!company)
          throw new NotFoundException('Cliente de checkout não encontrado.');
        const current = company.checkoutSellerTerms[0]?.version ?? 0;
        if (current !== dto.expectedVersion) versionChanged();
        await this.writeTerms(tx, companyId, current + 1, terms, adminUserId);
      });
    } catch (error) {
      // Two admins saving the same version: the unique (company, version) decides.
      if (isUniqueViolation(error)) versionChanged();
      throw error;
    }
    return this.detail(companyId);
  }

  private normalizeTerms(dto: CheckoutTermsDto) {
    const payoutDocument = normalizeDocument(dto.payoutDocument);
    if (!payoutDocument) throw this.invalid('CPF ou CNPJ de repasse inválido.');
    const payoutPixKey = normalizePayoutPixKey(dto.payoutPixKey);
    if (!payoutPixKey)
      throw this.invalid(
        'Chave Pix de repasse inválida. Telefone precisa de +55 e DDD.',
      );
    return {
      platformFeeBasisPoints: dto.platformFeeBasisPoints,
      payoutDocument,
      payoutPixKey,
    };
  }

  private async writeTerms(
    tx: Tx,
    companyId: string,
    version: number,
    terms: Pick<
      CheckoutSellerTerms,
      'platformFeeBasisPoints' | 'payoutDocument' | 'payoutPixKey'
    >,
    adminUserId: string,
  ): Promise<void> {
    const row = await tx.checkoutSellerTerms.create({
      data: { companyId, version, ...terms, changedByUserId: adminUserId },
    });
    await tx.auditLog.create({
      data: {
        companyId,
        userId: adminUserId,
        entityType: 'CheckoutSellerTerms',
        entityId: row.id,
        action:
          version === 1 ? 'CHECKOUT_CLIENT_CREATED' : 'CHECKOUT_TERMS_CHANGED',
        // The Pix key may be a phone or e-mail: only its presence is recorded.
        changes: {
          version,
          platformFeeBasisPoints: terms.platformFeeBasisPoints,
          payoutDocument: maskDocument(terms.payoutDocument),
        },
        retentionExpiresAt: new Date(Date.now() + AUDIT_RETENTION_MS),
      },
    });
  }

  private invalid(message: string): BadRequestException {
    return new BadRequestException({ code: 'CHECKOUT_INVALID', message });
  }
}
