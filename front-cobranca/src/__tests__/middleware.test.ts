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
    next: jest.fn(
      (): MockMiddlewareResult => ({
        kind: "next",
      }),
    ),
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
  auth: (handler: MockMiddlewareHandler) =>
    (request: MockMiddlewareRequest): MockMiddlewareResult =>
      handler(request),
}));

import middleware from "../middleware";
import { NextResponse } from "next/server";

const mockedNextResponse = NextResponse as unknown as MockNextResponse;

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
