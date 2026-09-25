import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./page";
const mockSubmit=jest.fn();const mockSync=jest.fn();const mockFinancial=jest.fn();
const mockApi={getTemplates:jest.fn(),getEmailTemplates:jest.fn(),submitTemplateToMeta:mockSubmit,syncTemplateMetaStatuses:mockSync,financialAdmin:mockFinancial,confirmTemplateReview:jest.fn()};
let mockRole="PLATFORM_ADMIN";
jest.mock("@/lib/use-api-client",()=>({useApiClient:()=>mockApi}));
jest.mock("next-auth/react",()=>({useSession:()=>({data:{user:{role:mockRole}}})}));
beforeEach(()=>{jest.clearAllMocks();mockRole="PLATFORM_ADMIN";mockApi.getTemplates.mockResolvedValue([{id:"wa-1",name:"Aviso",content:"Cobrança via CifraMais",metaStatus:"DRAFT"}]);mockApi.getEmailTemplates.mockResolvedValue([{id:"email-1",name:"Lembrete",subject:"Vencimento",content:"Sua cobrança"}]);});
it("submits WhatsApp approval and publishes email through their admin operations",async()=>{
 render(<Page/>);
 fireEvent.click(await screen.findByRole("button",{name:"Solicitar aprovação de Aviso"}));
 await waitFor(()=>expect(mockSubmit).toHaveBeenCalledWith("wa-1"));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Publicar Lembrete"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button",{name:"Publicar Lembrete"}));
 await waitFor(()=>expect(mockFinancial).toHaveBeenCalledWith("/email/templates/email-1/publish","POST"));
});
it("explains a pending review and concludes it only through the provider check",async()=>{
 mockApi.getTemplates.mockResolvedValue([{id:"wa-2",name:"Lembrete WA",content:"Olá",metaStatus:"APPROVED",metaReviewRequired:true,metaProviderCategory:"MARKETING",category:"UTILITY",metaQuality:"RED"}]);
 mockApi.confirmTemplateReview.mockRejectedValueOnce(new Error("A categoria no provedor (MARKETING) difere da categoria local (UTILITY)."));
 render(<Page/>);
 expect(await screen.findByRole("note")).toHaveTextContent(/categoria atual: MARKETING/);
 expect(screen.getByText(/Qualidade baixa/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Concluir revisão de Lembrete WA"}));
 await waitFor(()=>expect(mockApi.confirmTemplateReview).toHaveBeenCalledWith("wa-2"));
 expect(await screen.findByRole("alert")).toHaveTextContent(/difere da categoria local/);
});
it("does not load or expose global controls to a company admin",()=>{
 mockRole="COMPANY_ADMIN";render(<Page/>);
 expect(mockApi.getTemplates).not.toHaveBeenCalled();
 expect(screen.getByText(/Acesso restrito/)).toBeInTheDocument();
});
