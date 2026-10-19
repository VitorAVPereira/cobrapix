import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImportClientReview, ImportExistingClient } from "@/lib/api-client";
import { ImportReview } from "../ImportReview";

function existing(overrides: Partial<ImportExistingClient> = {}): ImportExistingClient {
  return {
    debtorId: "debtor-ana",
    document: "52998224725",
    name: "Ana Maria",
    phone: "+5511999990009",
    email: "velho@example.com",
    whatsappOptIn: false,
    version: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function different(overrides: Partial<ImportClientReview> = {}): ImportClientReview {
  return {
    document: "52998224725",
    rows: [0, 1],
    csv: { name: "Ana Souza", phone: "+5511999990001", email: "ana@example.com" },
    optIn: false,
    phoneOwner: null,
    kind: "DIFFERENT",
    existing: existing(),
    differences: ["name", "phone", "email"],
    ...overrides,
  } as ImportClientReview;
}

function renderReview(clients: ImportClientReview[], onValidatePhone = jest.fn()) {
  const onComplete = jest.fn();
  render(
    <ImportReview
      clients={clients}
      onValidatePhone={onValidatePhone}
      onComplete={onComplete}
      onCancel={jest.fn()}
    />,
  );
  return { onComplete, onValidatePhone };
}

describe("ImportReview", () => {
  it("compares registry and spreadsheet field by field, keeping the registry by default", () => {
    const { onComplete } = renderReview([different()]);

    expect(screen.getByText("Cliente 1 de 1")).toBeInTheDocument();
    expect(screen.getByText("529.982.247-25 · 2 cobranças na planilha")).toBeInTheDocument();
    expect(screen.getByLabelText("Manter Nome do cadastro")).toBeChecked();

    fireEvent.click(screen.getByLabelText("Usar Nome da planilha"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onComplete).toHaveBeenCalledWith([
      {
        document: "52998224725",
        action: "LINK",
        debtorId: "debtor-ana",
        version: "2026-10-01T00:00:00.000Z",
        use: { name: "CSV", phone: "EXISTING", email: "EXISTING" },
      },
    ]);
  });

  it("never offers the WhatsApp of another client", () => {
    renderReview([different({ phoneOwner: { debtorId: "debtor-bruno", name: "Bruno" } })]);

    expect(screen.getByLabelText("Usar WhatsApp da planilha")).toBeDisabled();
    expect(screen.getByText("Já é de Bruno.")).toBeInTheDocument();
  });

  it("applies the same choice to the next clients with different data", () => {
    const second = different({
      document: "11144477735",
      csv: { name: "Bruno Lima", phone: "+5511999990002", email: null },
      existing: existing({ debtorId: "debtor-bruno", document: "11144477735", name: "Bruno" }),
      differences: ["name"],
    });
    const { onComplete } = renderReview([different(), second]);

    fireEvent.click(screen.getByLabelText("Usar Nome da planilha"));
    fireEvent.click(
      screen.getByLabelText(
        "Aplicar esta escolha a todos os próximos clientes com dados diferentes",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ debtorId: "debtor-ana", use: expect.objectContaining({ name: "CSV" }) }),
      expect.objectContaining({ debtorId: "debtor-bruno", use: expect.objectContaining({ name: "CSV" }) }),
    ]);
  });

  it("lets a new client with a taken WhatsApp use another number, or be left out", async () => {
    const taken = {
      document: "39053344705",
      rows: [2],
      csv: { name: "Carla", phone: "+5511999990003", email: null },
      optIn: false,
      phoneOwner: { debtorId: "debtor-bruno", name: "Bruno" },
      kind: "PHONE_TAKEN",
    } as ImportClientReview;
    const onValidatePhone = jest
      .fn()
      .mockResolvedValueOnce("Este WhatsApp também já é de Diego.")
      .mockResolvedValueOnce(null);
    const { onComplete } = renderReview([taken], onValidatePhone);

    expect(screen.getByText(/já é de/)).toHaveTextContent("Bruno");
    fireEvent.change(screen.getByPlaceholderText("+55 (11) 99999-9999"), {
      target: { value: "11988887777" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Usar este WhatsApp" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("também já é de Diego");

    fireEvent.click(screen.getByRole("button", { name: "Usar este WhatsApp" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith([]));
    expect(onValidatePhone).toHaveBeenLastCalledWith(taken, "11988887777");
  });

  it("links a duplicated document to the client the user picks", () => {
    const first = existing({ debtorId: "debtor-1", name: "Ana Souza", phone: "+5511999990001", email: "ana@example.com" });
    const second = existing({ debtorId: "debtor-2", name: "Ana S.", phone: "+5511999990005", email: null });
    const duplicated = {
      document: "52998224725",
      rows: [0],
      csv: { name: "Ana Souza", phone: "+5511999990001", email: "ana@example.com" },
      optIn: false,
      phoneOwner: { debtorId: "debtor-1", name: "Ana Souza" },
      kind: "DUPLICATE_DOCUMENT",
      candidates: [first, second],
    } as ImportClientReview;
    const { onComplete } = renderReview([duplicated]);

    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(screen.getByText("Os dados da planilha são iguais aos do cadastro.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ action: "LINK", debtorId: "debtor-1" }),
    ]);
  });

  it("leaves a client out of the import", () => {
    const { onComplete } = renderReview([different()]);
    fireEvent.click(screen.getByRole("button", { name: "Não importar este cliente" }));
    expect(onComplete).toHaveBeenCalledWith([{ document: "52998224725", action: "SKIP" }]);
  });

  it("links an older client without document, or registers a new one with another WhatsApp", async () => {
    const owner = existing({ debtorId: "debtor-old", document: null, name: "Ana", email: null });
    const undocumented = {
      document: "52998224725",
      rows: [0],
      csv: { name: "Ana Souza", phone: "+5511999990009", email: null },
      optIn: false,
      phoneOwner: { debtorId: "debtor-old", name: "Ana" },
      kind: "UNDOCUMENTED_OWNER",
      existing: owner,
      differences: ["name"],
    } as ImportClientReview;

    const { onComplete } = renderReview([undocumented]);
    expect(screen.getByText(/cadastrado sem CPF\/CNPJ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onComplete).toHaveBeenCalledWith([
      expect.objectContaining({ action: "LINK", debtorId: "debtor-old" }),
    ]);
  });

  it("registers the older client case as new when another WhatsApp is given", async () => {
    const undocumented = {
      document: "52998224725",
      rows: [0],
      csv: { name: "Ana Souza", phone: "+5511999990009", email: null },
      optIn: false,
      phoneOwner: { debtorId: "debtor-old", name: "Ana" },
      kind: "UNDOCUMENTED_OWNER",
      existing: existing({ debtorId: "debtor-old", document: null }),
      differences: [],
    } as ImportClientReview;
    const onValidatePhone = jest.fn().mockResolvedValue(null);
    const { onComplete } = renderReview([undocumented], onValidatePhone);

    fireEvent.click(screen.getByLabelText("Cadastrar como cliente novo, com outro WhatsApp"));
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("+55 (11) 99999-9999"), {
      target: { value: "11977776666" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Usar este WhatsApp" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith([]));
  });
});
