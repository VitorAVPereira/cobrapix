import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AdminClient,
  CreateAdminClientResponse,
  CreateAdminClientInput,
  UpdateAdminClientInput,
} from "@/lib/api-client";
import AdminClientsPage from "../page";

jest.setTimeout(15000);

const mockGetAdminClients = jest.fn() as jest.MockedFunction<
  () => Promise<AdminClient[]>
>;
const mockCreateAdminClient = jest.fn() as jest.MockedFunction<
  (data: CreateAdminClientInput) => Promise<CreateAdminClientResponse>
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
}

describe("AdminClientsPage", () => {
  beforeEach(() => {
    mockGetAdminClients.mockReset();
    mockCreateAdminClient.mockReset();
    mockUpdateAdminClient.mockReset();
    mockResetAdminClientPassword.mockReset();
    mockGetAdminClients.mockResolvedValue([]);
    mockCreateAdminClient.mockResolvedValue({
      client: createAdminClientFixture(),
      temporaryPassword: "TempSenha1",
      integrationWarnings: [],
    });
    mockUpdateAdminClient.mockResolvedValue({
      ...createAdminClientFixture(),
      corporateName: "Empresa Editada",
    });
    mockResetAdminClientPassword.mockResolvedValue({
      userId: "user-1",
      temporaryPassword: "nova-senha",
    });
  });

  it("creates an admin client without tenant integration credentials", async () => {
    const user = userEvent.setup();
    mockGetAdminClients
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Falha ao recarregar clientes"));
    mockCreateAdminClient.mockResolvedValue({
      client: createAdminClientFixture(),
      temporaryPassword: "TempSenha1",
      integrationWarnings: [
        "Cliente criado, mas a integração com a Efí não pôde ser configurada.",
      ],
    });

    render(<AdminClientsPage />);

    await waitFor(() => expect(mockGetAdminClients).toHaveBeenCalled());
    await fillRequiredClientFields();

    expect(screen.queryByLabelText("Efí client ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Meta token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ERP API key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ERP webhook URL")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cadastrar cliente/i }));

    await waitFor(() => expect(mockCreateAdminClient).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/senha temporaria: tempsenha1/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Falha ao recarregar clientes")).toBeInTheDocument();
    expect(
      screen.getByText(/integração com a Efí não pôde ser configurada/i),
    ).toBeInTheDocument();

    const payload = mockCreateAdminClient.mock.calls[0]?.[0];
    expect(payload?.efi).toBeUndefined();
    expect(payload).not.toHaveProperty("meta");
  });

  it("guides account opening through the portal and uses the administrator WhatsApp channel", async () => {
    const user = userEvent.setup();
    render(<AdminClientsPage />);

    expect(screen.getByText(/abertura automatizada da conta Efí pelo portal/i)).toBeInTheDocument();
    expect(screen.getByText(/mesmo número de WhatsApp do administrador da plataforma/i)).toBeInTheDocument();
    for (const label of ["Status WhatsApp", "Limite Meta", "Descontos por devedor", "Emails notificacao pagamento", "Responsavel legal", "Banco", "Digito conta"]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }

    await fillRequiredClientFields();
    await user.selectOptions(screen.getByLabelText("Metodo preferido"), "PIX");
    await user.click(screen.getByRole("button", { name: /cadastrar cliente/i }));

    await waitFor(() => expect(mockCreateAdminClient).toHaveBeenCalledTimes(1));
    expect(mockCreateAdminClient.mock.calls[0]?.[0]).toEqual({
      company: {
        corporateName: "Empresa Certificada", document: "12345678000190",
        email: "financeiro@empresa.com", phoneNumber: "11999999999", status: "ACTIVE",
      },
      firstUser: { name: "Admin Empresa", email: "admin@empresa.com" },
      billing: { enabledBillingMethods: ["PIX", "BOLIX"], preferredBillingMethod: "PIX" },
    });
  });

  it("keeps persisted billing settings in editing without tenant WhatsApp controls", async () => {
    const user = userEvent.setup();
    mockGetAdminClients.mockResolvedValue([createAdminClientFixture()]);
    render(<AdminClientsPage />);

    await user.click(await screen.findByRole("button", { name: /editar empresa certificada/i }));
    expect(screen.getByLabelText("Dias da regua")).toBeInTheDocument();
    expect(screen.getByLabelText("Emails notificacao pagamento")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status WhatsApp")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Limite Meta")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Digito conta")).not.toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp PENDING/)).not.toBeInTheDocument();
    for (const label of ["Descontos por devedor", "Dia gatilho desconto", "Desconto automatico", "Dias desconto automatico", "Percentual desconto automatico", "ERP API key", "ERP webhook URL", "Eventos ERP"]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
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
    await user.click(screen.getByRole("button", { name: /salvar alteracoes/i }));

    expect(await screen.findByText("Confirmar alteracoes")).toBeInTheDocument();
    expect(screen.getAllByText("Razao social").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Empresa Certificada").length).toBeGreaterThan(0);
    expect(screen.getByText("Empresa Editada")).toBeInTheDocument();
    expect(mockUpdateAdminClient).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^confirmar$/i }));

    await waitFor(() => expect(mockUpdateAdminClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateAdminClient).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        company: expect.objectContaining({
          corporateName: "Empresa Editada",
        }) as unknown,
      }) as unknown,
    );
    const payload = mockUpdateAdminClient.mock.calls[0]?.[1];
    expect(payload?.integrations).toBeUndefined();
    expect(payload?.billing).not.toHaveProperty("autoDiscountEnabled");
    expect(payload?.billing).not.toHaveProperty("autoDiscountDaysAfterDue");
    expect(payload?.billing).not.toHaveProperty("autoDiscountPercentage");
    expect(payload?.notifications).toEqual({
      businessSegment: "GENERAL", paymentNotificationEnabled: true, paymentNotificationEmails: [],
    });
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
