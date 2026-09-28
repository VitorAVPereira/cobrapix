import { ApiClient, type ApiError } from "../api-client";

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function call(index = 0): { url: string; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[index]!;
  return { url: String(url), init: init ?? {} };
}

describe("ApiClient imported WhatsApp catalog", () => {
  const api = new ApiClient("http://api.test", "token");

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(ok({ items: [], nextCursor: null }));
  });

  it("lists the admin catalog with filters and cursor", async () => {
    await api.getAdminWhatsappTemplates({
      status: "UNAVAILABLE",
      supported: false,
      cursor: "11111111-1111-4111-8111-111111111111",
      limit: 25,
    });
    const { url } = call();
    const query = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe("/admin/whatsapp-templates");
    expect(query.get("status")).toBe("UNAVAILABLE");
    expect(query.get("supported")).toBe("false");
    expect(query.get("cursor")).toBe("11111111-1111-4111-8111-111111111111");
    expect(query.get("limit")).toBe("25");
  });

  it("omits unset filters so the server applies the approved default", async () => {
    await api.getAdminWhatsappTemplates();
    expect(call().url).toBe("http://api.test/admin/whatsapp-templates");
  });

  it("saves a mapping with the revisions the admin saw", async () => {
    mockFetch.mockResolvedValueOnce(ok({ mappingRevision: 2 }));
    const mapping = {
      body: { "1": { kind: "SOURCE" as const, source: "DEBTOR_NAME" as const } },
    };
    await expect(
      api.saveWhatsappTemplateMapping("tpl", {
        expectedProviderRevision: 3,
        expectedMappingRevision: 1,
        mapping,
      }),
    ).resolves.toEqual({ mappingRevision: 2 });
    const { url, init } = call();
    expect(url).toBe("http://api.test/admin/whatsapp-templates/tpl/mapping");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      expectedProviderRevision: 3,
      expectedMappingRevision: 1,
      mapping,
    });
  });

  it("previews, syncs, grants and sets defaults on the admin routes", async () => {
    await api.previewWhatsappTemplate("tpl", { mapping: { body: {} } });
    await api.syncWhatsappTemplates();
    await api.getCompanyWhatsappTemplates("company-a");
    await api.setCompanyWhatsappTemplateGrant("company-a", "tpl", {
      enabled: true,
      expectedVersion: 0,
    });
    await api.setCompanyWhatsappTemplateDefault("company-a", "BEFORE_DUE", {
      templateId: null,
      expectedVersion: 4,
    });
    expect(mockFetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["http://api.test/admin/whatsapp-templates/tpl/preview", "POST"],
      ["http://api.test/admin/whatsapp-templates/sync", "POST"],
      ["http://api.test/admin/whatsapp-templates/companies/company-a", undefined],
      [
        "http://api.test/admin/whatsapp-templates/companies/company-a/grants/tpl",
        "PUT",
      ],
      [
        "http://api.test/admin/whatsapp-templates/companies/company-a/defaults/BEFORE_DUE",
        "PUT",
      ],
    ]);
    expect(JSON.parse(call(4).init.body as string)).toEqual({
      templateId: null,
      expectedVersion: 4,
    });
  });

  it("surfaces a version conflict with its status and code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () =>
        JSON.stringify({
          code: "VERSION_CHANGED",
          message: "A configuração mudou. Atualize a prévia.",
        }),
    } as Response);
    const error = (await api
      .setCompanyWhatsappTemplateGrant("company-a", "tpl", {
        enabled: false,
        expectedVersion: 1,
      })
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error.status).toBe(409);
    expect(error.message).toBe("A configuração mudou. Atualize a prévia.");
    expect(error.data).toMatchObject({ code: "VERSION_CHANGED" });
  });

  it("no longer exposes authoring or submission to Meta", () => {
    const client = api as unknown as Record<string, unknown>;
    expect(client.createTemplate).toBeUndefined();
    expect(client.submitTemplateToMeta).toBeUndefined();
    expect(client.confirmTemplateReview).toBeUndefined();
    expect(client.syncTemplateMetaStatuses).toBeUndefined();
  });
});

describe("ApiClient held WhatsApp sends", () => {
  const api = new ApiClient("http://api.test", "token");

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(ok({ items: [], nextCursor: null }));
  });

  it("filters admin holds and keeps the company listing scoped to the session", async () => {
    await api.getAdminTemplatePending({
      companyId: "company-a",
      code: "NOT_GRANTED",
      state: "BLOCKED",
    });
    await api.getCompanyTemplatePending({ state: "CLOSED" });
    const admin = new URL(call(0).url);
    expect(admin.pathname).toBe("/communications/admin/template-pending");
    expect(Object.fromEntries(admin.searchParams)).toEqual({
      companyId: "company-a",
      code: "NOT_GRANTED",
      state: "BLOCKED",
    });
    expect(call(1).url).toBe(
      "http://api.test/communications/template-pending?state=CLOSED",
    );
  });

  it("previews and confirms a resume with the given idempotency key", async () => {
    await api.previewTemplateResume([
      { pendingId: "p-1", replacementTemplateId: "tpl" },
    ]);
    await api.confirmTemplateResume("review-1", "key-1");
    expect(call(0).url).toBe(
      "http://api.test/communications/admin/template-pending/reviews",
    );
    expect(JSON.parse(call(0).init.body as string)).toEqual({
      items: [{ pendingId: "p-1", replacementTemplateId: "tpl" }],
    });
    expect(call(1).url).toBe(
      "http://api.test/communications/admin/template-pending/reviews/review-1/confirm",
    );
    expect(JSON.parse(call(1).init.body as string)).toEqual({
      idempotencyId: "key-1",
    });
  });
});
