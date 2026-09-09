import { ApiClient } from "../api-client";

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

global.fetch = mockFetch;

describe("ApiClient authentication", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Operação concluída." }),
    } as Response);
  });

  it("requests password recovery without authentication", async () => {
    const client = new ApiClient("http://api.test");

    await client.forgotPassword("usuario@empresa.com");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://api.test/auth/forgot-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "usuario@empresa.com" }),
      }),
    );
  });

  it("submits reset token and confirmed password", async () => {
    const client = new ApiClient("http://api.test");

    await client.resetPassword({
      token: "company-1.secret",
      password: "NovaSenha1",
      passwordConfirmation: "NovaSenha1",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://api.test/auth/reset-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          token: "company-1.secret",
          password: "NovaSenha1",
          passwordConfirmation: "NovaSenha1",
        }),
      }),
    );
  });

  it("changes the temporary password using the authenticated token", async () => {
    const client = new ApiClient("http://api.test", "jwt-token", {
      requireAuth: true,
    });

    await client.changePassword({
      currentPassword: "Temporaria1",
      password: "Definitiva1",
      passwordConfirmation: "Definitiva1",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://api.test/auth/change-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          currentPassword: "Temporaria1",
          password: "Definitiva1",
          passwordConfirmation: "Definitiva1",
        }),
        headers: expect.objectContaining({ Authorization: "Bearer jwt-token" }),
      }),
    );
  });
});
