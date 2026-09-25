import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinancialActivationAdmin } from "../FinancialActivationAdmin";
import type {
  FinancialOverview,
  FinancialProfile,
} from "@/lib/financial-activation";

const mockApi = {
  getFinancialOverview: jest.fn(),
  createFinancialActivation: jest.fn(),
  uploadFinancialCredentials: jest.fn(),
  updateFinancialConfiguration: jest.fn(),
  requestFinancialValidation: jest.fn(),
  activateFinancialProfile: jest.fn(),
  cancelFinancialActivation: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const company = { corporateName: "Empresa Modelo", document: "11222333000181" };
function candidate(
  overrides: Partial<FinancialProfile> = {},
): FinancialProfile {
  return {
    id: "profile-1",
    version: 1,
    revision: 3,
    status: "DRAFT",
    accountMode: "CUSTOMER_ACCOUNT",
    payoutMode: "DIRECT_TO_CUSTOMER",
    environment: "PRODUCTION",
    enabledMethods: ["PIX", "BOLIX"],
    authorization: { reference: null, validUntil: null },
    ownership: { verifiedAt: null, evidenceReference: null },
    issuer: null,
    credential: null,
    validatedAt: null,
    activatedAt: null,
    latestValidation: null,
    ...overrides,
  };
}
function overview(
  overrides: Partial<FinancialOverview> = {},
): FinancialOverview {
  return {
    companyId: "company-1",
    company,
    manualActivationReleased: true,
    active: null,
    candidate: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mockApi)) fn.mockResolvedValue({});
});

it("starts an activation with the customer's own Efí account", async () => {
  const user = userEvent.setup();
  mockApi.getFinancialOverview.mockResolvedValue(overview());
  render(<FinancialActivationAdmin companyId="company-1" />);
  expect(
    await screen.findByText(/Conta CifraMais com split ou repasse manual/),
  ).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /Conta CifraMais/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Iniciar ativação" }));
  expect(mockApi.createFinancialActivation).toHaveBeenCalledWith(
    "company-1",
    expect.objectContaining({
      environment: "PRODUCTION",
      enabledMethods: ["PIX", "BOLIX"],
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }),
  );
});

it("uploads the certificate and tokens as multipart and clears secrets", async () => {
  const user = userEvent.setup();
  mockApi.getFinancialOverview.mockResolvedValue(
    overview({ candidate: candidate() }),
  );
  render(<FinancialActivationAdmin companyId="company-1" />);
  const secret = await screen.findByLabelText("Client Secret");
  expect(secret).toHaveAttribute("type", "password");
  expect(screen.getByLabelText("CPF/CNPJ do titular")).toHaveValue(
    "11222333000181",
  );
  await user.type(screen.getByLabelText("Número da conta Efí"), "123456");
  await user.type(
    screen.getByLabelText("Identificador de conta (payee_code)"),
    "abc123",
  );
  await user.type(
    screen.getByLabelText("Chave Pix de recebimento"),
    "pix@empresa.test",
  );
  await user.type(screen.getByLabelText("Client ID"), "Client_Id_x");
  await user.type(secret, "Client_Secret_x");
  const file = new File([new Uint8Array([48, 130])], "cert.p12", {
    type: "application/x-pkcs12",
  });
  await user.upload(screen.getByLabelText("Certificado (.p12)"), file);
  await user.click(screen.getByRole("button", { name: "Salvar credenciais" }));

  const [id, form] = mockApi.uploadFinancialCredentials.mock.calls[0] as [
    string,
    FormData,
  ];
  expect(id).toBe("profile-1");
  expect(form.get("expectedRevision")).toBe("3");
  expect(form.get("clientSecret")).toBe("Client_Secret_x");
  expect((form.get("certificate") as File).name).toBe("cert.p12");
  expect(form.has("certificatePassword")).toBe(false);
  expect(form.has("efiAccountDigit")).toBe(false);
  await waitFor(() => expect(secret).toHaveValue(""));
});

it("reloads and explains a revision conflict", async () => {
  const user = userEvent.setup();
  mockApi.getFinancialOverview.mockResolvedValue(
    overview({ candidate: candidate() }),
  );
  mockApi.updateFinancialConfiguration.mockRejectedValue(
    Object.assign(new Error("conflito"), {
      status: 409,
      data: { code: "REVISION_CONFLICT" },
    }),
  );
  render(<FinancialActivationAdmin companyId="company-1" />);
  await user.type(
    await screen.findByLabelText(/Referência da autorização/),
    "contrato-1",
  );
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "alterada em outra tela",
  );
  expect(mockApi.getFinancialOverview).toHaveBeenCalledTimes(2);
});

it("requires explicit confirmations before activating", async () => {
  const user = userEvent.setup();
  const validUntil = new Date(Date.now() + 10 * 60_000).toISOString();
  mockApi.getFinancialOverview.mockResolvedValue(
    overview({
      candidate: candidate({
        status: "READY",
        issuer: {
          holderDocument: "••••0181",
          efiAccountNumber: "••••3456",
          payeeCode: "••••c123",
          pixKey: "••••test",
        },
        credential: {
          version: 1,
          status: "CANDIDATE",
          certificateFingerprint: "AA:BB",
          certificateExpiresAt: "2027-09-25T00:00:00.000Z",
        },
        authorization: { reference: "contrato-1", validUntil: null },
        ownership: {
          verifiedAt: "2026-09-25T10:00:00.000Z",
          evidenceReference: "chamado-1",
        },
        latestValidation: {
          id: "attempt-1",
          profileRevision: 3,
          status: "SUCCEEDED",
          attempts: 1,
          errorCode: null,
          validUntil,
          steps: [
            {
              code: "PIX_WEBHOOK",
              status: "PASSED",
              effect: "PIX_WEBHOOK_CONFIGURED",
            },
            {
              code: "BOLIX_ISSUANCE",
              status: "NOT_VERIFIABLE",
              effect: "NONE",
            },
          ],
        },
      }),
    }),
  );
  render(<FinancialActivationAdmin companyId="company-1" />);
  const activate = await screen.findByRole("button", {
    name: "Ativar financeiro",
  });
  expect(activate).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", { name: /Confirmo a ativação/ }),
  );
  expect(activate).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /Estou ciente/ }));
  expect(activate).toBeEnabled();
  await user.click(activate);
  expect(mockApi.activateFinancialProfile).toHaveBeenCalledWith(
    "profile-1",
    expect.objectContaining({
      expectedRevision: 3,
      validationAttemptId: "attempt-1",
      confirmEffects: true,
      acknowledgeUnverifiedSteps: true,
    }),
  );
});

it("warns when new manual activations are paused", async () => {
  mockApi.getFinancialOverview.mockResolvedValue(
    overview({
      manualActivationReleased: false,
      candidate: candidate({
        issuer: {
          holderDocument: "••••0181",
          efiAccountNumber: "••••3456",
          payeeCode: "••••c123",
          pixKey: "••••test",
        },
        credential: {
          version: 1,
          status: "CANDIDATE",
          certificateFingerprint: "AA:BB",
          certificateExpiresAt: "2027-09-25T00:00:00.000Z",
        },
        authorization: { reference: "contrato-1", validUntil: null },
        ownership: {
          verifiedAt: "2026-09-25T10:00:00.000Z",
          evidenceReference: "chamado-1",
        },
      }),
    }),
  );
  render(<FinancialActivationAdmin companyId="company-1" />);
  expect(
    await screen.findByText(/Novas ativações manuais estão pausadas/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Validar integração" }),
  ).toBeDisabled();
});
