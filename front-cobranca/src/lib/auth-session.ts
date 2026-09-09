export interface RefreshableAuthToken {
  access_token?: string;
  companyId?: string;
  userId?: string;
  role?: "PLATFORM_ADMIN" | "COMPANY_ADMIN";
  mustChangePassword?: boolean;
  tokenVersion?: number;
  authInvalidated?: boolean;
  [key: string]: unknown;
}

interface BackendSessionResponse {
  user: {
    id: string;
    email: string;
    name?: string | null;
    companyId: string;
    role: "PLATFORM_ADMIN" | "COMPANY_ADMIN";
    mustChangePassword: boolean;
    tokenVersion: number;
  };
}

export async function revalidateAuthToken(
  token: RefreshableAuthToken,
  apiUrl: string,
): Promise<RefreshableAuthToken> {
  if (!token.access_token) return token;

  try {
    const response = await fetch(`${apiUrl}/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ...token,
        access_token: undefined,
        authInvalidated: true,
      };
    }

    if (!response.ok) return token;

    const session = (await response.json()) as BackendSessionResponse;
    return {
      ...token,
      companyId: session.user.companyId,
      userId: session.user.id,
      role: session.user.role,
      mustChangePassword: session.user.mustChangePassword,
      tokenVersion: session.user.tokenVersion,
      authInvalidated: false,
    };
  } catch {
    // A transient outage must not destroy a valid local session. Protected API
    // calls still validate the JWT at the backend.
    return token;
  }
}
