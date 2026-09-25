import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isEfiOpeningEnabled } from '../config/account-opening';
import { mask } from './financial-activation.service';

export interface CompanyFinancialProfile {
  // Whether the self-service account-opening screen is offered.
  openingEnabled: boolean;
  canIssue: boolean;
  status: 'ACTIVE' | 'PENDING';
  accountMode: string | null;
  enabledMethods: string[];
  activatedAt: Date | null;
  issuerAccount: string | null;
}

// What a company may see about its own financial activation: no credentials,
// no validation details, no other tenant.
@Injectable()
export class CompanyFinancialProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async get(companyId: string): Promise<CompanyFinancialProfile> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        activeFinancialProfile: {
          select: {
            status: true,
            accountMode: true,
            enabledMethods: true,
            activatedAt: true,
            issuerIdentity: { select: { efiAccountNumber: true } },
          },
        },
      },
    });
    const profile =
      company?.activeFinancialProfile?.status === 'ACTIVE'
        ? company.activeFinancialProfile
        : null;
    return {
      openingEnabled: isEfiOpeningEnabled(this.config),
      canIssue: Boolean(profile),
      status: profile ? 'ACTIVE' : 'PENDING',
      accountMode: profile?.accountMode ?? null,
      enabledMethods: profile?.enabledMethods ?? [],
      activatedAt: profile?.activatedAt ?? null,
      issuerAccount: profile?.issuerIdentity
        ? mask(profile.issuerIdentity.efiAccountNumber)
        : null,
    };
  }
}
