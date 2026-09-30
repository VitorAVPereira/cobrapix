import { render, screen } from "@testing-library/react";
import { AuthProvider } from "../SessionProvider";

let mockPathname = "/";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="session">{children}</div>,
}));

it.each([
  ["/pagar/payload.signature", false],
  ["/cobrancas", true],
  ["/pagar-admin", true],
  ["/login", true],
])("wraps %s in the dashboard session: %s", (pathname, wrapped) => {
  mockPathname = pathname;
  render(
    <AuthProvider>
      <p>conteúdo</p>
    </AuthProvider>,
  );
  expect(screen.getByText("conteúdo")).toBeInTheDocument();
  expect(Boolean(screen.queryByTestId("session"))).toBe(wrapped);
});
