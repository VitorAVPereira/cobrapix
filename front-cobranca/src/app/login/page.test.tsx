import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getSession, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import LoginPage from "./page";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock("next-auth/react", () => ({
  getSession: jest.fn(),
  signIn: jest.fn(),
}));

const mockGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockSignIn = signIn as jest.MockedFunction<typeof signIn>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseSearchParams = useSearchParams as jest.MockedFunction<
  typeof useSearchParams
>;
const mockPush = jest.fn();

describe("LoginPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({
      back: jest.fn(),
      forward: jest.fn(),
      prefetch: jest.fn(),
      push: mockPush,
      refresh: jest.fn(),
      replace: jest.fn(),
    });
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams() as ReturnType<typeof useSearchParams>,
    );
  });

  it("offers password recovery from the login form", () => {
    render(<LoginPage />);

    expect(
      screen.getByRole("link", { name: /esqueci minha senha/i }),
    ).toHaveAttribute("href", "/esqueci-senha");
  });

  it("redirects a temporary-password login to first access", async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({
      error: undefined,
      code: undefined,
      status: 200,
      ok: true,
      url: null,
    });
    mockGetSession.mockResolvedValue({
      expires: "2099-01-01T00:00:00.000Z",
      access_token: "jwt-token",
      user: {
        id: "user-1",
        email: "admin@cliente.com",
        companyId: "company-1",
        role: "COMPANY_ADMIN",
        mustChangePassword: true,
        tokenVersion: 0,
        authInvalidated: false,
      },
    });
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), "admin@cliente.com");
    await user.type(screen.getByLabelText(/^senha$/i), "Temporaria1");
    await user.click(screen.getByRole("button", { name: /^entrar$/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/primeiro-acesso"),
    );
    expect(mockPush).not.toHaveBeenCalledWith("/cobrancas");
  });
});
