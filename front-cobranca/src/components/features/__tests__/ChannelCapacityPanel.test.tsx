import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CentralChannelCapacity } from "@/lib/api-client";
import { ChannelCapacityPanel } from "../ChannelCapacityPanel";

const mockApi = { getChannelCapacity: jest.fn(), syncChannelTier: jest.fn() };
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const capacity = (overrides: Partial<CentralChannelCapacity> = {}): CentralChannelCapacity => ({
  limit: 50,
  used: 12,
  remaining: 38,
  unit: "UNIQUE_RECIPIENTS",
  windowSeconds: 86_400,
  scopeId: "channel:123",
  source: "FALLBACK",
  tier: null,
  checkedAt: null,
  nextAvailableAt: null,
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

it("labels the local protection as unconfirmed, not as the account limit", async () => {
  mockApi.getChannelCapacity.mockResolvedValue(capacity());
  render(<ChannelCapacityPanel />);
  expect(await screen.findByText(/Proteção local conservadora/)).toBeInTheDocument();
  expect(screen.getByText("Não confirmado")).toBeInTheDocument();
  expect(screen.getByText("38")).toBeInTheDocument();
  expect(screen.getByText(/verificado em —/)).toBeInTheDocument();
});

it("shows a verified tier with its source and verification time in Brasília", async () => {
  mockApi.getChannelCapacity.mockResolvedValue(
    capacity({ source: "VERIFIED_CACHE", tier: "TIER_2K", limit: 2_000, remaining: 1_988, checkedAt: "2026-09-29T18:00:00Z" }),
  );
  render(<ChannelCapacityPanel />);
  expect(await screen.findByText("TIER_2K")).toBeInTheDocument();
  expect(screen.getByText(/Confirmado pelo Datafy · verificado em 29\/09\/2026, 15:00/)).toBeInTheDocument();
});

it("shows when the next unit frees once exhausted", async () => {
  mockApi.getChannelCapacity.mockResolvedValue(
    capacity({ used: 50, remaining: 0, nextAvailableAt: "2026-09-30T12:00:00Z" }),
  );
  render(<ChannelCapacityPanel />);
  expect(await screen.findByText(/próxima vaga em 30\/09\/2026, 09:00/)).toBeInTheDocument();
});

it("never presents an unknown control state as unlimited", async () => {
  mockApi.getChannelCapacity.mockResolvedValue(
    capacity({ source: "UNAVAILABLE", limit: null, used: null, remaining: null, windowSeconds: null }),
  );
  render(<ChannelCapacityPanel />);
  expect(await screen.findByText(/Estado do controle desconhecido/)).toBeInTheDocument();
  expect(screen.queryByText("Sem limite")).toBeNull();
});

it("shows an unlimited tier only when the provider confirmed it", async () => {
  mockApi.getChannelCapacity.mockResolvedValue(
    capacity({ source: "VERIFIED_CACHE", tier: "TIER_UNLIMITED", limit: null, remaining: null }),
  );
  render(<ChannelCapacityPanel />);
  expect(await screen.findByText("Sem limite")).toBeInTheDocument();
});

it("reports a failed consultation as unavailable", async () => {
  mockApi.getChannelCapacity.mockRejectedValue(new Error("403"));
  render(<ChannelCapacityPanel />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível consultar");
  expect(screen.getByText(/Estado do controle desconhecido/)).toBeInTheDocument();
});

it("confirms the tier once per click and shows the refreshed capacity", async () => {
  const user = userEvent.setup();
  mockApi.getChannelCapacity.mockResolvedValue(capacity());
  let release: (value: unknown) => void = () => undefined;
  mockApi.syncChannelTier.mockReturnValue(new Promise((resolve) => (release = resolve)));
  render(<ChannelCapacityPanel />);
  await user.dblClick(await screen.findByRole("button", { name: /Confirmar tier/ }));
  release({ tier: "TIER_1K", capacity: capacity({ source: "PROVIDER", tier: "TIER_1K", limit: 1_000, remaining: 988 }) });
  expect(await screen.findByRole("status")).toHaveTextContent("Tier confirmado: TIER_1K.");
  expect(screen.getByText(/Confirmado agora pelo Datafy/)).toBeInTheDocument();
  expect(mockApi.syncChannelTier).toHaveBeenCalledTimes(1);
});

it("says e-mail capacity is not informed instead of inventing it", async () => {
  mockApi.getChannelCapacity.mockResolvedValue(capacity());
  render(<ChannelCapacityPanel />);
  await waitFor(() => expect(mockApi.getChannelCapacity).toHaveBeenCalled());
  expect(screen.getByText(/E-mail \(Resend\): capacidade e reputação da conta não são informadas/)).toBeInTheDocument();
});
