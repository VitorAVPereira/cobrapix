type MockUserRole = "PLATFORM_ADMIN" | "COMPANY_ADMIN";

type MockMiddlewareRequest = {
  nextUrl: {
    pathname: string;
  };
  url: string;
  auth: {
    user?: {
      role?: MockUserRole;
      mustChangePassword?: boolean;
      authInvalidated?: boolean;
    };
  } | null;
};

type MockMiddlewareResult =
  | { kind: "next" }
  | { kind: "redirect"; url: string }
  | { body: unknown; init?: ResponseInit; kind: "json" };

type MockMiddlewareHandler = (
  request: MockMiddlewareRequest,
) => MockMiddlewareResult;

type MockNextResponse = {
  redirect: jest.Mock<MockMiddlewareResult, [URL]>;
  next: jest.Mock<MockMiddlewareResult, []>;
  json: jest.Mock<MockMiddlewareResult, [unknown, ResponseInit?]>;
};

jest.mock("next/server", () => ({
  NextResponse: {
    redirect: jest.fn((url: URL): MockMiddlewareResult => ({
      kind: "redirect",
      url: url.toString(),
    })),
    next: jest.fn((): MockMiddlewareResult => ({
      kind: "next",
    })),
    json: jest.fn(
      (body: unknown, init?: ResponseInit): MockMiddlewareResult => ({
        body,
        init,
        kind: "json",
      }),
    ),
  },
}));

jest.mock("@/lib/auth", () => ({
  auth:
    (handler: MockMiddlewareHandler) =>
    (request: MockMiddlewareRequest): MockMiddlewareResult =>
      handler(request),
}));

import middleware, { config } from "../middleware";
import { NextResponse } from "next/server";

const mockedNextResponse = NextResponse as unknown as MockNextResponse;

it("serves brand assets without redirecting unauthenticated visitors", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  expect(matcher.test("/brand/cifra-plus-primary.svg")).toBe(false);
  expect(matcher.test("/cobrancas")).toBe(true);
});

function createRequest(
  pathname: string,
  role: MockUserRole | null,
  overrides: { mustChangePassword?: boolean; authInvalidated?: boolean } = {},
): MockMiddlewareRequest {
  return {
    auth: role ? { user: { role, ...overrides } } : null,
    nextUrl: {
      pathname,
    },
    url: `http://localhost:3000${pathname}`,
  };
}

function runMiddleware(request: MockMiddlewareRequest): MockMiddlewareResult {
  return middleware(
    request as unknown as Parameters<typeof middleware>[0],
    {} as Parameters<typeof middleware>[1],
  ) as unknown as MockMiddlewareResult;
}

describe("middleware", () => {
  it("allows the platform bootstrap administrator to change the temporary password", () => {
    expect(
      runMiddleware(
        createRequest("/primeiro-acesso", "PLATFORM_ADMIN", {
          mustChangePassword: true,
        }),
      ),
    ).toEqual({ kind: "next" });
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows platform admins to access the admin overview route", () => {
    const result = runMiddleware(
      createRequest("/admin/visao-geral", "PLATFORM_ADMIN"),
    );

    expect(result).toEqual({ kind: "next" });
    expect(mockedNextResponse.redirect).not.toHaveBeenCalled();
  });

  it("redirects a backend-revoked NextAuth session to login", () => {
    const result = runMiddleware(
      createRequest("/cobrancas", "COMPANY_ADMIN", { authInvalidated: true }),
    );

    expect(result).toEqual({
      kind: "redirect",
      url: "http://localhost:3000/login?sessionExpired=1",
    });
  });
});

describe("public payment page", () => {
  // Same shape as the backend token: base64url payload "." base64url signature.
  const token =
    "eyJwdXJwb3NlIjoiaW52b2ljZS1wYXltZW50In0.c2lnbmF0dXJlLXdpdGgtdXJsLXNhZmUtY2hhcnM";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ["an anonymous payer", null, {}],
    ["a platform admin", "PLATFORM_ADMIN", {}],
    ["a company user of any company", "COMPANY_ADMIN", {}],
    ["an invalidated session", "COMPANY_ADMIN", { authInvalidated: true }],
    ["a user who must change the password", "COMPANY_ADMIN", { mustChangePassword: true }],
  ] as const)("reaches the page for %s without any redirect", (_who, role, overrides) => {
    expect(runMiddleware(createRequest(`/pagar/${token}`, role, overrides))).toEqual({
      kind: "next",
    });
    expect(mockedNextResponse.redirect).not.toHaveBeenCalled();
  });

  it("reaches the page with a malformed single segment, left for the backend to refuse", () => {
    expect(runMiddleware(createRequest("/pagar/not-a-token", null))).toEqual({ kind: "next" });
  });

  it.each([
    "/cobrancas",
    "/admin/clientes",
    "/pagar",
    "/pagar/",
    "/pagar-admin",
    "/pagarx/token",
    `/pagar/${token}/extra`,
    `/cobrancas/pagar/${token}`,
    "/admin/pagar",
  ])("keeps %s behind the login", (path) => {
    expect(runMiddleware(createRequest(path, null))).toEqual({
      kind: "redirect",
      url: "http://localhost:3000/login",
    });
  });

  it("keeps protected APIs answering 401 to anonymous callers", () => {
    expect(runMiddleware(createRequest("/api/pagar/token", null))).toMatchObject({
      kind: "json",
      init: { status: 401 },
    });
  });

  it("keeps the dashboard rules for signed-in users outside the payment page", () => {
    expect(runMiddleware(createRequest("/pagar-admin", "PLATFORM_ADMIN"))).toEqual({
      kind: "redirect",
      url: "http://localhost:3000/admin/clientes",
    });
    expect(
      runMiddleware(createRequest("/cobrancas", "COMPANY_ADMIN", { mustChangePassword: true })),
    ).toEqual({ kind: "redirect", url: "http://localhost:3000/primeiro-acesso" });
  });
});

describe("financial onboarding route authorization", () => {
  it.each([
    "/admin/efi-onboarding",
    "/admin/payment-fees",
    "/admin/conciliacao",
    "/admin/communications",
    "/admin/templates",
  ])("permits platform admins and rejects tenant access to %s", (path) => {
    expect(runMiddleware(createRequest(path, "PLATFORM_ADMIN"))).toEqual({
      kind: "next",
    });
    expect(runMiddleware(createRequest(path, "COMPANY_ADMIN"))).toEqual({
      kind: "redirect",
      url: "http://localhost:3000/",
    });
  });
  it("sends the legacy bank connection link to the automated assistant", () => {
    expect(
      runMiddleware(
        createRequest("/configuracoes/conecte-seu-banco", "COMPANY_ADMIN"),
      ),
    ).toEqual({
      kind: "redirect",
      url: "http://localhost:3000/onboarding/efi",
    });
  });
});
