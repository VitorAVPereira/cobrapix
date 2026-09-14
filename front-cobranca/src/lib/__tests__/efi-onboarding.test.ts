import {certificateExpirationNotice,canIssueFinancially,companyLoginDestination} from '../efi-onboarding';
describe('financial activation UX',()=>{
  it('blocks incomplete or unknown accounts and releases only active accounts',()=>{
    expect(canIssueFinancially(null)).toBe(false);
    expect(canIssueFinancially({status:'PROVISIONING'})).toBe(false);
    expect(canIssueFinancially({status:'SUBMISSION_UNCERTAIN'})).toBe(false);
    expect(canIssueFinancially({status:'ACTIVE'})).toBe(true);
  });
  it('routes the new login after temporary password change into onboarding',()=>{
    expect(companyLoginDestination(true,'COMPANY_ADMIN',false)).toBe('/primeiro-acesso');
    expect(companyLoginDestination(false,'COMPANY_ADMIN',true)).toBe('/onboarding/efi');
    expect(companyLoginDestination(false,'PLATFORM_ADMIN',true)).toBe('/admin/clientes');
  });
});

it("alerts for certificate renewal at 30, 15, 7 days and expiry",()=>{
 const now=Date.parse("2026-09-12T00:00:00Z");
 for(const days of [30,15,7]) expect(certificateExpirationNotice(new Date(now+days*86400000).toISOString(),now)).toContain(`vence em ${days}`);
 expect(certificateExpirationNotice(new Date(now).toISOString(),now)).toContain("vencido");
 expect(certificateExpirationNotice(new Date(now+31*86400000).toISOString(),now)).toBeNull();
});
