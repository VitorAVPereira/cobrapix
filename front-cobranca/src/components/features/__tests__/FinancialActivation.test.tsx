import { act, render, screen, waitFor } from "@testing-library/react";
import { FinancialActivationProvider } from "../FinancialActivation";
import { useFinancialActivation } from "../financial-activation-context";
import type { ReactNode } from "react";
const mockGet = jest.fn();
const mockApi = { getEfiOnboarding: mockGet };
jest.mock("@/lib/use-api-client",()=>({useApiClient:()=>mockApi}));
jest.mock("next-auth/react",()=>({useSession:()=>({status:"authenticated",data:{user:{role:"COMPANY_ADMIN",companyId:"company-1",mustChangePassword:false}}})}));
function Actions(): ReactNode {
 const {canIssue,refresh}=useFinancialActivation();
 return <><button disabled={!canIssue}>Emitir</button><button onClick={()=>void refresh()}>Revalidar</button></>;
}
beforeEach(()=>jest.clearAllMocks());
it("keeps issuance blocked and an activation link available for pending accounts", async()=>{
 mockGet.mockResolvedValue({status:"PROVISIONING"});
 render(<FinancialActivationProvider><Actions/></FinancialActivationProvider>);
 expect(screen.getByRole("button",{name:"Emitir"})).toBeDisabled();
 expect(await screen.findByText(/Configurando sua conta/)).toBeInTheDocument();
 expect(screen.getByRole("link",{name:"Continuar ativação"})).toHaveAttribute("href","/onboarding/efi");
});
it("blocks issuance again if active status cannot be revalidated",async()=>{
 mockGet.mockResolvedValueOnce({status:"ACTIVE"}).mockRejectedValueOnce(new Error("Serviço indisponível"));
 render(<FinancialActivationProvider><Actions/></FinancialActivationProvider>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"Emitir"})).toBeEnabled());
 expect(screen.queryByRole("link",{name:"Continuar ativação"})).not.toBeInTheDocument();
 await act(async()=>screen.getByRole("button",{name:"Revalidar"}).click());
 expect(screen.getByRole("button",{name:"Emitir"})).toBeDisabled();
 expect(screen.getByText("Serviço indisponível")).toBeInTheDocument();
});
