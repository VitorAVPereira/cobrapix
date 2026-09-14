import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./page";
const mockFinancial=jest.fn(); const mockApi={financialAdmin:mockFinancial};
jest.mock("@/lib/use-api-client",()=>({useApiClient:()=>mockApi}));
jest.mock("next-auth/react",()=>({useSession:()=>({data:{user:{role:"PLATFORM_ADMIN"}}})}));
beforeEach(()=>{jest.clearAllMocks();mockFinancial.mockImplementation(async(path:string)=>{
 if(path==="/admin/integrations/health")return [{integration:"EFI_ONBOARDING",enabled:false,healthStatus:"UNKNOWN",lastCheckedAt:null}];
 if(path.startsWith("/admin/efi-onboarding?"))return {items:[{companyId:"company-1",company:{corporateName:"Empresa Modelo",document:"11222333000181"},status:"CONFIGURATION_ERROR",lastProgressAt:"2026-09-12T00:00:00Z",provisioningAttempts:5}],total:1};
 if(path==="/admin/efi-onboarding/company-1")return {onboarding:{status:"CONFIGURATION_ERROR",simplifiedAccountRequestId:"request-1",provisioningAttempts:5},gateway:{status:"ERROR",healthStatus:"UNHEALTHY",certificateExpiresAt:"2020-01-01T00:00:00Z",consecutiveFailures:2},timeline:[]};
 return {};
});});
it("shows masked health, expiry alert, retries and manual recovery without activation bypass",async()=>{
 render(<Page/>);
 fireEvent.click(await screen.findByRole("button",{name:"Detalhes"}));
 expect(await screen.findByText(/Certificado vencido/)).toBeInTheDocument();
 expect(screen.getByText("UNHEALTHY")).toBeInTheDocument();
 expect(screen.queryByLabelText(/clientSecret/i)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Repetir provisionamento"}));
 await waitFor(()=>expect(mockFinancial).toHaveBeenCalledWith("/admin/efi-onboarding/company-1/retry-provisioning","POST",undefined));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Validar e retomar"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button",{name:"Validar e retomar"}));
 await waitFor(()=>expect(mockFinancial).toHaveBeenCalledWith("/admin/efi-onboarding/company-1/manual","POST",{requestId:"request-1"}));
});
it("changes only the selected integration toggle",async()=>{
 render(<Page/>);fireEvent.click(await screen.findByRole("button",{name:"Liberar"}));
 await waitFor(()=>expect(mockFinancial).toHaveBeenCalledWith("/admin/integrations/efi-onboarding","PUT",{enabled:true}));
});
