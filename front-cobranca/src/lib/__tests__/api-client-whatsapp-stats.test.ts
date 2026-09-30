import { ApiClient } from "../api-client";

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const interactions = { outbound: 2, delivered: 1, read: 1, inbound: 0, failed: 0 };
const json = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

beforeEach(() => mockFetch.mockReset());

it("reads the company statistics endpoint", async () => {
  mockFetch.mockResolvedValue(json({ period: "rolling_24h", interactions }));
  await expect(new ApiClient("http://api.test", "token").getWhatsappStats()).resolves.toEqual({
    period: "rolling_24h",
    interactions,
  });
  expect(mockFetch).toHaveBeenCalledWith("http://api.test/whatsapp/stats", expect.anything());
});

it("takes only the interactions from the legacy answer while the API is older", async () => {
  mockFetch
    .mockResolvedValueOnce(json({ message: "Cannot GET /whatsapp/stats" }, 404))
    .mockResolvedValueOnce(json({ tier: "TIER_50", dailyLimit: 50, dailyUsage: 3, remaining: 47, interactions }));
  const stats = await new ApiClient("http://api.test", "token").getWhatsappStats();
  expect(stats).toEqual({ period: "rolling_24h", interactions });
  expect(JSON.stringify(stats)).not.toMatch(/dailyLimit|remaining|tier/);
});

it("does not hide other failures behind the legacy route", async () => {
  mockFetch.mockResolvedValue(json({ message: "Erro interno" }, 500));
  await expect(new ApiClient("http://api.test", "token").getWhatsappStats()).rejects.toMatchObject({ status: 500 });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
