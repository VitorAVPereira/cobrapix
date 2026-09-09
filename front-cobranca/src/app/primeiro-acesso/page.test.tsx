import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useApiClient } from "@/lib/use-api-client";
import FirstAccessPage from "./page";

const mockPush = jest.fn();
const mockChangePassword = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("next-auth/react", () => ({ signOut: jest.fn() }));

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: jest.fn(),
}));

const mockSignOut = signOut as jest.MockedFunction<typeof signOut>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseApiClient = useApiClient as jest.MockedFunction<
  typeof useApiClient
>;

describe("FirstAccessPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockChangePassword.mockReset();
    mockSignOut.mockReset();
    mockChangePassword.mockResolvedValue({ message: "Senha alterada com sucesso." });
    mockSignOut.mockResolvedValue({ url: "/login" });
    mockUseRouter.mockReturnValue({
      back: jest.fn(),
      forward: jest.fn(),
      prefetch: jest.fn(),
      push: mockPush,
      refresh: jest.fn(),
      replace: jest.fn(),
    });
    mockUseApiClient.mockReturnValue({
      changePassword: mockChangePassword,
    } as unknown as ReturnType<typeof useApiClient>);
  });

  it("changes the temporary password and closes the old session", async () => {
    const user = userEvent.setup();
    render(<FirstAccessPage />);

    await user.type(screen.getByLabelText(/senha temporária/i), "Temporaria1");
    await user.type(screen.getByLabelText(/^nova senha$/i), "Definitiva1");
    await user.type(
      screen.getByLabelText(/confirmar nova senha/i),
      "Definitiva1",
    );
    await user.click(screen.getByRole("button", { name: /trocar senha/i }));

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: "Temporaria1",
        password: "Definitiva1",
        passwordConfirmation: "Definitiva1",
      });
      expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
      expect(mockPush).toHaveBeenCalledWith("/login?passwordChanged=1");
    });
  });
});
