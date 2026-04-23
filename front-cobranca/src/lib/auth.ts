import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

declare module "next-auth" {
  interface User {
    companyId: string;
    access_token: string;
  }

  interface Session {
    access_token?: string;
    user: {
      id: string;
      email: string;
      name?: string | null;
      companyId: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    companyId?: string;
    userId?: string;
    access_token?: string;
  }
}

const AUTH_API_URL =
  process.env.AUTH_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001";

interface LoginResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
    companyId: string;
  };
}

async function parseLoginResponse(response: Response): Promise<LoginResponse> {
  return response.json() as Promise<LoginResponse>;
}

function logAuthFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  console.error(
    `Erro ao autenticar: API NestJS inacessivel em ${AUTH_API_URL}. ` +
      `Confirme se o api-cobranca esta rodando na porta 3001. Detalhe: ${message}`,
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        try {
          // Chama API Nest para autenticação
          const res = await fetch(`${AUTH_API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });

          if (!res.ok) {
            return null;
          }

          const data = await parseLoginResponse(res);

          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            companyId: data.user.companyId,
            access_token: data.access_token,
          };
        } catch (error: unknown) {
          logAuthFailure(error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.companyId = user.companyId;
        token.userId = user.id;
        token.access_token = user.access_token;
      }
      return token;
    },
    session({ session, token }) {
      session.user.companyId = token.companyId as string;
      session.user.id = token.userId as string;
      session.access_token = token.access_token;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});
