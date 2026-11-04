import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckoutClientDetail, CheckoutPlatformView } from "@/lib/api-client";
import { PlatformCardForm } from "../PlatformCardForm";
import { CardPausePanel } from "../CardPausePanel";

const mockApi = { setCheckoutPlatformCard: jest.fn(), setCheckoutCardPause: jest.fn() };
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const current: NonNullable<CheckoutPlatformView["current"]> = {
  id: "settings-3",
  version: 3,
  pixFeeBasisPoints: 119,
  cardEnabled: false,
  cardRates: null,
  cardCreditDays: null,
  webhookConfiguredAt: "2026-11-04T12:00:00.000Z",
  createdAt: "2026-11-04T12:00:00.000Z",
  identityId: "identity-1",
};
const client: CheckoutClientDetail = {
  id: "company-1",
  corporateName: "Porquim",
  document: "11222333000181",
  email: "contato@porquim.test",
  phoneNumber: "11999999999",
  status: "ACTIVE",
  createdAt: "2026-11-03T12:00:00.000Z",
  users: [],
  terms: [],
  card: { enabledBySeller: true, pausedAt: null },
};

describe("Cartão no admin", () => {
  beforeEach(() => jest.clearAllMocks());

  it("salva a tarifa do cartão em pontos-base, com a versão esperada", async () => {
    const user = userEvent.setup();
    mockApi.setCheckoutPlatformCard.mockResolvedValue({});
    const onSaved = jest.fn();
    render(<PlatformCardForm current={current} onSaved={onSaved} onConflict={jest.fn()} />);

    await user.type(screen.getByLabelText("Tarifa à vista (%)"), "3,49");
    await user.type(screen.getByLabelText("Antecipação por parcela (%)"), "1,59");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /salvar cartão/i }));

    expect(mockApi.setCheckoutPlatformCard).toHaveBeenCalledWith({
      expectedVersion: 3,
      cardEnabled: true,
      cashBasisPoints: 349,
      anticipationBasisPoints: 159,
      cardCreditDays: 30,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("pausa o cartão de um vendedor com motivo", async () => {
    const user = userEvent.setup();
    const onChanged = jest.fn();
    mockApi.setCheckoutCardPause.mockResolvedValue({ ...client, card: { enabledBySeller: true, pausedAt: "2026-11-08T12:00:00.000Z" } });
    render(<CardPausePanel client={client} onChanged={onChanged} />);

    const button = screen.getByRole("button", { name: /pausar cartão/i });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/motivo/i), "Chargeback acima de 1%");
    await user.click(button);

    expect(mockApi.setCheckoutCardPause).toHaveBeenCalledWith("company-1", { paused: true, reason: "Chargeback acima de 1%" });
    expect(await screen.findByText(/o pix continua vendendo/i)).toBeInTheDocument();
  });
});
