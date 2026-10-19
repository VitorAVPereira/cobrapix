import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "../Sidebar";
import { FinancialActivationContext } from "@/components/features/financial-activation-context";

type MockRole = "PLATFORM_ADMIN" | "COMPANY_ADMIN";

let mockPathname = "/cobrancas";
let mockRole: MockRole = "COMPANY_ADMIN";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

const mockApi = {
  getDisbursementStatus: jest.fn().mockResolvedValue({ enabled: false }),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

jest.mock("next-auth/react", () => ({
  signOut: jest.fn(),
  useSession: () => ({
    status: "authenticated",
    data: {
      user: {
        email: "admin@cobrapix.com",
        name: "Admin CobraPix",
        role: mockRole,
      },
    },
  }),
}));

function renderSidebar(): void {
  render(<Sidebar open={false} onClose={jest.fn()} />);
}

describe("Sidebar", () => {
  beforeEach(() => {
    mockPathname = "/cobrancas";
    mockRole = "COMPANY_ADMIN";
  });

  it("shows only admin navigation for platform admins", () => {
    mockPathname = "/admin/visao-geral";
    mockRole = "PLATFORM_ADMIN";

    renderSidebar();

    expect(
      screen.getByRole("link", { name: /visao geral/i }),
    ).toHaveAttribute("href", "/admin/visao-geral");
    expect(
      screen.getByRole("link", { name: /clientes/i }),
    ).toHaveAttribute("href", "/admin/clientes");
    expect(
      screen.queryByRole("link", { name: /dashboard/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /cobranças/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /baixas/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /recorrentes/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /inbox whatsapp/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /configurações/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps operational navigation visible for company admins", () => {
    renderSidebar();

    expect(
      screen.getByRole("link", { name: /dashboard/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cobranças/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /baixas/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /recorrentes/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /inbox whatsapp/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clientes/i })).toHaveAttribute(
      "href",
      "/clientes",
    );
    expect(
      screen.getByRole("button", { name: /configurações/i }),
    ).toBeInTheDocument();
  });

  it.each([
    [false, false],
    [true, true],
  ])(
    "shows the self-service activation link only when opening is enabled (%s)",
    (openingEnabled, visible) => {
      render(
        <FinancialActivationContext.Provider
          value={{
            state: null,
            openingEnabled,
            loading: false,
            error: null,
            canIssue: false,
            refresh: async () => {},
          }}
        >
          <Sidebar open={false} onClose={jest.fn()} />
        </FinancialActivationContext.Provider>,
      );
      const link = screen.queryByRole("link", { name: /ativação financeira/i });
      if (visible) expect(link).toHaveAttribute("href", "/onboarding/efi");
      else expect(link).not.toBeInTheDocument();
    },
  );
});

describe("financial activation entry", () => {
  const value = (openingEnabled: boolean, canIssue: boolean) => ({
    state: null,
    profile: null,
    openingEnabled,
    canIssue,
    loading: false,
    error: null,
    refresh: jest.fn(),
  });
  it.each([
    ["pending company, opening disabled", false, false, false],
    ["manually active company, opening disabled", false, true, false],
    ["active company, opening enabled", true, true, false],
    ["pending company, opening enabled", true, false, true],
  ])("%s: menu entry shown = %s", (_case, openingEnabled, canIssue, shown) => {
    mockRole = "COMPANY_ADMIN";
    render(
      <FinancialActivationContext.Provider value={value(openingEnabled, canIssue)}>
        <Sidebar open={false} onClose={jest.fn()} />
      </FinancialActivationContext.Provider>,
    );
    expect(Boolean(screen.queryByRole("link", { name: /Ativação financeira/ }))).toBe(shown);
  });
});

describe("Sidebar: collaborator payments", () => {
  beforeEach(() => {
    mockPathname = "/cobrancas";
    mockRole = "COMPANY_ADMIN";
  });

  it("shows the item only to a company with the feature released", async () => {
    mockApi.getDisbursementStatus.mockResolvedValueOnce({ enabled: true });
    renderSidebar();
    expect(
      await screen.findByRole("link", { name: /Pagamentos a colaboradores/ }),
    ).toHaveAttribute("href", "/pagamentos-colaboradores");
  });

  it("keeps it hidden when not released or when the check fails", async () => {
    mockApi.getDisbursementStatus.mockRejectedValueOnce(new Error("offline"));
    renderSidebar();
    await waitFor(() => expect(mockApi.getDisbursementStatus).toHaveBeenCalled());
    expect(
      screen.queryByRole("link", { name: /Pagamentos a colaboradores/ }),
    ).not.toBeInTheDocument();
  });

  it("never asks for platform admins", () => {
    mockRole = "PLATFORM_ADMIN";
    mockApi.getDisbursementStatus.mockClear();
    renderSidebar();
    expect(mockApi.getDisbursementStatus).not.toHaveBeenCalled();
  });
});
