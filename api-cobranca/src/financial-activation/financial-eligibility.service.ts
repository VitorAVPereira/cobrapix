import { HttpException, Injectable } from '@nestjs/common';
import {
  BillingMethod,
  EfiEnvironment,
  FinancialAccountMode,
  FinancialPayoutMode,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// What a new charge must record about where it is issued.
export interface IssuanceContext {
  financialProfileId: string;
  issuerIdentityId: string;
  issuerCredentialVersionId: string;
  accountMode: FinancialAccountMode;
  payoutMode: FinancialPayoutMode;
  financialEnvironment: EfiEnvironment;
}

// Single answer to "may this company issue with this method now?", based on
// the published financial profile instead of the account-opening status.
@Injectable()
export class FinancialEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveIssuance(
    companyId: string,
    method: BillingMethod,
    now = new Date(),
  ): Promise<IssuanceContext> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        status: true,
        activeFinancialProfile: {
          include: { issuerIdentity: { select: { healthStatus: true } } },
        },
      },
    });
    if (!company) this.fail(404, 'COMPANY_NOT_FOUND');
    if (company.status !== 'ACTIVE') this.fail(409, 'COMPANY_NOT_ACTIVE');
    const profile = company.activeFinancialProfile;
    if (
      !profile ||
      profile.status !== 'ACTIVE' ||
      !profile.issuerIdentityId ||
      !profile.issuerIdentity
    )
      this.fail(409, 'FINANCIAL_PROFILE_NOT_READY');
    if (!profile.enabledMethods.includes(method))
      this.fail(409, 'PAYMENT_METHOD_NOT_ENABLED');

    const payments = await this.prisma.platformIntegrationState.findUnique({
      where: { integration: 'EFI_PAYMENTS' },
      select: { enabled: true },
    });
    if (!payments?.enabled) this.fail(409, 'EFI_PAYMENTS_PAUSED');
    if (profile.issuerIdentity.healthStatus === 'UNAVAILABLE')
      this.fail(409, 'EFI_INTEGRATION_UNHEALTHY');

    // Charges use the valid ACTIVE credential of the same identity, which may
    // be newer than the one validated at activation (rotation).
    const credential = await this.prisma.efiCredentialVersion.findFirst({
      where: { identityId: profile.issuerIdentityId, status: 'ACTIVE' },
      select: { id: true, certificateExpiresAt: true },
    });
    if (!credential) this.fail(409, 'EFI_CREDENTIALS_UNAVAILABLE');
    if (credential.certificateExpiresAt <= now)
      this.fail(409, 'EFI_CERTIFICATE_EXPIRED');

    return {
      financialProfileId: profile.id,
      issuerIdentityId: profile.issuerIdentityId,
      issuerCredentialVersionId: credential.id,
      accountMode: profile.accountMode,
      payoutMode: profile.payoutMode,
      financialEnvironment: profile.environment,
    };
  }

  private fail(status: number, code: string): never {
    throw new HttpException({ code, message: MESSAGES[code] ?? code }, status);
  }
}

const MESSAGES: Record<string, string> = {
  COMPANY_NOT_FOUND: 'Empresa não encontrada.',
  COMPANY_NOT_ACTIVE: 'A empresa não está ativa.',
  FINANCIAL_PROFILE_NOT_READY:
    'Conclua a ativação financeira antes de emitir cobranças.',
  PAYMENT_METHOD_NOT_ENABLED:
    'Este meio de pagamento não está habilitado na ativação financeira.',
  EFI_PAYMENTS_PAUSED: 'Novas emissões estão temporariamente pausadas.',
  EFI_INTEGRATION_UNHEALTHY:
    'A integração financeira está indisponível. Tente novamente após a validação.',
  EFI_CREDENTIALS_UNAVAILABLE:
    'Não há credencial ativa para a conta emissora. Renove as credenciais.',
  EFI_CERTIFICATE_EXPIRED:
    'O certificado da conta emissora expirou. Renove as credenciais.',
};
