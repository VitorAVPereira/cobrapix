import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiClient } from "@/lib/api-client";
import ForgotPasswordPage from "./page";

jest.mock("@/lib/api-client", () => ({
  apiClient: { forgotPassword: jest.fn() },
}));

const mockForgotPassword = apiClient.forgotPassword as jest.MockedFunction<
  typeof apiClient.forgotPassword
>;

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    mockForgotPassword.mockReset();
    mockForgotPassword.mockResolvedValue({
      message:
        "Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.",
    });
  });

  it("shows the generic confirmation after submitting the email", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.click(
      screen.getByRole("button", { name: /enviar instruções/i }),
    );

    expect(
      await screen.findByText(/se o e-mail estiver cadastrado/i),
    ).toBeInTheDocument();
    expect(mockForgotPassword).toHaveBeenCalledWith("usuario@empresa.com");
  });
});
