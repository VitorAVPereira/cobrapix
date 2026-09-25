import { ConfigService } from '@nestjs/config';
import { CompanyFinancialProfileService } from './company-financial-profile.service';

describe('CompanyFinancialProfileService', () => {
  function service(
    profile: Record<string, unknown> | null,
    env: Record<string, string> = {},
  ) {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ activeFinancialProfile: profile });
    return {
      findUnique,
      service: new CompanyFinancialProfileService(
        { company: { findUnique } } as never,
        new ConfigService(env),
      ),
    };
  }

  it('mostra só o resumo mascarado do perfil ativo da própria empresa', async () => {
    const { service: target, findUnique } = service(
      {
        status: 'ACTIVE',
        accountMode: 'CUSTOMER_ACCOUNT',
        enabledMethods: ['PIX'],
        activatedAt: new Date('2026-09-25T12:00:00Z'),
        issuerIdentity: { efiAccountNumber: '12345678' },
      },
      { EFI_OPENING_ENABLED: 'false' },
    );
    await expect(target.get('company-1')).resolves.toEqual({
      openingEnabled: false,
      canIssue: true,
      status: 'ACTIVE',
      accountMode: 'CUSTOMER_ACCOUNT',
      enabledMethods: ['PIX'],
      activatedAt: new Date('2026-09-25T12:00:00Z'),
      issuerAccount: '••••5678',
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'company-1' } }),
    );
  });

  it('empresa sem perfil ativo fica pendente; abertura ligada por padrão', async () => {
    await expect(service(null).service.get('company-1')).resolves.toEqual({
      openingEnabled: true,
      canIssue: false,
      status: 'PENDING',
      accountMode: null,
      enabledMethods: [],
      activatedAt: null,
      issuerAccount: null,
    });
  });
});
