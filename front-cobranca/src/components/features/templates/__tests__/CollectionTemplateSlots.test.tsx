import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CollectionTemplateSlots } from "../CollectionTemplateSlots";
import {
  COLLECTION_PURPOSES,
  COLLECTION_SLOT_METHODS,
  type CollectionTemplateSlots as SlotsView,
} from "../types";

const mockApi = {
  getCollectionTemplateSlots: jest.fn(),
  setCollectionTemplateSlot: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

function view(): SlotsView {
  return {
    slots: COLLECTION_PURPOSES.flatMap((purpose) =>
      COLLECTION_SLOT_METHODS.map((billingMethod) =>
        purpose === "BEFORE_DUE" && billingMethod === "PIX"
          ? {
              purpose,
              billingMethod,
              templateId: "tpl-pix",
              templateName: "lembrete_pix",
              version: 2,
              available: { ready: true, code: null },
            }
          : {
              purpose,
              billingMethod,
              templateId: null,
              templateName: null,
              version: 0,
              available: { ready: false, code: "DEFAULT_MISSING" as const },
            },
      ),
    ),
    options: {
      PIX: [
        { id: "tpl-pix", name: "lembrete_pix", language: "pt_BR" },
        { id: "tpl-link", name: "lembrete_link", language: "pt_BR" },
      ],
      BOLIX: [
        { id: "tpl-pix", name: "lembrete_pix", language: "pt_BR" },
        { id: "tpl-link", name: "lembrete_link", language: "pt_BR" },
      ],
      CREDIT_CARD: [{ id: "tpl-link", name: "lembrete_link", language: "pt_BR" }],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCollectionTemplateSlots.mockResolvedValue(view());
  mockApi.setCollectionTemplateSlot.mockResolvedValue({ version: 1 });
});

describe("CollectionTemplateSlots", () => {
  it("shows the 18 slots by moment, with only fitting templates per method", async () => {
    render(<CollectionTemplateSlots />);
    expect(await screen.findByText("1 de 18 prontos")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(18);

    const reminder = screen.getByRole("group", { name: "Lembrete" });
    expect(within(reminder).getByRole("combobox", { name: "Template: Lembrete · Pix" })).toHaveValue("tpl-pix");
    const card = within(reminder).getByRole("combobox", { name: "Template: Lembrete · Cartão" });
    expect(within(card).queryByRole("option", { name: /lembrete_pix/ })).not.toBeInTheDocument();
    expect(within(card).getByRole("option", { name: /lembrete_link/ })).toBeInTheDocument();
  });

  it("saves one slot with the version the admin saw", async () => {
    render(<CollectionTemplateSlots />);
    const select = await screen.findByRole("combobox", { name: "Template: Vence hoje · Cartão" });
    const save = screen.getByRole("button", { name: "Salvar template: Vence hoje · Cartão" });
    expect(save).toBeDisabled();

    fireEvent.change(select, { target: { value: "tpl-link" } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(mockApi.setCollectionTemplateSlot).toHaveBeenCalledWith("DUE_TODAY", "CREDIT_CARD", {
        templateId: "tpl-link",
        expectedVersion: 0,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Vence hoje · Cartão");
    expect(mockApi.getCollectionTemplateSlots).toHaveBeenCalledTimes(2);
  });

  it("reloads on a conflict instead of overwriting", async () => {
    mockApi.setCollectionTemplateSlot.mockRejectedValue(
      Object.assign(new Error("conflito"), { status: 409 }),
    );
    render(<CollectionTemplateSlots />);
    const select = await screen.findByRole("combobox", { name: "Template: Lembrete · Pix" });
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar template: Lembrete · Pix" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/outro administrador/i);
    expect(mockApi.setCollectionTemplateSlot).toHaveBeenCalledWith("BEFORE_DUE", "PIX", {
      templateId: null,
      expectedVersion: 2,
    });
    await waitFor(() => expect(mockApi.getCollectionTemplateSlots).toHaveBeenCalledTimes(2));
  });

  it("tells a load failure apart from an empty catalog", async () => {
    mockApi.getCollectionTemplateSlots.mockRejectedValueOnce(new Error("Falha de rede"));
    render(<CollectionTemplateSlots />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("1 de 18 prontos")).toBeInTheDocument();
  });
});
