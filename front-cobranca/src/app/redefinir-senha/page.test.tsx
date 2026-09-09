import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import ResetPasswordPage from "./page";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: () => new URLSearchParams("token=company-1.secret"),
}));

jest.mock("@/lib/api-client", () => ({
  apiClient: { resetPassword: jest.fn() },
}));

const mockResetPassword = apiClient.resetPassword as jest.MockedFunction<
  typeof apiClient.resetPassword
>;
const mockPush = jest.fn();
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockUseRouter.mockReturnValue({
      back: jest.fn(),
      forward: jest.fn(),
      prefetch: jest.fn(),
      push: mockPush,
      refresh: jest.fn(),
      replace: jest.fn(),
    });
    mockResetPassword.mockReset();
    mockResetPassword.mockResolvedValue({ message: "Senha redefinida com sucesso." });
  });

  it("resets the password and returns to login", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByLabelText(/^nova senha$/i), "NovaSenha1");
    await user.type(
      screen.getByLabelText(/confirmar nova senha/i),
      "NovaSenha1",
    );
    await user.click(screen.getByRole("button", { name: /redefinir senha/i }));

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        token: "company-1.secret",
        password: "NovaSenha1",
        passwordConfirmation: "NovaSenha1",
      });
      expect(mockPush).toHaveBeenCalledWith("/login?passwordReset=1");
    });
  });
});
