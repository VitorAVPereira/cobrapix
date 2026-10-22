import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CardPaymentSettings from "../CardPaymentSettings";

const mockApi = {
  getCardPaymentSettings: jest.fn(),
  getCardPaymentAttempts: jest.fn(),
  configureCardPayments: jest.fn(),
  reconcileCardPayment: jest.fn(),
};
jest.mock("@/lib/use-api-client", () => ({ useApiClient: () => mockApi }));

const settings = {
  issuerIdentityId: "issuer",
  version: 3,
  enabled: true,
  onTimeBasisPoints: 50,
  overdueBasisPoints: 50,
  validationReference: "negociacao-efi-2026",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCardPaymentAttempts.mockResolvedValue([]);
  mockApi.configureCardPayments.mockResolvedValue(settings);
});

describe("CardPaymentSettings", () => {
  it("starts from the Efí table and saves the receipt mode with its rates", async () => {
    mockApi.getCardPaymentSettings.mockResolvedValue({
      activeIssuerIdentityId: "issuer",
      settings: [],
    });
    render(<CardPaymentSettings companyId="company" />);
    expect(await screen.findByLabelText("À vista (%)")).toHaveValue(3.49);
    expect(screen.getByLabelText("Por parcela antecipada (%)")).toHaveValue(1.29);

    fireEvent.click(screen.getByLabelText("Uma parcela a cada 31 dias"));
    expect(screen.queryByLabelText("Por parcela antecipada (%)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Parcelado de 2x a 6x (%)")).toHaveValue(3.99);
    fireEvent.change(screen.getByLabelText("Parcelado de 7x a 12x (%)"), {
      target: { value: "4.1" },
    });
    fireEvent.change(
      screen.getByLabelText("Referência da homologação e das tarifas contratadas"),
      { target: { value: "negociacao-efi-2026" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar cartão" }));

    await waitFor(() => expect(mockApi.configureCardPayments).toHaveBeenCalled());
    expect(mockApi.configureCardPayments.mock.calls[0][1]).toMatchObject({
      expectedVersion: 0,
      processingRates: {
        receipt: "INSTALLMENTS",
        cashBasisPoints: 349,
        upTo6BasisPoints: 399,
        upTo12BasisPoints: 410,
      },
    });
  });

  it("shows the negotiated rates of the company instead of the Efí table", async () => {
    mockApi.getCardPaymentSettings.mockResolvedValue({
      activeIssuerIdentityId: "issuer",
      settings: [
        {
          ...settings,
          processingRates: {
            receipt: "ANTICIPATED",
            cashBasisPoints: 299,
            anticipationBasisPoints: 99,
          },
        },
      ],
    });
    render(<CardPaymentSettings companyId="company" />);
    expect(await screen.findByLabelText("À vista (%)")).toHaveValue(2.99);
    expect(screen.getByLabelText("Por parcela antecipada (%)")).toHaveValue(0.99);
    expect(screen.getByLabelText("Valor total em até 31 dias (antecipado)")).toBeChecked();
  });

  it("warns that rates saved in the old per-brand format still apply", async () => {
    mockApi.getCardPaymentSettings.mockResolvedValue({
      activeIssuerIdentityId: "issuer",
      settings: [
        {
          ...settings,
          processingRates: [
            { brand: "visa", installments: 1, basisPoints: 300, fixedCents: 0 },
          ],
        },
      ],
    });
    render(<CardPaymentSettings companyId="company" />);
    expect(await screen.findByText(/formato anterior/)).toBeVisible();
    expect(screen.getByLabelText("À vista (%)")).toHaveValue(3.49);
  });
});
