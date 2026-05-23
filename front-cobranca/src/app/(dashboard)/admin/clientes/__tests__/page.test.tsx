import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AdminClient,
  CreateAdminClientInput,
  UpdateAdminClientInput,
} from "@/lib/api-client";
import AdminClientsPage from "../page";

jest.setTimeout(15000);

const mockGetAdminClients = jest.fn() as jest.MockedFunction<
  () => Promise<AdminClient[]>
>;
const mockCreateAdminClient = jest.fn() as jest.MockedFunction<
  (data: CreateAdminClientInput) => Promise<AdminClient>
>;
const mockResetAdminClientPassword = jest.fn() as jest.MockedFunction<
  (clientId: string) => Promise<{ userId: string; temporaryPassword: string }>
>;
const mockUpdateAdminClient = jest.fn() as jest.MockedFunction<
  (clientId: string, data: UpdateAdminClientInput) => Promise<AdminClient>
>;

const mockApiClient = {
  getAdminClients: mockGetAdminClients,
  createAdminClient: mockCreateAdminClient,
  updateAdminClient: mockUpdateAdminClient,
  resetAdminClientPassword: mockResetAdminClientPassword,
};

jest.mock("@/lib/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        role: "PLATFORM_ADMIN",
      },
    },
  }),
}));

function createAdminClientFixture(): AdminClient {
  return {
    id: "company-1",
    corporateName: "Empresa Certificada",
    document: "12345678000190",
    email: "financeiro@empresa.com",
    phoneNumber: "11999999999",
    status: "ACTIVE",
    enabledBillingMethods: ["PIX"],
    preferredBillingMethod: "PIX",
    onTimeSplitPercentageBps: 350,
    overdueSplitPercentageBps: 1200,
    gatewayStatus: "ACTIVE",
    whatsappStatus: "PENDING",
    firstUser: {
      id: "user-1",
      email: "admin@empresa.com",
      name: "Admin Empresa",
      role: "COMPANY_ADMIN",
    },
    efi: {
      configured: true,
      status: "ACTIVE",
      environment: "homologation",
    },
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
  };
}

async function fillRequiredClientFields(): Promise<void> {
  const user = userEvent.setup();

  await user.type(screen.getByLabelText("Razao social"), "Empresa Certificada");
  await user.type(screen.getByLabelText("CNPJ"), "12345678000190");
  await user.type(screen.getByLabelText("E-mail empresa"), "financeiro@empresa.com");
  await user.type(screen.getByLabelText("Telefone"), "11999999999");
  await user.type(screen.getByLabelText("Nome admin"), "Admin Empresa");
  await user.type(screen.getByLabelText("E-mail admin"), "admin@empresa.com");
  await user.type(screen.getByLabelText("Senha temporaria"), "senha123");
  await user.type(screen.getByLabelText("Efí client ID"), "client-id");
  await user.type(screen.getByLabelText("Efí client secret"), "client-secret");
  await user.type(screen.getByLabelText("Efí payee code"), "payee-code");
  await user.type(screen.getByLabelText("Senha do certificado"), "senha-certificado");

  const certificate = new File(["certificado"], "efi-homologacao.p12", {
    type: "application/x-pkcs12",
  });
  await user.upload(screen.getByLabelText("Certificado Efí"), certificate);
}

describe("AdminClientsPage", () => {
  beforeEach(() => {
    mockGetAdminClients.mockReset();
    mockCreateAdminClient.mockReset();
    mockUpdateAdminClient.mockReset();
    mockResetAdminClientPassword.mockReset();
    mockGetAdminClients.mockResolvedValue([]);
    mockCreateAdminClient.mockResolvedValue(createAdminClientFixture());
    mockUpdateAdminClient.mockResolvedValue({
      ...createAdminClientFixture(),
      corporateName: "Empresa Editada",
    });
    mockResetAdminClientPassword.mockResolvedValue({
      userId: "user-1",
      temporaryPassword: "nova-senha",
    });
  });

  it("uploads the Efi certificate and sends it when creating an admin client", async () => {
    const user = userEvent.setup();

    render(<AdminClientsPage />);

    await waitFor(() => expect(mockGetAdminClients).toHaveBeenCalled());
    await fillRequiredClientFields();

    expect(
      await screen.findByText("Novo certificado selecionado: efi-homologacao.p12"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cadastrar cliente/i }));

    await waitFor(() => expect(mockCreateAdminClient).toHaveBeenCalledTimes(1));

    const payload = mockCreateAdminClient.mock.calls[0]?.[0];
    expect(payload?.efi?.efiCertificateBase64).toBe(
      Buffer.from("certificado").toString("base64"),
    );
    expect(payload?.efi?.efiCertificatePassword).toBe("senha-certificado");
    expect(payload?.efi?.efiCertificatePath).toBe("");
  });

  it("shows changed fields in a confirmation modal before updating a client", async () => {
    const user = userEvent.setup();
    mockGetAdminClients.mockResolvedValue([createAdminClientFixture()]);

    render(<AdminClientsPage />);

    expect(await screen.findByText("Empresa Certificada")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /editar empresa certificada/i }),
    );
    await user.clear(screen.getByLabelText("Razao social"));
    await user.type(screen.getByLabelText("Razao social"), "Empresa Editada");
    await user.type(
      screen.getByLabelText("Meta token"),
      "novo-token-meta-com-mais-de-quarenta-caracteres",
    );
    await user.click(screen.getByRole("button", { name: /salvar alteracoes/i }));

    expect(await screen.findByText("Confirmar alteracoes")).toBeInTheDocument();
    expect(screen.getAllByText("Razao social").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Empresa Certificada").length).toBeGreaterThan(0);
    expect(screen.getByText("Empresa Editada")).toBeInTheDocument();
    expect(
      screen.getByText("novo-token-meta-com-mais-de-quarenta-caracteres"),
    ).toBeInTheDocument();
    expect(mockUpdateAdminClient).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^confirmar$/i }));

    await waitFor(() => expect(mockUpdateAdminClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateAdminClient).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        company: expect.objectContaining({
          corporateName: "Empresa Editada",
        }) as unknown,
        whatsapp: expect.objectContaining({
          metaAccessToken: "novo-token-meta-com-mais-de-quarenta-caracteres",
        }) as unknown,
      }) as unknown,
    );
  });

  it("does not update a client when the confirmation modal is cancelled", async () => {
    const user = userEvent.setup();
    mockGetAdminClients.mockResolvedValue([createAdminClientFixture()]);

    render(<AdminClientsPage />);

    expect(await screen.findByText("Empresa Certificada")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /editar empresa certificada/i }),
    );
    await user.clear(screen.getByLabelText("Razao social"));
    await user.type(screen.getByLabelText("Razao social"), "Empresa Editada");
    await user.click(screen.getByRole("button", { name: /salvar alteracoes/i }));
    await user.click(screen.getByRole("button", { name: /^cancelar$/i }));

    expect(mockUpdateAdminClient).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirmar alteracoes")).not.toBeInTheDocument();
  });
});
