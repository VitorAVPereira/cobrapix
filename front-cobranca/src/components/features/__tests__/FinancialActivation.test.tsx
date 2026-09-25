import { act, render, screen, waitFor } from "@testing-library/react";
import {
  FinancialActivationBanner,
  FinancialActivationProvider,
} from "../FinancialActivation";
import { useFinancialActivation } from "../financial-activation-context";
import type { ReactNode } from "react";
const mockGet = jest.fn();
const mockProfile = jest.fn();
const mockApi = { getEfiOnboarding: mockGet, getFinancialProfile: mockProfile };
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: {
      user: {
        role: "COMPANY_ADMIN",
        companyId: "company-1",
        mustChangePassword: false,
      },
    },
  }),
}));
const profile = (overrides: object = {}) => ({
  openingEnabled: true,
  canIssue: false,
  status: "PENDING",
  accountMode: null,
  enabledMethods: [],
  activatedAt: null,
  issuerAccount: null,
  ...overrides,
});
function Actions(): ReactNode {
  const { canIssue, refresh } = useFinancialActivation();
  return (
    <>
      <button disabled={!canIssue}>Emitir</button>
      <button onClick={() => void refresh()}>Revalidar</button>
    </>
  );
}
function renderProvider(): void {
  render(
    <FinancialActivationProvider>
      <FinancialActivationBanner />
      <Actions />
    </FinancialActivationProvider>,
  );
}
beforeEach(() => jest.clearAllMocks());
it("keeps issuance blocked and an activation link available for pending accounts", async () => {
  mockProfile.mockResolvedValue(profile());
  mockGet.mockResolvedValue({ status: "PROVISIONING" });
  renderProvider();
  expect(screen.getByRole("button", { name: "Emitir" })).toBeDisabled();
  expect(await screen.findByText(/Configurando sua conta/)).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Continuar ativação" }),
  ).toHaveAttribute("href", "/onboarding/efi");
});
it("hides the opening flow while the opening API is disabled", async () => {
  mockProfile.mockResolvedValue(profile({ openingEnabled: false }));
  renderProvider();
  expect(
    await screen.findByText(/equipe CifraMais está configurando/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Continuar ativação" }),
  ).not.toBeInTheDocument();
  expect(mockGet).not.toHaveBeenCalled();
});
it("allows issuance after a manual activation", async () => {
  mockProfile.mockResolvedValue(
    profile({ openingEnabled: false, canIssue: true, status: "ACTIVE" }),
  );
  renderProvider();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Emitir" })).toBeEnabled(),
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("blocks issuance again if active status cannot be revalidated", async () => {
  mockProfile
    .mockResolvedValueOnce(profile({ openingEnabled: false, canIssue: true }))
    .mockRejectedValueOnce(new Error("Serviço indisponível"));
  renderProvider();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Emitir" })).toBeEnabled(),
  );
  await act(async () => screen.getByRole("button", { name: "Revalidar" }).click());
  expect(screen.getByRole("button", { name: "Emitir" })).toBeDisabled();
  expect(screen.getByText("Serviço indisponível")).toBeInTheDocument();
});
