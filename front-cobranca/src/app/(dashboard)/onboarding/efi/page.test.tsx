import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "./page";
import type { EfiOnboardingState } from "@/lib/efi-onboarding";
import type { FinancialActivationContextValue } from "@/components/features/financial-activation-context";
const mockSave = jest.fn();
const mockSubmit = jest.fn();
const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockPush = jest.fn();
const mockApi = { saveEfiDraft: mockSave, submitEfiOnboarding: mockSubmit };
let mockContext: FinancialActivationContextValue;
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));
jest.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: "COMPANY_ADMIN" } } }) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/components/features/financial-activation-context", () => ({ useFinancialActivation: () => mockContext }));
function state(): EfiOnboardingState {
 return {status:"DRAFT", revision:2, company:{ corporateName:"Empresa Modelo", tradeName:null, document:"11222333000181", addressPostalCode:null, addressStreet:null, addressNumber:null, addressDistrict:null, addressCity:null, addressState:null }, representativeProvided:true, consentAcceptedAt:null, legalVersions:{authorization:"1",terms:"1",privacy:"1"}, reason:null, submittedAt:null,activatedAt:null,lastReminderAt:null,reminderAttempts:0,retryBlockedUntil:null,timeline:[],actions:{canEdit:true,canSubmit:true,canRetry:false}};
}
beforeEach(() => {
 jest.clearAllMocks();
 mockContext={state:state(),loading:false,error:null,canIssue:false,refresh:mockRefresh};
 mockSave.mockResolvedValue(state());
 mockSubmit.mockResolvedValue(state());
});
it("saves draft changes before leaving, without submitting an opening", async () => {
 render(<Page />);
 fireEvent.change(screen.getByLabelText("Razão social (beneficiário)"), {target:{value:"Empresa Corrigida"}});
 await userEvent.click(screen.getByRole("button",{name:"Salvar e concluir depois"}));
 await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/cobrancas"));
 expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({revision:2,corporateName:"Empresa Corrigida"}));
 expect(mockSubmit).not.toHaveBeenCalled();
});
it("requires renewed consent and uses the retry action after a corrected refusal", async () => {
 const user=userEvent.setup();
 mockSave.mockResolvedValue({...state(),actions:{canEdit:true,canSubmit:false,canRetry:true}});
 render(<Page />);
 await user.click(screen.getByRole("button",{name:"Salvar e continuar"}));
 await user.click(await screen.findByRole("button",{name:"Salvar e continuar"}));
 await user.click(await screen.findByRole("button",{name:"Autorizar e solicitar ativação"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Confirme as três declarações");
 expect(mockSubmit).not.toHaveBeenCalled();
 for (const checkbox of screen.getAllByRole("checkbox")) await user.click(checkbox);
 await user.click(screen.getByRole("button",{name:"Autorizar e solicitar ativação"}));
 await waitFor(() => expect(mockSubmit).toHaveBeenCalledWith(true));
 expect(mockSave).toHaveBeenLastCalledWith(expect.objectContaining({consent:{authorized:true,termsAccepted:true,privacyAccepted:true,authorizationVersion:"1",termsVersion:"1",privacyVersion:"1"}}));
});
it("shows refusal, cooldown, reminders and timeline without editable or secret fields", () => {
 mockContext.state={...state(),status:"REFUSED",reason:"Dados do representante precisam de correção.", retryBlockedUntil:"2026-09-14T15:00:00Z", lastReminderAt:"2026-09-11T15:00:00Z", timeline:[{action:"EFI_ACCOUNT_REFUSED",createdAt:"2026-09-12T15:00:00Z"}], actions:{canEdit:false,canSubmit:false,canRetry:false}};
 const {container}=render(<Page />);
 expect(screen.getByText(/Dados do representante precisam/)).toBeInTheDocument();
 expect(screen.getByText(/Uma nova solicitação poderá/)).toBeInTheDocument();
 expect(screen.getByText(/Último lembrete/)).toBeInTheDocument();
 expect(screen.getByText("Recusa registrada")).toBeInTheDocument();
 expect(container.querySelector("input, textarea")).toBeNull();
});
it("preserves unsaved fields while the periodic status refresh runs", () => {
 const {rerender}=render(<Page />);
 fireEvent.change(screen.getByLabelText("Razão social (beneficiário)"),{target:{value:"Rascunho local"}});
 mockContext={...mockContext,loading:true};
 rerender(<Page />);
 expect(screen.getByLabelText("Razão social (beneficiário)")).toHaveValue("Rascunho local");
});

it("shows only a status notice while the opening API is disabled", () => {
 mockContext={...mockContext,openingEnabled:false,profile:{openingEnabled:false,canIssue:false,status:"PENDING",accountMode:null,enabledMethods:[],activatedAt:null,issuerAccount:null}};
 render(<Page />);
 expect(screen.getByText(/equipe CifraMais está configurando/)).toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Salvar e continuar"})).not.toBeInTheDocument();
});
