import { revalidateAuthToken } from "../auth-session";

describe("revalidateAuthToken", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("invalidates the NextAuth token when the backend revoked its JWT", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ status: 401, ok: false });

    const result = await revalidateAuthToken(
      {
        access_token: "revoked-token",
        mustChangePassword: false,
        tokenVersion: 1,
      },
      "http://api.test",
    );

    expect(result.authInvalidated).toBe(true);
    expect(result.access_token).toBeUndefined();
  });

  it("synchronizes first-access state with the backend session", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        user: {
          id: "user-1",
          email: "admin@cliente.com",
          name: "Admin",
          companyId: "company-1",
          role: "COMPANY_ADMIN",
          mustChangePassword: true,
          tokenVersion: 2,
        },
      }),
    });

    const result = await revalidateAuthToken(
      { access_token: "valid-token", mustChangePassword: false, tokenVersion: 2 },
      "http://api.test",
    );

    expect(result).toEqual(
      expect.objectContaining({
        authInvalidated: false,
        mustChangePassword: true,
        tokenVersion: 2,
      }),
    );
  });

  it("keeps the local session during a temporary backend outage", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));
    const token = {
      access_token: "valid-token",
      mustChangePassword: false,
      tokenVersion: 2,
    };

    await expect(revalidateAuthToken(token, "http://api.test")).resolves.toEqual(
      token,
    );
  });
});
