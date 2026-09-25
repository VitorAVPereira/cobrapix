import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "../Sidebar";
import { FinancialActivationContext } from "@/components/features/financial-activation-context";

type MockRole = "PLATFORM_ADMIN" | "COMPANY_ADMIN";

let mockPathname = "/cobrancas";
let mockRole: MockRole = "COMPANY_ADMIN";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("next-auth/react", () => ({
  signOut: jest.fn(),
  useSession: () => ({
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
      screen.queryByRole("link", { name: /cobrancas/i }),
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
      screen.queryByRole("button", { name: /configuracoes/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps operational navigation visible for company admins", () => {
    renderSidebar();

    expect(
      screen.getByRole("link", { name: /dashboard/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cobrancas/i }),
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
      screen.getByRole("button", { name: /configuracoes/i }),
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
